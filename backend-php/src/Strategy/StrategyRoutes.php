<?php

/**
 * Strategy API — port of `strategy/strategy-routes.ts`.
 *
 * `Repere strategice` is a shared screen: everyone reads it, ADMIN also edits.
 * Codes are unique per strategy version, never globally, so every write is
 * scoped to a version.
 *
 * History is protected: a version campaigns already point at cannot be
 * repurposed, and a used pillar, program or objective is deactivated rather
 * than deleted.
 */

declare(strict_types=1);

namespace Omd\Strategy;

use Omd\Audit\Audit;
use Omd\Auth\Guard;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Support\Ids;
use Omd\Support\Validate;

final class StrategyRoutes
{
    private const KINDS = [
        'pillars' => 'strategic_pillars',
        'programs' => 'strategic_programs',
        'objectives' => 'strategic_objectives',
    ];

    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];
        $admin = [Guard::requireAdmin()];

        $router->get('/api/v1/strategy/versions', [self::class, 'versions'], $auth);
        $router->post('/api/v1/strategy/versions', [self::class, 'createVersion'], $admin);
        $router->post('/api/v1/strategy/versions/:versionKey/activate', [self::class, 'activate'], $admin);

        $router->get('/api/v1/strategy', [self::class, 'show'], $auth);

        $router->put('/api/v1/strategy/:versionKey/pillars/:code', [self::class, 'updatePillar'], $admin);
        $router->put('/api/v1/strategy/:versionKey/objectives/:code', [self::class, 'updateObjective'], $admin);
        $router->put('/api/v1/strategy/:versionKey/programs/:code', [self::class, 'updateProgram'], $admin);
        $router->post('/api/v1/strategy/:versionKey/:kind/:code/toggle-active', [self::class, 'toggleActive'], $admin);
    }

    /** Strategy versions with usage counts, newest horizon first. */
    public static function versions(Request $request): void
    {
        $rows = Db::rows(
            'SELECT sv.external_key AS id, sv.label, sv.status,
                    sv.period_start_year AS periodStartYear, sv.period_end_year AS periodEndYear,
                    sv.notes,
                    (SELECT COUNT(*) FROM campaigns c
                      WHERE c.strategy_version_id = sv.id AND c.deleted_at IS NULL) AS campaignCount,
                    (SELECT COUNT(*) FROM strategic_pillars p WHERE p.strategy_version_id = sv.id) AS pillarCount,
                    (SELECT COUNT(*) FROM strategic_programs p WHERE p.strategy_version_id = sv.id) AS programCount,
                    (SELECT COUNT(*) FROM strategic_objectives o WHERE o.strategy_version_id = sv.id) AS objectiveCount
               FROM strategy_versions sv
              ORDER BY sv.period_start_year DESC'
        );

        foreach ($rows as &$row) {
            foreach (['periodStartYear', 'periodEndYear', 'campaignCount', 'pillarCount',
                      'programCount', 'objectiveCount'] as $key) {
                $row[$key] = (int) $row[$key];
            }
        }
        unset($row);

        Response::data($rows);
    }

    /**
     * Campaign-side relations for the Repere strategice screen.
     *
     * The screen answers "how much of the strategy is actually
     * operationalised", and only the campaign fiches can say. A usage count is
     * not enough — the matrices need to know *which* campaign points at a reper
     * and with which role.
     *
     * @return list<array<string,mixed>>
     */
    private static function loadCampaignRelations(string $versionId): array
    {
        $campaigns = Db::rows(
            'SELECT c.external_key AS id, c.title,
                    st.code AS statusCode, st.label AS status,
                    c.insight, c.value_proposition AS valueProposition,
                    c.product_condition AS productCondition,
                    c.products, c.kpi_definitions AS kpiDefinitions
               FROM campaigns c
               JOIN campaign_statuses st ON st.id = c.status_id
              WHERE c.strategy_version_id = ? AND c.deleted_at IS NULL
              ORDER BY c.external_key',
            [$versionId],
        );

        $relationsFor = static fn (string $table, string $joinTable, string $column): array => Db::rows(
            "SELECT c.external_key AS campaignId, s.code, s.label, r.relation_role AS role
               FROM {$table} r
               JOIN campaigns c ON c.id = r.campaign_id
               JOIN {$joinTable} s ON s.id = r.{$column}
              WHERE c.strategy_version_id = ? AND c.deleted_at IS NULL
              ORDER BY r.relation_role DESC, r.sort_order",
            [$versionId],
        );

        $programLinks = $relationsFor('campaign_programs', 'strategic_programs', 'program_id');
        $objectiveLinks = $relationsFor('campaign_objectives', 'strategic_objectives', 'objective_id');
        $audienceLinks = $relationsFor('campaign_audiences', 'audience_segments', 'audience_segment_id');

        $pick = static function (array $links, string $campaignId, string $role): array {
            $out = [];
            foreach ($links as $link) {
                if ((string) $link['campaignId'] === $campaignId && $link['role'] === $role) {
                    $out[] = $link;
                }
            }
            return $out;
        };

        $out = [];
        foreach ($campaigns as $campaign) {
            $id = (string) $campaign['id'];

            $programPrimary = $pick($programLinks, $id, 'PRIMARY');
            $objectivePrimary = $pick($objectiveLinks, $id, 'PRIMARY');
            $audiencePrimary = $pick($audienceLinks, $id, 'PRIMARY');

            $out[] = [
                'id' => $id,
                'title' => $campaign['title'],
                'statusCode' => $campaign['statusCode'],
                'status' => $campaign['status'],
                'insight' => $campaign['insight'] ?? '',
                'valueProposition' => $campaign['valueProposition'] ?? '',
                'productCondition' => $campaign['productCondition'] ?? '',
                'products' => Db::json($campaign['products']),
                'kpiDefinitions' => Db::json($campaign['kpiDefinitions']),
                'programPrimaryCode' => $programPrimary[0]['code'] ?? '',
                'programSecondaryCodes' => array_map(
                    static fn (array $l): string => (string) $l['code'],
                    $pick($programLinks, $id, 'SECONDARY'),
                ),
                'objectivePrimaryCode' => $objectivePrimary[0]['code'] ?? '',
                'objectiveSecondaryCodes' => array_map(
                    static fn (array $l): string => (string) $l['code'],
                    $pick($objectiveLinks, $id, 'SECONDARY'),
                ),
                'primaryAudienceSegment' => $audiencePrimary[0]['label'] ?? '',
                'secondaryAudienceSegments' => array_map(
                    static fn (array $l): string => (string) $l['label'],
                    $pick($audienceLinks, $id, 'SECONDARY'),
                ),
            ];
        }

        return $out;
    }

    /** Full strategic content of one version, or of the ACTIVE one by default. */
    public static function show(Request $request): void
    {
        $requested = $request->queryString('version');

        $version = $requested !== ''
            ? Db::one(
                'SELECT id, external_key, label, status, period_start_year, period_end_year
                   FROM strategy_versions WHERE external_key = ?',
                [$requested],
            )
            : Db::one(
                "SELECT id, external_key, label, status, period_start_year, period_end_year
                   FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1"
            );

        if ($version === null) {
            throw ApiError::notFound('Versiunea strategică nu a fost găsită.');
        }
        $versionId = (string) $version['id'];

        // Usage counts drive the delete/deactivate affordances in the Admin UI.
        $pillars = Db::rows(
            'SELECT p.code, p.label, p.display_label AS displayLabel, p.hint, p.is_active AS isActive,
                    p.sort_order AS sortOrder,
                    (SELECT COUNT(*) FROM campaigns c WHERE c.pillar_id = p.id) AS usageCount
               FROM strategic_pillars p WHERE p.strategy_version_id = ? ORDER BY p.sort_order',
            [$versionId],
        );

        $programs = Db::rows(
            'SELECT p.code, p.name, p.label, p.result_text AS result,
                    p.marketing_objective AS marketingObjective, p.approach,
                    p.horizon_result_text AS horizonResult, p.target_groups_text AS targetGroups,
                    p.kpi_text AS kpiText, p.sources_text AS sources, p.annual_actions AS annualActions,
                    p.validation_status AS validationStatus, p.is_active AS isActive,
                    p.sort_order AS sortOrder,
                    (SELECT COUNT(*) FROM campaign_programs cp WHERE cp.program_id = p.id) AS usageCount
               FROM strategic_programs p WHERE p.strategy_version_id = ? ORDER BY p.sort_order',
            [$versionId],
        );

        $objectives = Db::rows(
            'SELECT o.code, o.name, o.label, o.source, o.is_active AS isActive, o.sort_order AS sortOrder,
                    (SELECT COUNT(*) FROM campaign_objectives co WHERE co.objective_id = o.id) AS usageCount
               FROM strategic_objectives o WHERE o.strategy_version_id = ? ORDER BY o.sort_order',
            [$versionId],
        );

        foreach ([&$pillars, &$programs, &$objectives] as &$set) {
            foreach ($set as &$row) {
                $row['isActive'] = (int) $row['isActive'];
                $row['sortOrder'] = (int) $row['sortOrder'];
                $row['usageCount'] = (int) $row['usageCount'];
            }
            unset($row);
        }
        unset($set);

        $programObjectives = Db::rows(
            'SELECT p.code AS programCode, o.code AS objectiveCode
               FROM strategic_program_objectives spo
               JOIN strategic_programs p ON p.id = spo.program_id
               JOIN strategic_objectives o ON o.id = spo.objective_id
              WHERE p.strategy_version_id = ? ORDER BY spo.sort_order',
            [$versionId],
        );

        /**
         * The full audience nomenclature, not only the used entries.
         *
         * A public no campaign has picked up yet is a finding, not an absence:
         * the screen shows "9 utilizate" out of 10 precisely because the tenth
         * is uncovered. Deriving the list from campaigns would drop it and
         * inflate the coverage.
         */
        $audiences = Db::rows(
            'SELECT code, label, is_active AS isActive, sort_order AS sortOrder
               FROM audience_segments ORDER BY sort_order, label'
        );
        foreach ($audiences as &$audience) {
            $audience['isActive'] = (int) $audience['isActive'];
            $audience['sortOrder'] = (int) $audience['sortOrder'];
        }
        unset($audience);

        Response::data([
            'version' => [
                'id' => $version['external_key'],
                'label' => $version['label'],
                'status' => $version['status'],
                // The screen prints "Rezultat urmărit până în <year>". Taking
                // the year from the version rather than hardcoding it keeps the
                // heading true when a later horizon is activated.
                'periodStartYear' => (int) $version['period_start_year'],
                'periodEndYear' => (int) $version['period_end_year'],
            ],
            'pillars' => $pillars,
            'programs' => $programs,
            'objectives' => $objectives,
            'programObjectives' => $programObjectives,
            'audiences' => $audiences,
            'campaigns' => self::loadCampaignRelations($versionId),
        ]);
    }

    private static function versionIdFor(string $externalKey): string
    {
        $row = Db::one('SELECT id FROM strategy_versions WHERE external_key = ?', [$externalKey]);
        if ($row === null) {
            throw ApiError::notFound('Versiunea strategică nu a fost găsită.');
        }
        return (string) $row['id'];
    }

    /**
     * Edits a strategic record in place. Codes are never rewritten.
     *
     * @param array<string,string> $columns
     */
    private static function updateStrategicRecord(
        string $table,
        string $versionKey,
        string $code,
        array $columns,
        ?string $userId,
    ): void {
        $versionId = self::versionIdFor($versionKey);
        $names = array_keys($columns);

        $assignments = implode(', ', array_map(static fn (string $n): string => $n . ' = ?', $names));

        $affected = Db::execute(
            "UPDATE {$table} SET {$assignments}, updated_by = ?
              WHERE strategy_version_id = ? AND code = ?",
            array_merge(array_values($columns), [$userId, $versionId, $code]),
        );

        if ($affected === 0) {
            throw ApiError::notFound("Reperul {$code} nu a fost găsit.");
        }

        Audit::write(
            userId: $userId,
            action: 'STRATEGY_CHANGE',
            entityType: strtoupper($table),
            entityExternalKey: $versionKey . ':' . $code,
            newValues: $columns,
        );
    }

    public static function updatePillar(Request $request): void
    {
        $v = new Validate($request->body());
        $label = $v->string('label', required: true, max: 255);
        $displayLabel = $v->string('displayLabel', max: 255);
        $hint = $v->string('hint');
        $v->check('Datele pilonului nu sunt valide.');

        self::updateStrategicRecord(
            'strategic_pillars',
            $request->param('versionKey'),
            $request->param('code'),
            ['label' => $label, 'display_label' => $displayLabel !== '' ? $displayLabel : $label, 'hint' => $hint],
            Guard::actorId($request),
        );

        Response::data(['ok' => true]);
    }

    public static function updateObjective(Request $request): void
    {
        $v = new Validate($request->body());
        $name = $v->string('name', required: true, max: 500);
        $label = $v->string('label', max: 500);
        $source = $v->string('source');
        $v->check('Datele obiectivului nu sunt valide.');

        self::updateStrategicRecord(
            'strategic_objectives',
            $request->param('versionKey'),
            $request->param('code'),
            ['name' => $name, 'label' => $label !== '' ? $label : $name, 'source' => $source],
            Guard::actorId($request),
        );

        Response::data(['ok' => true]);
    }

    public static function updateProgram(Request $request): void
    {
        $v = new Validate($request->body());
        $name = $v->string('name', required: true, max: 500);
        $label = $v->string('label', max: 500);
        $columns = [
            'name' => $name,
            'label' => $label !== '' ? $label : $name,
            'result_text' => $v->string('result'),
            'marketing_objective' => $v->string('marketingObjective'),
            'approach' => $v->string('approach'),
            'horizon_result_text' => $v->string('horizonResult'),
            'target_groups_text' => $v->string('targetGroups'),
            'kpi_text' => $v->string('kpiText'),
            'sources_text' => $v->string('sources'),
            'annual_actions' => $v->string('annualActions'),
            'validation_status' => $v->string('validationStatus', max: 255),
        ];
        $v->check('Datele programului nu sunt valide.');

        self::updateStrategicRecord(
            'strategic_programs',
            $request->param('versionKey'),
            $request->param('code'),
            $columns,
            Guard::actorId($request),
        );

        Response::data(['ok' => true]);
    }

    /**
     * Deactivate rather than delete.
     *
     * A used strategic record must stay resolvable for historical campaigns, so
     * deactivation is the only reversible way to retire it.
     */
    public static function toggleActive(Request $request): void
    {
        $table = self::KINDS[$request->param('kind')] ?? null;
        if ($table === null) {
            throw ApiError::notFound('Tip de reper necunoscut.');
        }

        $versionId = self::versionIdFor($request->param('versionKey'));
        $code = $request->param('code');
        $userId = Guard::actorId($request);

        $row = Db::one(
            "SELECT id, is_active FROM {$table} WHERE strategy_version_id = ? AND code = ?",
            [$versionId, $code],
        );
        if ($row === null) {
            throw ApiError::notFound("Reperul {$code} nu a fost găsit.");
        }

        $next = (int) $row['is_active'] === 1 ? 0 : 1;
        Db::execute(
            "UPDATE {$table} SET is_active = ?, updated_by = ? WHERE id = ?",
            [$next, $userId, $row['id']],
        );

        Audit::write(
            userId: $userId,
            action: 'STRATEGY_CHANGE',
            entityType: strtoupper($table),
            entityId: (string) $row['id'],
            entityExternalKey: $code,
            newValues: ['isActive' => $next === 1],
        );

        Response::data(['code' => $code, 'isActive' => $next === 1]);
    }

    /**
     * Activates a strategy version.
     *
     * Exactly one version is ACTIVE; the previous one is archived rather than
     * deleted, so historical campaigns keep pointing at a version that exists.
     */
    public static function activate(Request $request): void
    {
        $versionKey = $request->param('versionKey');
        $userId = Guard::actorId($request);

        Db::transaction(static function () use ($versionKey, $userId): void {
            $version = Db::one(
                'SELECT id, status FROM strategy_versions WHERE external_key = ?',
                [$versionKey],
            );
            if ($version === null) {
                throw ApiError::notFound('Versiunea strategică nu a fost găsită.');
            }
            if ($version['status'] === 'ACTIVE') {
                return;
            }

            Db::execute(
                "UPDATE strategy_versions SET status = 'ARCHIVED', updated_by = ? WHERE status = 'ACTIVE'",
                [$userId],
            );
            Db::execute(
                "UPDATE strategy_versions SET status = 'ACTIVE', updated_by = ? WHERE id = ?",
                [$userId, $version['id']],
            );

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: 'STRATEGY_VERSION',
                entityId: (string) $version['id'],
                entityExternalKey: $versionKey,
                newValues: ['status' => 'ACTIVE'],
            );
        });

        Response::data(['id' => $versionKey, 'status' => 'ACTIVE']);
    }

    /** New strategy version. Created DRAFT — activation is a separate decision. */
    public static function createVersion(Request $request): void
    {
        $v = new Validate($request->body());
        $externalKey = $v->string('externalKey', required: true, max: 191);
        $label = $v->string('label', required: true, max: 255);
        $startYear = $v->int('periodStartYear');
        $endYear = $v->int('periodEndYear');
        $notes = $v->string('notes');

        if ($startYear === null) {
            $v->fail('periodStartYear', 'Anul de început este obligatoriu.');
        }
        if ($endYear === null) {
            $v->fail('periodEndYear', 'Anul de final este obligatoriu.');
        }
        $v->check('Datele versiunii nu sunt valide.');

        if ($endYear < $startYear) {
            throw ApiError::validation('Anul de final trebuie să fie după anul de început.');
        }

        $existing = Db::one('SELECT id FROM strategy_versions WHERE external_key = ?', [$externalKey]);
        if ($existing !== null) {
            throw ApiError::conflict('Există deja o versiune cu această cheie.');
        }

        $userId = Guard::actorId($request);
        $id = Ids::newId();

        Db::execute(
            "INSERT INTO strategy_versions
               (id, external_key, label, period_start_year, period_end_year, status, notes, created_by)
             VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)",
            [$id, $externalKey, $label, $startYear, $endYear, $notes, $userId],
        );

        Audit::write(
            userId: $userId,
            action: 'STRATEGY_CHANGE',
            entityType: 'STRATEGY_VERSION',
            entityId: $id,
            entityExternalKey: $externalKey,
            newValues: ['status' => 'DRAFT'],
        );

        Response::status(201);
        Response::data(['id' => $externalKey, 'status' => 'DRAFT']);
    }
}
