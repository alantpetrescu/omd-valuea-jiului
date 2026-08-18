/**
 * Annual Plan API — spec sections 25 and 26.
 *
 * The model that must not be simplified:
 *   annual_plan_campaigns    manual selections only
 *   annual_plan_activations  activations whose period touches the year
 *   effective campaigns      manual UNION DISTINCT campaigns of included activations
 *
 * A campaign reached through an activation is never copied into the manual
 * table. PUT /:year/campaigns therefore edits only the manual half.
 */
import { Router } from 'express';

import { execute, queryOne, queryRows, withTransaction } from '../database/db';
import { newId } from '../shared/ids';
import { requireAuth, requireWriteAccess } from '../auth/middleware';
import { asyncHandler, sendData, ApiError } from '../shared/http';
import { writeAudit } from '../audit/audit-service';

export const annualPlanRouter = Router();

/** Years that exist as plans, with headline totals. */
annualPlanRouter.get(
  '/annual-plans',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = await queryRows(
      `SELECT p.year,
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
        ORDER BY p.year`,
    );
    sendData(res, rows);
  }),
);

/** Everything the Plan anual screen renders for one year. */
annualPlanRouter.get(
  '/annual-plans/:year',
  requireAuth,
  asyncHandler(async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year)) throw ApiError.validation('An invalid.');

    const plan = await queryOne<{ id: string; year: number }>(
      'SELECT id, year FROM annual_plans WHERE year = ? AND deleted_at IS NULL',
      [year],
    );
    if (!plan) throw ApiError.notFound(`Nu există un plan anual pentru ${year}.`);

    const activations = await queryRows(
      `SELECT a.external_key AS id, a.title, a.start_date AS startDate, a.end_date AS endDate,
              st.code AS statusCode, st.label AS status,
              a.planned_budget AS plannedBudget, a.actual_spend AS actualSpend,
              im.label AS implementationMode,
              c.external_key AS campaignId, c.title AS campaignTitle,
              (SELECT COALESCE(SUM(f.amount), 0) FROM activation_funding_sources f
                WHERE f.activation_id = a.id) AS fundingTotal
         FROM annual_plan_activations apa
         JOIN activations a ON a.id = apa.activation_id
         JOIN campaign_statuses st ON st.id = a.status_id
         LEFT JOIN campaigns c ON c.id = a.campaign_id
         LEFT JOIN implementation_modes im ON im.id = a.implementation_mode_id
        WHERE apa.annual_plan_id = ? AND a.deleted_at IS NULL
        ORDER BY a.start_date`,
      [plan.id],
    );

    const campaigns = await queryRows(
      `SELECT c.external_key AS id, c.title, ct.label AS type, p.display_label AS pillar,
              st.label AS status,
              EXISTS(SELECT 1 FROM annual_plan_campaigns apc
                      WHERE apc.annual_plan_id = ? AND apc.campaign_id = c.id) AS manual
         FROM v_annual_plan_effective_campaigns v
         JOIN campaigns c ON c.id = v.campaign_id
         JOIN campaign_types ct ON ct.id = c.campaign_type_id
         JOIN campaign_statuses st ON st.id = c.status_id
         JOIN strategic_pillars p ON p.id = c.pillar_id
        WHERE v.annual_plan_id = ? AND c.deleted_at IS NULL
        ORDER BY c.external_key`,
      [plan.id, plan.id],
    );

    const manualSelection = await queryRows<{ id: string }>(
      `SELECT c.external_key AS id FROM annual_plan_campaigns apc
         JOIN campaigns c ON c.id = apc.campaign_id
        WHERE apc.annual_plan_id = ? ORDER BY apc.sort_order`,
      [plan.id],
    );

    const totals = await queryOne(
      `SELECT COALESCE(SUM(a.planned_budget), 0) AS plannedBudget,
              COALESCE(SUM(a.actual_spend), 0)   AS actualSpend,
              COALESCE((SELECT SUM(f.amount) FROM activation_funding_sources f
                         JOIN annual_plan_activations apa2 ON apa2.activation_id = f.activation_id
                        WHERE apa2.annual_plan_id = ?), 0) AS fundingTotal
         FROM annual_plan_activations apa
         JOIN activations a ON a.id = apa.activation_id
        WHERE apa.annual_plan_id = ? AND a.deleted_at IS NULL`,
      [plan.id, plan.id],
    );

    sendData(res, {
      year: plan.year,
      activations,
      campaigns,
      manualCampaignExternalKeys: manualSelection.map((row) => row.id),
      totals,
    });
  }),
);

/**
 * Replaces the MANUAL campaign selection for a year.
 * Campaigns present only through an activation are untouched.
 */
annualPlanRouter.put(
  '/annual-plans/:year/campaigns',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    const year = Number(req.params.year);
    if (!Number.isInteger(year)) throw ApiError.validation('An invalid.');

    const keys: unknown = req.body?.selectedCampaignExternalKeys;
    if (!Array.isArray(keys) || keys.some((key) => typeof key !== 'string')) {
      throw ApiError.validation('selectedCampaignExternalKeys trebuie sa fie o lista de chei.');
    }

    const userId = req.user?.id ?? null;

    await withTransaction(async (connection) => {
      let plan = await queryOne<{ id: string }>(
        'SELECT id FROM annual_plans WHERE year = ?',
        [year],
        connection,
      );

      if (!plan) {
        const id = newId();
        await execute(
          'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
          [id, String(year), year, userId],
          connection,
        );
        plan = { id };
      }

      await execute(
        'DELETE FROM annual_plan_campaigns WHERE annual_plan_id = ?',
        [plan.id],
        connection,
      );

      for (const [index, key] of (keys as string[]).entries()) {
        const campaign = await queryOne<{ id: string }>(
          'SELECT id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
          [key],
          connection,
        );
        if (!campaign) throw ApiError.validation(`Campanie inexistenta: ${key}`);
        await execute(
          `INSERT INTO annual_plan_campaigns (annual_plan_id, campaign_id, sort_order, created_by)
           VALUES (?, ?, ?, ?)`,
          [plan.id, campaign.id, index, userId],
          connection,
        );
      }

      await writeAudit(
        { userId, action: 'UPDATE', entityType: 'ANNUAL_PLAN', entityId: plan.id,
          entityExternalKey: String(year),
          newValues: { manualCampaigns: keys } },
        connection,
      );
    });

    sendData(res, { year, selectedCampaignExternalKeys: keys });
  }),
);
