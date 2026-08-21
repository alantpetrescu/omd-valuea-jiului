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
use PDOException;

final class StrategyRoutes
{
    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];
        $admin = [Guard::requireAdmin()];

        $router->get('/api/v1/strategy/versions', [self::class, 'versions'], $auth);
        $router->post('/api/v1/strategy/versions', [self::class, 'createVersion'], $admin);
        $router->put('/api/v1/strategy/versions/:versionKey', [self::class, 'updateVersion'], $admin);
        $router->delete('/api/v1/strategy/versions/:versionKey', [self::class, 'deleteVersion'], $admin);
        $router->post('/api/v1/strategy/versions/:versionKey/activate', [self::class, 'activate'], $admin);
        $router->post('/api/v1/strategy/versions/:versionKey/archive', [self::class, 'archiveVersion'], $admin);

        $router->get('/api/v1/strategy', [self::class, 'show'], $auth);

        /*
         * One handler per verb rather than one per kind: the three tables differ
         * only in which columns they carry, and `columnsFor()` already holds
         * that difference. Three near-identical routes were three places for the
         * same rule to drift.
         *
         * `usage` is readable by any signed-in role — it answers "may this be
         * deleted", which is a question, not a change (§AS-B-A34).
         */
        $router->post('/api/v1/strategy/:versionKey/:kind', [self::class, 'create'], $admin);
        $router->put('/api/v1/strategy/:versionKey/:kind/:code', [self::class, 'update'], $admin);
        $router->delete('/api/v1/strategy/:versionKey/:kind/:code', [self::class, 'delete'], $admin);
        $router->get('/api/v1/strategy/:versionKey/:kind/:code/usage', [self::class, 'usage'], $auth);
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

    // -----------------------------------------------------------------------
    // Repere: create, edit, delete, usage
    // -----------------------------------------------------------------------

    /**
     * The validated column map for one kind.
     *
     * Shared by create and edit so the two cannot drift apart. Every column the
     * table owns is named here, because `PUT` replaces what it names: a field
     * left out would be silently blanked on the next save, which is the failure
     * the UI's field list is also written to prevent.
     *
     * @return array<string,string>
     */
    private static function columnsFor(string $kind, Request $request): array
    {
        $v = new Validate($request->body());

        if ($kind === 'pillars') {
            $label = $v->string('label', required: true, max: 255);
            $displayLabel = $v->string('displayLabel', max: 255);
            $hint = $v->string('hint');
            $v->check('Datele pilonului nu sunt valide.');

            return [
                'label' => $label,
                'display_label' => $displayLabel !== '' ? $displayLabel : $label,
                'hint' => $hint,
            ];
        }

        if ($kind === 'objectives') {
            $name = $v->string('name', required: true, max: 500);
            $label = $v->string('label', max: 500);
            $source = $v->string('source');
            $v->check('Datele obiectivului nu sunt valide.');

            return [
                'name' => $name,
                'label' => $label !== '' ? $label : $name,
                'source' => $source,
            ];
        }

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

        return $columns;
    }

    /**
     * `objectiveCodes` from the body, or null when the caller did not mention it.
     *
     * The distinction matters: an absent key leaves the matrix alone, an empty
     * array clears it. Collapsing the two would make every save of a programme
     * form that predates this field wipe its objectives.
     *
     * @return list<string>|null
     */
    private static function objectiveCodesFrom(Request $request): ?array
    {
        $body = $request->body();
        if (!array_key_exists('objectiveCodes', $body)) {
            return null;
        }

        $v = new Validate($body);
        $codes = $v->stringList('objectiveCodes', maxItems: 500);
        $v->check('Lista de obiective nu este validă.');

        return $codes;
    }

    /** Creates a reper in one version. `sort_order` appends. */
    public static function create(Request $request): void
    {
        $kind = $request->param('kind');
        $table = StrategyService::tableFor($kind);
        $versionKey = $request->param('versionKey');
        $versionId = StrategyService::versionIdFor($versionKey);
        $userId = Guard::actorId($request);

        $code = StrategyService::normalizeCode($request->body()['code'] ?? null);
        $columns = self::columnsFor($kind, $request);
        $objectiveCodes = $kind === 'programs' ? self::objectiveCodesFrom($request) : null;

        $existing = Db::one(
            "SELECT id FROM {$table} WHERE strategy_version_id = ? AND code = ?",
            [$versionId, $code],
        );
        if ($existing !== null) {
            throw ApiError::conflict("Codul {$code} există deja în această versiune strategică.");
        }

        $id = Ids::newId();

        Db::transaction(static function () use (
            $table, $id, $versionId, $code, $columns, $objectiveCodes, $userId, $kind, $versionKey
        ): void {
            $names = array_merge(
                ['id', 'strategy_version_id', 'code'],
                array_keys($columns),
                ['sort_order', 'created_by'],
            );
            $values = array_merge(
                [$id, $versionId, $code],
                array_values($columns),
                [StrategyService::nextSortOrder($table, $versionId), $userId],
            );
            $placeholders = implode(', ', array_fill(0, count($names), '?'));

            try {
                Db::execute(
                    "INSERT INTO {$table} (" . implode(', ', $names) . ") VALUES ({$placeholders})",
                    $values,
                );
            } catch (PDOException $error) {
                // Two admins creating the same code at once: the UNIQUE index is
                // the arbiter, and its verdict is a conflict, not a 500.
                if (Db::isMysqlError($error, Db::ERR_DUPLICATE_ENTRY)) {
                    throw ApiError::conflict("Codul {$code} există deja în această versiune strategică.");
                }
                throw $error;
            }

            if ($objectiveCodes !== null) {
                StrategyService::replaceProgramObjectives($id, $versionId, $objectiveCodes, $userId);
            }

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: strtoupper($table),
                entityId: $id,
                entityExternalKey: $versionKey . ':' . $code,
                newValues: ['code' => $code] + $columns,
            );
        });

        Response::status(201);
        Response::data(['code' => $code, 'kind' => $kind, 'version' => $versionKey]);
    }

    /**
     * Edits a reper in place, optionally renaming its code.
     *
     * `newCode` is honoured only while the reper is neither referenced nor
     * import-touched (§4.1) — see `StrategyService::codeEditable` for why the
     * rule is that strict.
     */
    public static function update(Request $request): void
    {
        $kind = $request->param('kind');
        $table = StrategyService::tableFor($kind);
        $versionKey = $request->param('versionKey');
        $versionId = StrategyService::versionIdFor($versionKey);
        $code = $request->param('code');
        $userId = Guard::actorId($request);

        $record = StrategyService::recordFor($kind, $versionId, $code);
        $columns = self::columnsFor($kind, $request);
        $objectiveCodes = $kind === 'programs' ? self::objectiveCodesFrom($request) : null;

        $body = $request->body();
        $newCode = null;
        if (array_key_exists('newCode', $body) && $body['newCode'] !== null && $body['newCode'] !== '') {
            $candidate = StrategyService::normalizeCode($body['newCode']);
            if ($candidate !== $code) {
                $newCode = $candidate;
            }
        }

        if ($newCode !== null) {
            $usage = StrategyService::usage($kind, $record['id']);
            if (!$usage['canEditCode']) {
                throw new ApiError(
                    'CODE_LOCKED',
                    'Codul nu mai poate fi schimbat: reperul este folosit sau a fost adus prin import.',
                    [
                        'externalKey' => $code,
                        'dependencies' => $usage['business'],
                        'importedAt' => $usage['importedAt'],
                    ],
                );
            }

            $clash = Db::one(
                "SELECT id FROM {$table} WHERE strategy_version_id = ? AND code = ?",
                [$versionId, $newCode],
            );
            if ($clash !== null) {
                throw ApiError::conflict("Codul {$newCode} există deja în această versiune strategică.");
            }

            $columns['code'] = $newCode;
        }

        Db::transaction(static function () use (
            $table, $record, $columns, $objectiveCodes, $versionId, $userId, $kind, $versionKey, $code, $newCode
        ): void {
            $assignments = implode(
                ', ',
                array_map(static fn (string $name): string => $name . ' = ?', array_keys($columns)),
            );

            try {
                Db::execute(
                    "UPDATE {$table} SET {$assignments}, updated_by = ? WHERE id = ?",
                    array_merge(array_values($columns), [$userId, $record['id']]),
                );
            } catch (PDOException $error) {
                if (Db::isMysqlError($error, Db::ERR_DUPLICATE_ENTRY)) {
                    throw ApiError::conflict('Codul există deja în această versiune strategică.');
                }
                throw $error;
            }

            if ($kind === 'programs' && $objectiveCodes !== null) {
                StrategyService::replaceProgramObjectives($record['id'], $versionId, $objectiveCodes, $userId);
            }

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: strtoupper($table),
                entityId: $record['id'],
                entityExternalKey: $versionKey . ':' . $code,
                // A rename is the one edit that cannot be read back from the
                // row afterwards, so both codes go into the trail.
                oldValues: $newCode !== null ? ['code' => $code] : null,
                newValues: $columns,
            );
        });

        Response::data(['code' => $newCode ?? $code, 'renamedFrom' => $newCode !== null ? $code : null]);
    }

    /**
     * Deletes an unused reper.
     *
     * The matrix rows that belong to it go in the same transaction — they are
     * part of the reper, not a use of it (§2). Business references block, and
     * the check is repeated here rather than trusted from a preview: between the
     * dialog opening and this call, someone else may have created a campaign
     * (§35.1.11).
     */
    public static function delete(Request $request): void
    {
        $kind = $request->param('kind');
        $table = StrategyService::tableFor($kind);
        $versionKey = $request->param('versionKey');
        $versionId = StrategyService::versionIdFor($versionKey);
        $code = $request->param('code');
        $userId = Guard::actorId($request);

        $record = StrategyService::recordFor($kind, $versionId, $code);

        Db::transaction(static function () use ($kind, $table, $record, $code, $versionKey, $userId): void {
            $usage = StrategyService::usage($kind, $record['id']);
            if (!$usage['canDelete']) {
                throw StrategyService::inUseError($kind, $code, $usage['business']);
            }

            if ($kind === 'programs') {
                Db::execute('DELETE FROM strategic_program_objectives WHERE program_id = ?', [$record['id']]);
            } elseif ($kind === 'objectives') {
                Db::execute('DELETE FROM strategic_program_objectives WHERE objective_id = ?', [$record['id']]);
            }

            try {
                Db::execute("DELETE FROM {$table} WHERE id = ?", [$record['id']]);
            } catch (PDOException $error) {
                // FK RESTRICT is the net under the checks above. If it catches
                // something they missed, that is still a business conflict.
                if (Db::isMysqlError($error, Db::ERR_ROW_IS_REFERENCED)) {
                    throw StrategyService::inUseError($kind, $code, $usage['business']);
                }
                throw $error;
            }

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: strtoupper($table),
                entityId: $record['id'],
                entityExternalKey: $versionKey . ':' . $code,
                oldValues: ['code' => $code, 'deleted' => true],
            );
        });

        Response::noContent();
    }

    /**
     * What points at one reper, and therefore what may be done to it.
     *
     * Readable by any signed-in role: the Admin screen is ADMIN-only, but this
     * is the answer to "can this be deleted", and an EDITOR consulting it does
     * not change anything.
     */
    public static function usage(Request $request): void
    {
        $kind = $request->param('kind');
        $versionId = StrategyService::versionIdFor($request->param('versionKey'));
        $record = StrategyService::recordFor($kind, $versionId, $request->param('code'));

        Response::data(StrategyService::usage($kind, $record['id']));
    }

    /**
     * Deactivate rather than delete.
     *
     * A used strategic record must stay resolvable for historical campaigns, so
     * deactivation is the only reversible way to retire it.
     */
    public static function toggleActive(Request $request): void
    {
        $kind = $request->param('kind');
        $table = StrategyService::tableFor($kind);
        $versionId = StrategyService::versionIdFor($request->param('versionKey'));
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

    // -----------------------------------------------------------------------
    // Versiuni
    // -----------------------------------------------------------------------

    /**
     * @return array{id:string,external_key:string,status:string,label:string}
     */
    private static function versionRow(string $externalKey): array
    {
        $row = Db::one(
            'SELECT id, external_key, status, label FROM strategy_versions WHERE external_key = ?',
            [$externalKey],
        );
        if ($row === null) {
            throw ApiError::notFound('Versiunea strategică nu a fost găsită.');
        }
        /** @var array{id:string,external_key:string,status:string,label:string} $row */
        return $row;
    }

    /**
     * How much of the operational record hangs off a version.
     *
     * Activations have no version column of their own; they belong to one
     * through the pillar they carry, which is why the second count joins rather
     * than filters.
     *
     * @return list<array{type:string,count:int}>
     */
    private static function versionDependencies(string $versionId): array
    {
        $out = [];

        $campaigns = Db::count(
            'SELECT COUNT(*) FROM campaigns WHERE strategy_version_id = ?',
            [$versionId],
        );
        if ($campaigns > 0) {
            $out[] = ['type' => 'campanii', 'count' => $campaigns];
        }

        $activations = Db::count(
            'SELECT COUNT(*) FROM activations a
               JOIN strategic_pillars p ON p.id = a.pillar_id
              WHERE p.strategy_version_id = ?',
            [$versionId],
        );
        if ($activations > 0) {
            $out[] = ['type' => 'activări', 'count' => $activations];
        }

        return $out;
    }

    /**
     * Edits a version's metadata.
     *
     * `externalKey` stays as created. It is the key the importer looks for in
     * `strategicData.strategyVersion.externalKey`, so renaming it would make the
     * next real package create a second version instead of updating this one.
     * Sent anyway, it is ignored rather than refused — the UI has no reason to
     * strip a field the server can simply not read.
     */
    public static function updateVersion(Request $request): void
    {
        $versionKey = $request->param('versionKey');
        $version = self::versionRow($versionKey);
        $userId = Guard::actorId($request);

        $v = new Validate($request->body());
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

        Db::execute(
            'UPDATE strategy_versions
                SET label = ?, period_start_year = ?, period_end_year = ?, notes = ?, updated_by = ?
              WHERE id = ?',
            [$label, $startYear, $endYear, $notes, $userId, $version['id']],
        );

        Audit::write(
            userId: $userId,
            action: 'STRATEGY_CHANGE',
            entityType: 'STRATEGY_VERSION',
            entityId: $version['id'],
            entityExternalKey: $versionKey,
            newValues: [
                'label' => $label,
                'periodStartYear' => $startYear,
                'periodEndYear' => $endYear,
            ],
        );

        Response::data([
            'id' => $version['external_key'],
            'label' => $label,
            'periodStartYear' => $startYear,
            'periodEndYear' => $endYear,
            'status' => $version['status'],
        ]);
    }

    /**
     * Deletes a DRAFT version nothing points at, together with its repere.
     *
     * The repere belong to the version, so they go with it; campaigns and
     * activations do not, so their presence stops the whole thing.
     */
    public static function deleteVersion(Request $request): void
    {
        $versionKey = $request->param('versionKey');
        $version = self::versionRow($versionKey);
        $userId = Guard::actorId($request);

        if ($version['status'] === 'ACTIVE') {
            throw new ApiError(
                'VERSION_ACTIVE',
                'Versiunea activă nu poate fi ștearsă. Activează altă versiune întâi.',
            );
        }
        if ($version['status'] !== 'DRAFT') {
            throw ApiError::conflict(
                'Doar o versiune în lucru (DRAFT) poate fi ștearsă. Una arhivată păstrează istoricul.',
            );
        }

        $dependencies = self::versionDependencies($version['id']);
        if ($dependencies !== []) {
            throw new ApiError(
                'ENTITY_IN_USE',
                'Versiunea are înregistrări legate și nu poate fi ștearsă.',
                [
                    'entityType' => 'STRATEGY_VERSION',
                    'externalKey' => $versionKey,
                    'dependencies' => $dependencies,
                    'allowedAction' => 'ARCHIVE',
                ],
            );
        }

        Db::transaction(static function () use ($version, $versionKey, $userId): void {
            Db::execute(
                'DELETE spo FROM strategic_program_objectives spo
                   JOIN strategic_programs p ON p.id = spo.program_id
                  WHERE p.strategy_version_id = ?',
                [$version['id']],
            );

            foreach (StrategyService::KINDS as $table) {
                Db::execute("DELETE FROM {$table} WHERE strategy_version_id = ?", [$version['id']]);
            }

            try {
                Db::execute('DELETE FROM strategy_versions WHERE id = ?', [$version['id']]);
            } catch (PDOException $error) {
                if (Db::isMysqlError($error, Db::ERR_ROW_IS_REFERENCED)) {
                    throw new ApiError(
                        'ENTITY_IN_USE',
                        'Versiunea are înregistrări legate și nu poate fi ștearsă.',
                    );
                }
                throw $error;
            }

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: 'STRATEGY_VERSION',
                entityId: $version['id'],
                entityExternalKey: $versionKey,
                oldValues: ['label' => $version['label'], 'deleted' => true],
            );
        });

        Response::noContent();
    }

    /**
     * Archives a version.
     *
     * Refused on the ACTIVE one: "exactly one version is active" is kept by
     * activating a different version, which archives this one as a side effect,
     * never by emptying the position and leaving the screen without a strategy
     * to show.
     */
    public static function archiveVersion(Request $request): void
    {
        $versionKey = $request->param('versionKey');
        $version = self::versionRow($versionKey);
        $userId = Guard::actorId($request);

        if ($version['status'] === 'ACTIVE') {
            throw new ApiError(
                'VERSION_ACTIVE',
                'Versiunea activă nu poate fi arhivată. Activează altă versiune, iar aceasta se arhivează automat.',
            );
        }

        if ($version['status'] !== 'ARCHIVED') {
            Db::execute(
                "UPDATE strategy_versions SET status = 'ARCHIVED', updated_by = ? WHERE id = ?",
                [$userId, $version['id']],
            );

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: 'STRATEGY_VERSION',
                entityId: $version['id'],
                entityExternalKey: $versionKey,
                oldValues: ['status' => $version['status']],
                newValues: ['status' => 'ARCHIVED'],
            );
        }

        Response::data(['id' => $versionKey, 'status' => 'ARCHIVED']);
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

    /**
     * New strategy version, optionally cloned from an existing one.
     *
     * Created DRAFT while another version is ACTIVE — activation stays a
     * separate, deliberate decision. On an empty database it is created ACTIVE
     * instead: the same rule the importer applies (§33.4.1), and the only one
     * that leaves `GET /strategy` with something to answer.
     */
    public static function createVersion(Request $request): void
    {
        $v = new Validate($request->body());
        $externalKey = $v->string('externalKey', required: true, max: 191);
        $label = $v->string('label', required: true, max: 255);
        $startYear = $v->int('periodStartYear');
        $endYear = $v->int('periodEndYear');
        $notes = $v->string('notes');
        $cloneFrom = $v->string('cloneFromExternalKey', max: 191);

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

        $sourceId = null;
        if ($cloneFrom !== '') {
            $source = Db::one('SELECT id FROM strategy_versions WHERE external_key = ?', [$cloneFrom]);
            if ($source === null) {
                throw ApiError::notFound('Versiunea sursă pentru copiere nu a fost găsită.');
            }
            $sourceId = (string) $source['id'];
        }

        $status = StrategyService::statusForNewVersion(Db::count('SELECT COUNT(*) FROM strategy_versions'));
        $userId = Guard::actorId($request);
        $id = Ids::newId();

        $copied = Db::transaction(static function () use (
            $id, $externalKey, $label, $startYear, $endYear, $status, $notes, $userId, $sourceId
        ): array {
            Db::execute(
                'INSERT INTO strategy_versions
                   (id, external_key, label, period_start_year, period_end_year, status, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $externalKey, $label, $startYear, $endYear, $status, $notes, $userId],
            );

            $counts = ['pillars' => 0, 'programs' => 0, 'objectives' => 0, 'relations' => 0];
            if ($sourceId !== null) {
                $counts = StrategyClone::copy($sourceId, $id, $userId);
            }

            Audit::write(
                userId: $userId,
                action: 'STRATEGY_CHANGE',
                entityType: 'STRATEGY_VERSION',
                entityId: $id,
                entityExternalKey: $externalKey,
                newValues: ['status' => $status] + ($sourceId !== null ? ['clonedRepere' => $counts] : []),
            );

            return $counts;
        });

        Response::status(201);
        Response::data(['id' => $externalKey, 'status' => $status, 'copied' => $copied]);
    }
}
