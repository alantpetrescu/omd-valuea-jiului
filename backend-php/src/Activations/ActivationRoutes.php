<?php

/**
 * Activation API — port of `activations/activation-routes.ts`.
 *
 * Derived values (temporal situation, funding totals, budget balance) are NOT
 * computed or stored here — they stay display-time calculations. What the API
 * returns is the stored truth plus the counts the list needs, so the screen
 * does not have to fetch each activation's children.
 *
 * `includeAnnualPlan` has no column: it is derived from the existence of an
 * `annual_plan_activations` row.
 */

declare(strict_types=1);

namespace Omd\Activations;

use Omd\Assets\Storage;
use Omd\Auth\Guard;
use Omd\Campaigns\CampaignRoutes;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Shared\DeletionPolicy;

final class ActivationRoutes
{
    private const LIST_SELECT = <<<'SQL'
        SELECT
          a.external_key                AS id,
          a.title,
          a.start_date                  AS startDate,
          a.end_date                    AS endDate,
          st.code                       AS statusCode,
          st.label                      AS status,
          a.responsible,
          a.version_number              AS versionNumber,
          a.planned_budget              AS plannedBudget,
          a.actual_spend                AS actualSpend,
          im.label                      AS implementationMode,
          im.code                       AS implementationModeCode,
          a.objective, a.zone, a.message, a.landing_url AS landingUrl,
          a.implementation_partners     AS implementationPartners,
          a.result_summary              AS resultSummary,
          a.what_worked                 AS whatWorked,
          a.recommendation,
          a.products,
          ap.code                       AS activationPillarCode,
          c.external_key                AS campaignId,
          c.title                       AS campaignTitle,
          ct.label                      AS campaignType,
          cp.display_label              AS campaignPillar,
          ap.display_label              AS activationPillar,
          sv.external_key               AS strategyVersion,
          (SELECT COUNT(*) FROM activation_materials m
            WHERE m.activation_id = a.id AND m.deleted_at IS NULL) AS materialCount,
          (SELECT COUNT(*) FROM activation_materials m
            WHERE m.activation_id = a.id AND m.deleted_at IS NULL
              AND m.channel_id IS NOT NULL AND m.run_start_date IS NOT NULL) AS materialConfiguredCount,
          (SELECT COUNT(*) FROM activation_materials m
            WHERE m.activation_id = a.id AND m.deleted_at IS NULL
              AND (m.public_url IS NULL OR m.public_url = '')) AS materialsWithoutPublicUrl,
          (SELECT MAX(s.observed_at) FROM material_performance_snapshots s
            WHERE s.activation_id = a.id) AS lastResultsAt,
          EXISTS(SELECT 1 FROM annual_plan_activations apa WHERE apa.activation_id = a.id)
                                        AS includeAnnualPlan,
          (SELECT COALESCE(SUM(f.amount), 0) FROM activation_funding_sources f
            WHERE f.activation_id = a.id) AS fundingTotal
        FROM activations a
        JOIN campaign_statuses st ON st.id = a.status_id
        JOIN strategy_versions sv ON sv.id = a.strategy_version_id
        LEFT JOIN campaigns c              ON c.id  = a.campaign_id
        LEFT JOIN campaign_types ct        ON ct.id = c.campaign_type_id
        LEFT JOIN strategic_pillars cp     ON cp.id = c.pillar_id
        LEFT JOIN strategic_pillars ap     ON ap.id = a.pillar_id
        LEFT JOIN implementation_modes im  ON im.id = a.implementation_mode_id
        SQL;

    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];
        $write = [Guard::requireWrite()];
        $admin = [Guard::requireAdmin()];

        $router->get('/api/v1/activations/stats', [self::class, 'stats'], $auth);
        $router->get('/api/v1/activations', [self::class, 'index'], $auth);
        $router->post('/api/v1/activations', [self::class, 'create'], $write);

        $router->get('/api/v1/activations/:externalKey/dependencies', [self::class, 'dependencies'], $auth);
        $router->post('/api/v1/activations/:externalKey/restore', [self::class, 'restore'], $admin);

        $router->get('/api/v1/activations/:externalKey', [self::class, 'show'], $auth);
        $router->put('/api/v1/activations/:externalKey', [self::class, 'update'], $write);
        $router->delete('/api/v1/activations/:externalKey', [self::class, 'destroy'], $write);
    }

    /** @param array<string,mixed> $row */
    private static function castRow(array $row): array
    {
        $row['plannedBudget'] = Db::decimal($row['plannedBudget'] ?? null);
        $row['actualSpend'] = Db::decimal($row['actualSpend'] ?? null);
        $row['fundingTotal'] = Db::decimal($row['fundingTotal'] ?? null);
        $row['products'] = Db::json($row['products'] ?? null);
        foreach (['materialCount', 'materialConfiguredCount', 'materialsWithoutPublicUrl',
                  'includeAnnualPlan', 'versionNumber'] as $key) {
            if (array_key_exists($key, $row)) {
                $row[$key] = (int) $row[$key];
            }
        }
        return $row;
    }

    public static function index(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $filters = ['a.deleted_at IS NULL'];
        $params = [];

        $q = $request->queryString('q');
        if ($q !== '') {
            $like = '%' . Db::normalizeDashes($q) . '%';
            $filters[] = sprintf(
                '(%s LIKE ? OR %s LIKE ? OR %s LIKE ? OR %s LIKE ?)',
                Db::dashInsensitive('a.title'),
                Db::dashInsensitive('c.title'),
                Db::dashInsensitive('a.responsible'),
                Db::dashInsensitive('a.objective'),
            );
            array_push($params, $like, $like, $like, $like);
        }

        $campaign = $request->queryString('campaign');
        if ($campaign !== '') {
            $filters[] = 'c.external_key = ?';
            $params[] = $campaign;
        }
        $status = $request->queryString('status');
        if ($status !== '') {
            $filters[] = 'st.code = ?';
            $params[] = $status;
        }

        // Year overlap, not "starts in year": an activation spanning 2027–2028
        // belongs to both.
        $year = $request->queryInt('year');
        if ($year !== null) {
            $filters[] = '(YEAR(a.start_date) <= ? AND YEAR(a.end_date) >= ?)';
            array_push($params, $year, $year);
        }

        $annual = $request->queryString('annualPlan');
        if ($annual === 'yes' || $annual === 'no') {
            $filters[] = ($annual === 'no' ? 'NOT ' : '')
                . 'EXISTS(SELECT 1 FROM annual_plan_activations apa WHERE apa.activation_id = a.id)';
        }

        // Period filters mirror the prototype's calendar situation options.
        $period = $request->queryString('period');
        if ($period === 'current') {
            $filters[] = 'a.start_date <= CURDATE() AND a.end_date >= CURDATE()';
        } elseif ($period === 'upcoming') {
            $filters[] = 'a.start_date >= CURDATE() AND a.start_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)';
        } elseif ($period === 'ended') {
            $filters[] = 'a.end_date < CURDATE()';
        } elseif ($period === 'missing') {
            $filters[] = '(a.start_date IS NULL OR a.end_date IS NULL)';
        }

        if ($request->queryString('needsResults') === 'true') {
            $filters[] = 'NOT EXISTS(SELECT 1 FROM material_performance_snapshots s WHERE s.activation_id = a.id)';
        }
        if ($request->queryString('unpublished') === 'true') {
            $filters[] = "EXISTS(
                SELECT 1 FROM activation_materials m
                 WHERE m.activation_id = a.id AND m.deleted_at IS NULL
                   AND (m.public_url IS NULL OR m.public_url = ''))";
        }

        $where = 'WHERE ' . implode(' AND ', $filters);

        $total = Db::count(
            "SELECT COUNT(*) FROM activations a
               JOIN campaign_statuses st ON st.id = a.status_id
               LEFT JOIN campaigns c ON c.id = a.campaign_id
             {$where}",
            $params,
        );

        $rows = Db::rows(
            self::LIST_SELECT . ' ' . $where
            . ' ORDER BY a.start_date DESC, a.title ' . Db::limit($pageSize, $offset),
            $params,
        );
        $rows = array_map([self::class, 'castRow'], $rows);

        $unfiltered = Db::count('SELECT COUNT(*) FROM activations WHERE deleted_at IS NULL');

        Response::data($rows, Response::pageMeta($total, $page, $pageSize) + [
            'totalUnfiltered' => $unfiltered,
        ]);
    }

    /** Headline figures for the stats strip, computed over ALL activations. */
    public static function stats(Request $request): void
    {
        $stats = Db::one(
            "SELECT
               COUNT(*)                                                        AS total,
               SUM(st.code = 'DRAFT')                                          AS draft,
               SUM(st.code = 'ACTIVE')                                         AS active,
               SUM(st.code = 'CLOSED')                                         AS closed,
               COALESCE(SUM(a.planned_budget), 0)                              AS plannedBudget,
               COALESCE(SUM(a.actual_spend), 0)                                AS actualSpend,
               SUM(NOT EXISTS(SELECT 1 FROM material_performance_snapshots s
                               WHERE s.activation_id = a.id))                  AS needResults
             FROM activations a
             JOIN campaign_statuses st ON st.id = a.status_id
            WHERE a.deleted_at IS NULL"
        ) ?? [];

        foreach (['total', 'draft', 'active', 'closed', 'needResults'] as $key) {
            $stats[$key] = (int) ($stats[$key] ?? 0);
        }
        $stats['plannedBudget'] = Db::decimal($stats['plannedBudget'] ?? null);
        $stats['actualSpend'] = Db::decimal($stats['actualSpend'] ?? null);

        Response::data($stats);
    }

    public static function create(Request $request): void
    {
        $input = ActivationWrite::parseInput($request->body());
        $created = ActivationWrite::create($input, Guard::actorId($request));

        Response::status(201);
        Response::data(['id' => $created['externalKey']]);
    }

    public static function update(Request $request): void
    {
        $input = ActivationWrite::parseInput($request->body());
        $expectedVersion = CampaignRoutes::readIfMatch($request);
        $externalKey = $request->param('externalKey');

        ActivationWrite::update($externalKey, $input, $expectedVersion, Guard::actorId($request));
        Response::data(['id' => $externalKey]);
    }

    public static function dependencies(Request $request): void
    {
        $row = Db::one(
            'SELECT id FROM activations WHERE external_key = ? AND deleted_at IS NULL',
            [$request->param('externalKey')],
        );
        if ($row === null) {
            throw ApiError::notFound('Activarea nu a fost gasita.');
        }
        Response::data(DeletionPolicy::assessActivation((string) $row['id']));
    }

    public static function destroy(Request $request): void
    {
        $externalKey = $request->param('externalKey');
        DeletionPolicy::softDeleteActivation($externalKey, Guard::actorId($request));
        Response::data(['id' => $externalKey, 'deleted' => true]);
    }

    public static function restore(Request $request): void
    {
        $externalKey = $request->param('externalKey');
        DeletionPolicy::restore('activations', $externalKey, Guard::actorId($request));
        Response::data(['id' => $externalKey, 'restored' => true]);
    }

    /** One activation with its children, for the detail view. */
    public static function show(Request $request): void
    {
        $externalKey = $request->param('externalKey');

        $activation = Db::one(
            self::LIST_SELECT . ' WHERE a.external_key = ? AND a.deleted_at IS NULL',
            [$externalKey],
        );
        if ($activation === null) {
            throw ApiError::notFound('Activarea nu a fost găsită.');
        }
        $activation = self::castRow($activation);

        $row = Db::one('SELECT id FROM activations WHERE external_key = ?', [$externalKey]);
        $id = (string) $row['id'];

        /*
         * The visual comes from either place a material can keep one: an asset
         * it owns, or one it reuses from a campaign template. COALESCE prefers
         * the owned asset — a material given its own visual is not showing the
         * template's.
         *
         * Without this the fiche could only ever say "vizual neîncărcat", since
         * nothing in the payload pointed at the file.
         */
        $materials = Db::rows(
            "SELECT m.external_key AS id, m.title, m.channel_raw AS channel, m.format_text AS format,
                    m.other_channel AS otherChannel,
                    m.budget_allocated AS budgetAllocated, m.run_start_date AS runStartDate,
                    m.run_end_date AS runEndDate, m.public_url AS publicUrl, m.copy_text AS copy,
                    m.visual_name AS visualName, m.visual_canva_url AS visualCanvaUrl,
                    m.platform_external_id AS platformExternalId,
                    COALESCE(own.storage_path, tpl.storage_path) AS visualStoragePath
               FROM activation_materials m
               LEFT JOIN assets own ON own.id = m.own_asset_id
               LEFT JOIN campaign_template_assets cta ON cta.id = m.campaign_template_asset_id
               LEFT JOIN assets tpl ON tpl.id = cta.asset_id
              WHERE m.activation_id = ? AND m.deleted_at IS NULL
              ORDER BY m.run_start_date, m.title",
            [$id],
        );
        foreach ($materials as &$material) {
            $material['budgetAllocated'] = Db::decimal($material['budgetAllocated']);
            $path = $material['visualStoragePath'] ?? null;
            $material['visualUrl'] = is_string($path) && $path !== ''
                ? Storage::publicUrl($path)
                : null;
            unset($material['visualStoragePath']);
        }
        unset($material);

        $kpis = Db::rows(
            'SELECT external_key AS id, enabled, name, target_text AS target, result_text AS result,
                    source_text AS source, collection_text AS collection
               FROM activation_kpis
              WHERE activation_id = ? AND deleted_at IS NULL ORDER BY sort_order',
            [$id],
        );
        foreach ($kpis as &$kpi) {
            $kpi['enabled'] = (int) $kpi['enabled'] === 1;
        }
        unset($kpi);

        // Both the label (display) and the code (editing). The code is the
        // identity; binding the editor to the label would break on rename.
        $fundingSources = Db::rows(
            'SELECT ft.label AS type, ft.code AS typeCode, f.custom_label AS label, f.amount
               FROM activation_funding_sources f
               JOIN funding_types ft ON ft.id = f.funding_type_id
              WHERE f.activation_id = ? ORDER BY f.sort_order',
            [$id],
        );
        foreach ($fundingSources as &$source) {
            $source['amount'] = Db::decimal($source['amount']);
        }
        unset($source);

        // A custom audience has no catalogue code and stays free text.
        $audiences = Db::rows(
            'SELECT COALESCE(s.label, aa.custom_label) AS label, s.code
               FROM activation_audiences aa
               LEFT JOIN audience_segments s ON s.id = aa.audience_segment_id
              WHERE aa.activation_id = ? ORDER BY aa.sort_order',
            [$id],
        );

        Response::data($activation + [
            'materials' => $materials,
            'kpis' => $kpis,
            'fundingSources' => $fundingSources,
            'audiences' => $audiences,
        ]);
    }
}
