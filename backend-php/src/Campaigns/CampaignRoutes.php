<?php

/**
 * Campaign API — port of `campaigns/campaign-routes.ts`.
 *
 *   GET    /api/v1/campaigns
 *   GET    /api/v1/campaigns/:externalKey
 *   POST   /api/v1/campaigns
 *   PUT    /api/v1/campaigns/:externalKey
 *   GET    /api/v1/campaigns/:externalKey/export
 *   GET    /api/v1/campaigns/:externalKey/dependencies
 *   DELETE /api/v1/campaigns/:externalKey
 *   POST   /api/v1/campaigns/:externalKey/restore
 *   GET    /api/v1/campaigns/:externalKey/activations
 *   GET    /api/v1/catalogs
 *
 * The API speaks `external_key` as the functional identity; the internal UUID
 * never leaves the backend.
 */

declare(strict_types=1);

namespace Omd\Campaigns;

use Omd\Auth\Guard;
use Omd\Catalogs\MasterRegistry;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Shared\DeletionPolicy;

final class CampaignRoutes
{
    /** List projection: what the Campanii screen renders, nothing heavier. */
    private const LIST_SELECT = <<<'SQL'
        SELECT
          c.external_key                AS id,
          c.title,
          c.accent,
          ct.label                      AS type,
          p.label                       AS pillar,
          p.display_label               AS pillarShort,
          st.code                       AS statusCode,
          st.label                      AS status,
          sz.label                      AS seasonalityLabel,
          c.seasonality_months          AS seasonalityMonths,
          c.main_message                AS mainMessage,
          c.marketing_objective         AS marketingObjective,
          c.primary_audience_description AS primaryAudienceDescription,
          aud.label                     AS primaryAudienceSegment,
          sv.external_key               AS strategyVersion,
          sv.label                      AS strategyVersionLabel,
          JSON_LENGTH(COALESCE(JSON_EXTRACT(c.activation_examples, '$.simulatedRows'), JSON_ARRAY()))
                                        AS activationExampleCount,
          (SELECT COUNT(*) FROM campaign_templates t
            WHERE t.campaign_id = c.id AND t.deleted_at IS NULL) AS templateCount
        FROM campaigns c
        JOIN campaign_types    ct ON ct.id = c.campaign_type_id
        JOIN campaign_statuses st ON st.id = c.status_id
        JOIN strategic_pillars p  ON p.id  = c.pillar_id
        JOIN seasonality_types sz ON sz.id = c.seasonality_type_id
        JOIN strategy_versions sv ON sv.id = c.strategy_version_id
        LEFT JOIN campaign_audiences ca
               ON ca.campaign_id = c.id AND ca.relation_role = 'PRIMARY'
        LEFT JOIN audience_segments aud ON aud.id = ca.audience_segment_id
        SQL;

    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];
        $write = [Guard::requireWrite()];
        $admin = [Guard::requireAdmin()];

        $router->get('/api/v1/campaigns', [self::class, 'index'], $auth);
        $router->post('/api/v1/campaigns', [self::class, 'create'], $write);
        $router->get('/api/v1/catalogs', [self::class, 'catalogs'], $auth);

        $router->get('/api/v1/campaigns/:externalKey/export', [self::class, 'export'], $auth);
        $router->get('/api/v1/campaigns/:externalKey/dependencies', [self::class, 'dependencies'], $auth);
        $router->get('/api/v1/campaigns/:externalKey/activations', [self::class, 'activations'], $auth);
        $router->post('/api/v1/campaigns/:externalKey/restore', [self::class, 'restore'], $admin);

        $router->get('/api/v1/campaigns/:externalKey', [self::class, 'show'], $auth);
        $router->put('/api/v1/campaigns/:externalKey', [self::class, 'update'], $write);
        $router->delete('/api/v1/campaigns/:externalKey', [self::class, 'destroy'], $write);
    }

    public static function index(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $filters = ['c.deleted_at IS NULL'];
        $params = [];

        $q = $request->queryString('q');
        if ($q !== '') {
            // The prototype's search scope: identity, messaging, audience and
            // the creative JSON columns. Text columns compare dash-insensitively;
            // JSON_SEARCH keeps the raw term, since the document cannot be
            // rewritten in place.
            $filters[] = sprintf(
                '(%s LIKE ? OR %s LIKE ? OR %s LIKE ? OR %s LIKE ? OR %s LIKE ?
                  OR JSON_SEARCH(c.products, \'one\', ?) IS NOT NULL
                  OR JSON_SEARCH(c.channels, \'one\', ?) IS NOT NULL
                  OR JSON_SEARCH(c.headlines, \'one\', ?) IS NOT NULL
                  OR JSON_SEARCH(c.activation_examples, \'one\', ?) IS NOT NULL)',
                Db::dashInsensitive('c.title'),
                Db::dashInsensitive('c.main_message'),
                Db::dashInsensitive('c.marketing_objective'),
                Db::dashInsensitive('c.primary_audience_description'),
                Db::dashInsensitive('c.central_idea'),
            );
            $like = '%' . Db::normalizeDashes($q) . '%';
            $raw = '%' . $q . '%';
            array_push($params, $like, $like, $like, $like, $like, $raw, $raw, $raw, $raw);
        }

        foreach ([
            'status' => 'st.code = ?',
            'type' => 'ct.code = ?',
            'pillar' => 'p.code = ?',
            'strategyVersion' => 'sv.external_key = ?',
        ] as $key => $clause) {
            $value = $request->queryString($key);
            if ($value !== '') {
                $filters[] = $clause;
                $params[] = $value;
            }
        }

        $where = 'WHERE ' . implode(' AND ', $filters);

        $total = Db::count(
            "SELECT COUNT(*) FROM campaigns c
               JOIN campaign_types ct ON ct.id = c.campaign_type_id
               JOIN campaign_statuses st ON st.id = c.status_id
               JOIN strategic_pillars p ON p.id = c.pillar_id
               JOIN strategy_versions sv ON sv.id = c.strategy_version_id
             {$where}",
            $params,
        );

        $rows = Db::rows(
            self::LIST_SELECT . ' ' . $where . ' ORDER BY c.external_key ' . Db::limit($pageSize, $offset),
            $params,
        );

        foreach ($rows as &$row) {
            $row['seasonalityMonths'] = Db::json($row['seasonalityMonths']);
            $row['activationExampleCount'] = (int) $row['activationExampleCount'];
            $row['templateCount'] = (int) $row['templateCount'];
        }
        unset($row);

        $unfiltered = Db::count('SELECT COUNT(*) FROM campaigns WHERE deleted_at IS NULL');

        Response::data($rows, Response::pageMeta($total, $page, $pageSize) + [
            // Unfiltered count, so the screen can render "N din M campanii".
            'totalUnfiltered' => $unfiltered,
        ]);
    }

    public static function show(Request $request): void
    {
        $campaign = CampaignDetail::load($request->param('externalKey'));
        if ($campaign === null) {
            throw ApiError::notFound('Campania nu a fost găsită.');
        }
        // The ETag carries version_number; the editor returns it as If-Match.
        Response::header('ETag', '"' . $campaign['versionNumber'] . '"');
        Response::data($campaign);
    }

    public static function create(Request $request): void
    {
        $input = CampaignWrite::parseInput($request->body());
        $created = CampaignWrite::create($input, Guard::actorId($request));

        Response::status(201);
        Response::data(CampaignDetail::load($created['externalKey']));
    }

    public static function update(Request $request): void
    {
        $input = CampaignWrite::parseInput($request->body());

        $expectedVersion = self::readIfMatch($request);
        $externalKey = $request->param('externalKey');

        CampaignWrite::update($externalKey, $input, $expectedVersion, Guard::actorId($request));
        Response::data(CampaignDetail::load($externalKey));
    }

    /** Parses `If-Match: "3"` into 3. An unparsable header is a 422, not a silent skip. */
    public static function readIfMatch(Request $request): ?int
    {
        $header = $request->header('if-match');
        if ($header === null || trim($header) === '') {
            return null;
        }
        $value = str_replace(['"', 'W/'], '', trim($header));
        if (!preg_match('/^\d+$/', $value)) {
            throw ApiError::validation('Antetul If-Match nu este valid.');
        }
        return (int) $value;
    }

    public static function export(Request $request): void
    {
        $visuals = $request->queryString('visuals') === 'link' ? 'link' : 'embed';
        $result = CampaignExport::build($request->param('externalKey'), $visuals);

        if ($result === null) {
            throw ApiError::notFound('Campania nu a fost gasita.');
        }

        // An export is only useful if it can be read back. Refusing a package
        // that fails its own contract beats handing over a file that will be
        // rejected at import time, when the original may no longer exist.
        if ($visuals === 'embed' && $result['validationErrors'] !== []) {
            throw new ApiError(
                'INTERNAL_ERROR',
                'Exportul nu respecta contractul OMD_CAMPAIGNS_PACKAGE si a fost oprit.',
                array_slice($result['validationErrors'], 0, 20),
            );
        }

        Response::data($result['package'], [
            'visuals' => $visuals,
            'importable' => $visuals === 'embed',
            'contractValid' => $result['validationErrors'] === [],
            'assetCount' => $result['assetCount'],
            'missingAssets' => $result['missingAssets'],
            'campaignKeys' => $result['campaignKeys'],
        ]);
    }

    public static function dependencies(Request $request): void
    {
        $row = Db::one(
            'SELECT id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
            [$request->param('externalKey')],
        );
        if ($row === null) {
            throw ApiError::notFound('Campania nu a fost gasita.');
        }
        Response::data(DeletionPolicy::assessCampaign((string) $row['id']));
    }

    public static function destroy(Request $request): void
    {
        $externalKey = $request->param('externalKey');
        DeletionPolicy::softDeleteCampaign($externalKey, Guard::actorId($request));
        Response::data(['id' => $externalKey, 'deleted' => true]);
    }

    public static function restore(Request $request): void
    {
        $externalKey = $request->param('externalKey');
        DeletionPolicy::restore('campaigns', $externalKey, Guard::actorId($request));
        Response::data(['id' => $externalKey, 'restored' => true]);
    }

    public static function activations(Request $request): void
    {
        Response::data(CampaignDetail::activations($request->param('externalKey')));
    }

    /**
     * Master data for the dropdowns.
     *
     * Nothing here is hardcoded in React — every list comes from the database.
     */
    public static function catalogs(Request $request): void
    {
        $catalogs = [];

        foreach (MasterRegistry::CATALOGS as $catalog) {
            $rows = Db::rows(
                "SELECT code, label, display_label AS displayLabel, hint, is_system AS isSystem
                   FROM {$catalog} WHERE is_active = 1 ORDER BY sort_order, label"
            );
            foreach ($rows as &$row) {
                $row['isSystem'] = (int) $row['isSystem'];
            }
            unset($row);
            $catalogs[$catalog] = $rows;
        }

        $catalogs['pillars'] = Db::rows(
            "SELECT p.code, p.label, p.display_label AS displayLabel
               FROM strategic_pillars p
               JOIN strategy_versions sv ON sv.id = p.strategy_version_id
              WHERE p.is_active = 1 AND sv.status = 'ACTIVE'
              ORDER BY p.sort_order"
        );

        // Strategic reference data, scoped to the ACTIVE version — codes are
        // unique per version, never globally.
        $catalogs['programs'] = Db::rows(
            "SELECT sp.code, sp.label, sp.name AS displayLabel
               FROM strategic_programs sp
               JOIN strategy_versions sv ON sv.id = sp.strategy_version_id
              WHERE sp.is_active = 1 AND sv.status = 'ACTIVE'
              ORDER BY sp.sort_order"
        );
        $catalogs['objectives'] = Db::rows(
            "SELECT so.code, so.label, so.name AS displayLabel
               FROM strategic_objectives so
               JOIN strategy_versions sv ON sv.id = so.strategy_version_id
              WHERE so.is_active = 1 AND sv.status = 'ACTIVE'
              ORDER BY so.sort_order"
        );

        Response::data($catalogs);
    }
}
