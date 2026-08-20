<?php

/**
 * Annual Plan API — port of `annual-plans/annual-plan-routes.ts`.
 *
 * The model that must not be simplified:
 *   annual_plan_campaigns    manual selections only
 *   annual_plan_activations  activations whose period touches the year
 *   effective campaigns      manual UNION DISTINCT campaigns of included activations
 *
 * A campaign reached through an activation is never copied into the manual
 * table, so PUT /:year/campaigns edits only the manual half.
 */

declare(strict_types=1);

namespace Omd\AnnualPlans;

use Omd\Audit\Audit;
use Omd\Auth\Guard;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Support\Ids;

final class AnnualPlanRoutes
{
    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];
        $write = [Guard::requireWrite()];

        $router->get('/api/v1/annual-plans', [self::class, 'index'], $auth);
        $router->put('/api/v1/annual-plans/:year/campaigns', [self::class, 'setCampaigns'], $write);
        $router->get('/api/v1/annual-plans/:year', [self::class, 'show'], $auth);
    }

    /** Years that exist as plans, with headline totals. */
    public static function index(Request $request): void
    {
        $rows = Db::rows(
            'SELECT p.year,
                    p.external_key AS id,
                    (SELECT COUNT(*) FROM annual_plan_activations apa WHERE apa.annual_plan_id = p.id)
                      AS activationCount,
                    (SELECT COUNT(DISTINCT v.campaign_id) FROM v_annual_plan_effective_campaigns v
                      WHERE v.annual_plan_id = p.id) AS campaignCount,
                    (SELECT COALESCE(SUM(a.planned_budget), 0)
                       FROM annual_plan_activations apa
                       JOIN activations a ON a.id = apa.activation_id
                      WHERE apa.annual_plan_id = p.id AND a.deleted_at IS NULL) AS plannedBudget,
                    (SELECT COALESCE(SUM(a.actual_spend), 0)
                       FROM annual_plan_activations apa
                       JOIN activations a ON a.id = apa.activation_id
                      WHERE apa.annual_plan_id = p.id AND a.deleted_at IS NULL) AS actualSpend
               FROM annual_plans p
              WHERE p.deleted_at IS NULL
              ORDER BY p.year'
        );

        foreach ($rows as &$row) {
            $row['year'] = (int) $row['year'];
            $row['activationCount'] = (int) $row['activationCount'];
            $row['campaignCount'] = (int) $row['campaignCount'];
            $row['plannedBudget'] = Db::decimal($row['plannedBudget']);
            $row['actualSpend'] = Db::decimal($row['actualSpend']);
        }
        unset($row);

        Response::data($rows);
    }

    private static function year(Request $request): int
    {
        $year = $request->param('year');
        if (preg_match('/^\d{4}$/', $year) !== 1) {
            throw ApiError::validation('An invalid.');
        }
        return (int) $year;
    }

    /** Everything the Plan anual screen renders for one year. */
    public static function show(Request $request): void
    {
        $year = self::year($request);

        $plan = Db::one('SELECT id, year FROM annual_plans WHERE year = ? AND deleted_at IS NULL', [$year]);
        if ($plan === null) {
            throw ApiError::notFound("Nu există un plan anual pentru {$year}.");
        }
        $planId = (string) $plan['id'];

        $activations = Db::rows(
            'SELECT a.external_key AS id, a.title, a.start_date AS startDate, a.end_date AS endDate,
                    st.code AS statusCode, st.label AS status,
                    a.planned_budget AS plannedBudget, a.actual_spend AS actualSpend,
                    im.label AS implementationMode,
                    c.external_key AS campaignId, c.title AS campaignTitle,
                    (SELECT COALESCE(SUM(f.amount), 0) FROM activation_funding_sources f
                      WHERE f.activation_id = a.id) AS fundingTotal,
                    /*
                     * The distinct funding types behind that total, so the plan
                     * can be filtered by source. The sum alone cannot answer
                     * "show me what a partner is paying for" — it says how much,
                     * never from where.
                     */
                    (SELECT GROUP_CONCAT(DISTINCT ft.label ORDER BY ft.label SEPARATOR \'|\')
                       FROM activation_funding_sources f
                       JOIN funding_types ft ON ft.id = f.funding_type_id
                      WHERE f.activation_id = a.id) AS fundingTypesRaw
               FROM annual_plan_activations apa
               JOIN activations a ON a.id = apa.activation_id
               JOIN campaign_statuses st ON st.id = a.status_id
               LEFT JOIN campaigns c ON c.id = a.campaign_id
               LEFT JOIN implementation_modes im ON im.id = a.implementation_mode_id
              WHERE apa.annual_plan_id = ? AND a.deleted_at IS NULL
              ORDER BY a.start_date',
            [$planId],
        );
        foreach ($activations as &$activation) {
            $activation['plannedBudget'] = Db::decimal($activation['plannedBudget']);
            $activation['actualSpend'] = Db::decimal($activation['actualSpend']);
            $activation['fundingTotal'] = Db::decimal($activation['fundingTotal']);

            // GROUP_CONCAT returns one delimited string, or NULL for none. The
            // API contract is a list either way, so the client never has to
            // know the join produced it.
            $raw = $activation['fundingTypesRaw'] ?? null;
            $activation['fundingTypes'] = is_string($raw) && $raw !== ''
                ? explode('|', $raw)
                : [];
            unset($activation['fundingTypesRaw']);
        }
        unset($activation);

        $campaigns = Db::rows(
            'SELECT c.external_key AS id, c.title, ct.label AS type, p.display_label AS pillar,
                    st.label AS status,
                    EXISTS(SELECT 1 FROM annual_plan_campaigns apc
                            WHERE apc.annual_plan_id = ? AND apc.campaign_id = c.id) AS manual
               FROM v_annual_plan_effective_campaigns v
               JOIN campaigns c ON c.id = v.campaign_id
               JOIN campaign_types ct ON ct.id = c.campaign_type_id
               JOIN campaign_statuses st ON st.id = c.status_id
               JOIN strategic_pillars p ON p.id = c.pillar_id
              WHERE v.annual_plan_id = ? AND c.deleted_at IS NULL
              ORDER BY c.external_key',
            [$planId, $planId],
        );
        foreach ($campaigns as &$campaign) {
            $campaign['manual'] = (int) $campaign['manual'];
        }
        unset($campaign);

        $manualSelection = Db::rows(
            'SELECT c.external_key AS id FROM annual_plan_campaigns apc
               JOIN campaigns c ON c.id = apc.campaign_id
              WHERE apc.annual_plan_id = ? ORDER BY apc.sort_order',
            [$planId],
        );

        $totals = Db::one(
            'SELECT COALESCE(SUM(a.planned_budget), 0) AS plannedBudget,
                    COALESCE(SUM(a.actual_spend), 0)   AS actualSpend,
                    COALESCE((SELECT SUM(f.amount) FROM activation_funding_sources f
                               JOIN annual_plan_activations apa2 ON apa2.activation_id = f.activation_id
                              WHERE apa2.annual_plan_id = ?), 0) AS fundingTotal
               FROM annual_plan_activations apa
               JOIN activations a ON a.id = apa.activation_id
              WHERE apa.annual_plan_id = ? AND a.deleted_at IS NULL',
            [$planId, $planId],
        ) ?? [];

        foreach (['plannedBudget', 'actualSpend', 'fundingTotal'] as $key) {
            $totals[$key] = Db::decimal($totals[$key] ?? null);
        }

        Response::data([
            'year' => (int) $plan['year'],
            'activations' => $activations,
            'campaigns' => $campaigns,
            'manualCampaignExternalKeys' => array_map(
                static fn (array $row): string => (string) $row['id'],
                $manualSelection,
            ),
            'totals' => $totals,
        ]);
    }

    /**
     * Replaces the MANUAL campaign selection for a year.
     * Campaigns present only through an activation are untouched.
     */
    public static function setCampaigns(Request $request): void
    {
        $year = self::year($request);

        $keys = $request->body()['selectedCampaignExternalKeys'] ?? null;
        if (!is_array($keys)) {
            throw ApiError::validation('selectedCampaignExternalKeys trebuie sa fie o lista de chei.');
        }
        foreach ($keys as $key) {
            if (!is_string($key)) {
                throw ApiError::validation('selectedCampaignExternalKeys trebuie sa fie o lista de chei.');
            }
        }
        $keys = array_values($keys);

        $userId = Guard::actorId($request);

        Db::transaction(static function () use ($year, $keys, $userId): void {
            $plan = Db::one('SELECT id FROM annual_plans WHERE year = ?', [$year]);

            if ($plan === null) {
                $id = Ids::newId();
                Db::execute(
                    'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
                    [$id, (string) $year, $year, $userId],
                );
                $plan = ['id' => $id];
            }
            $planId = (string) $plan['id'];

            Db::execute('DELETE FROM annual_plan_campaigns WHERE annual_plan_id = ?', [$planId]);

            foreach ($keys as $index => $key) {
                $campaign = Db::one(
                    'SELECT id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
                    [$key],
                );
                if ($campaign === null) {
                    throw ApiError::validation("Campanie inexistenta: {$key}");
                }
                Db::execute(
                    'INSERT INTO annual_plan_campaigns (annual_plan_id, campaign_id, sort_order, created_by)
                     VALUES (?, ?, ?, ?)',
                    [$planId, $campaign['id'], $index, $userId],
                );
            }

            Audit::write(
                userId: $userId,
                action: 'UPDATE',
                entityType: 'ANNUAL_PLAN',
                entityId: $planId,
                entityExternalKey: (string) $year,
                newValues: ['manualCampaigns' => $keys],
            );
        });

        Response::data(['year' => $year, 'selectedCampaignExternalKeys' => $keys]);
    }
}
