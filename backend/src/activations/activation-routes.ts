/**
 * Activation read API.
 *
 *   GET /api/v1/activations   paginated list for the Activări screen
 *
 * Derived values (temporal situation, funding totals, budget balance) are NOT
 * computed or stored here — spec section 27 keeps them as display-time
 * calculations. What the API returns is the stored truth plus the counts the
 * list needs, so the screen does not have to fetch each activation's children.
 *
 * `includeAnnualPlan` has no column: it is derived from the existence of an
 * `annual_plan_activations` row (spec section 25 / rule 68 item 16).
 */
import { Router } from 'express';

import { dashInsensitive, limitClause, normalizeDashes, queryOne, queryRows } from '../database/db';
import { requireAuth, requireWriteAccess } from '../auth/middleware';
import { asyncHandler, pageMeta, readPagination, sendData, ApiError } from '../shared/http';
import { ActivationInput, createActivation, updateActivation } from './activation-write';
import { requireRole } from '../auth/middleware';
import { assessActivationDeletion, restoreEntity, softDeleteActivation } from '../shared/deletion-policy';

export const activationRouter = Router();

const LIST_SELECT = `
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
`;

activationRouter.get(
  '/activations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const filters: string[] = ['a.deleted_at IS NULL'];
    const params: Array<string | number> = [];

    const q = String(req.query.q ?? '').trim();
    if (q) {
      const like = `%${normalizeDashes(q)}%`;
      filters.push(`(${dashInsensitive('a.title')} LIKE ?
                  OR ${dashInsensitive('c.title')} LIKE ?
                  OR ${dashInsensitive('a.responsible')} LIKE ?
                  OR ${dashInsensitive('a.objective')} LIKE ?)`);
      params.push(like, like, like, like);
    }

    if (req.query.campaign) {
      filters.push('c.external_key = ?');
      params.push(String(req.query.campaign));
    }
    if (req.query.status) {
      filters.push('st.code = ?');
      params.push(String(req.query.status));
    }

    // Year overlap, not "starts in year": an activation spanning 2027-2028
    // belongs to both.
    if (req.query.year) {
      filters.push('(YEAR(a.start_date) <= ? AND YEAR(a.end_date) >= ?)');
      params.push(Number(req.query.year), Number(req.query.year));
    }

    const annual = String(req.query.annualPlan ?? '');
    if (annual === 'yes' || annual === 'no') {
      filters.push(
        `${annual === 'no' ? 'NOT ' : ''}EXISTS(
           SELECT 1 FROM annual_plan_activations apa WHERE apa.activation_id = a.id)`,
      );
    }

    // Period filters mirror the prototype's calendar situation options.
    const period = String(req.query.period ?? '');
    if (period === 'current') {
      filters.push('a.start_date <= CURDATE() AND a.end_date >= CURDATE()');
    } else if (period === 'upcoming') {
      filters.push('a.start_date >= CURDATE() AND a.start_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)');
    } else if (period === 'ended') {
      filters.push('a.end_date < CURDATE()');
    } else if (period === 'missing') {
      filters.push('(a.start_date IS NULL OR a.end_date IS NULL)');
    }

    if (String(req.query.needsResults ?? '') === 'true') {
      filters.push(
        'NOT EXISTS(SELECT 1 FROM material_performance_snapshots s WHERE s.activation_id = a.id)',
      );
    }
    if (String(req.query.unpublished ?? '') === 'true') {
      filters.push(`EXISTS(
        SELECT 1 FROM activation_materials m
         WHERE m.activation_id = a.id AND m.deleted_at IS NULL
           AND (m.public_url IS NULL OR m.public_url = ''))`);
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const total = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM activations a
         JOIN campaign_statuses st ON st.id = a.status_id
         LEFT JOIN campaigns c ON c.id = a.campaign_id
       ${where}`,
      params,
    );

    const rows = await queryRows(
      `${LIST_SELECT} ${where}
        ORDER BY a.start_date DESC, a.title ${limitClause(pageSize, offset)}`,
      params,
    );

    const unfiltered = await queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM activations WHERE deleted_at IS NULL',
    );

    sendData(res, rows, {
      ...pageMeta(total?.total ?? 0, page, pageSize),
      totalUnfiltered: unfiltered?.total ?? 0,
    });
  }),
);

/** Headline figures for the stats strip, computed over ALL activations. */
activationRouter.get(
  '/activations/stats',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const stats = await queryOne(
      `SELECT
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
      WHERE a.deleted_at IS NULL`,
    );
    sendData(res, stats);
  }),
);

/** Create. ADMIN and EDITOR only. */
activationRouter.post(
  '/activations',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    const parsed = ActivationInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele activării nu sunt valide.', parsed.error.issues);
    }
    const { externalKey } = await createActivation(parsed.data, req.user?.id ?? null);
    res.status(201);
    sendData(res, { id: externalKey });
  }),
);

/** Update, guarded by If-Match against `version_number`. */
activationRouter.put(
  '/activations/:externalKey',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    const parsed = ActivationInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele activării nu sunt valide.', parsed.error.issues);
    }
    const ifMatch = req.header('If-Match');
    const expectedVersion = ifMatch ? Number(ifMatch.replace(/"/g, '')) : null;
    if (ifMatch && !Number.isFinite(expectedVersion)) {
      throw ApiError.validation('Antetul If-Match nu este valid.');
    }
    const externalKey = String(req.params.externalKey);
    await updateActivation(externalKey, parsed.data, expectedVersion, req.user?.id ?? null);
    sendData(res, { id: externalKey });
  }),
);

/** Dependency preview before deletion. */
activationRouter.get(
  '/activations/:externalKey/dependencies',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM activations WHERE external_key = ? AND deleted_at IS NULL',
      [String(req.params.externalKey)],
    );
    if (!row) throw ApiError.notFound('Activarea nu a fost gasita.');
    sendData(res, await assessActivationDeletion(row.id));
  }),
);

activationRouter.delete(
  '/activations/:externalKey',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    await softDeleteActivation(String(req.params.externalKey), req.user?.id ?? null);
    sendData(res, { id: String(req.params.externalKey), deleted: true });
  }),
);

activationRouter.post(
  '/activations/:externalKey/restore',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await restoreEntity('activations', String(req.params.externalKey), req.user?.id ?? null);
    sendData(res, { id: String(req.params.externalKey), restored: true });
  }),
);

/** Single activation with its children, for the detail view. */
activationRouter.get(
  '/activations/:externalKey',
  requireAuth,
  asyncHandler(async (req, res) => {
    const externalKey = String(req.params.externalKey);

    const activation = await queryOne<{ id: string }>(
      `${LIST_SELECT} WHERE a.external_key = ? AND a.deleted_at IS NULL`,
      [externalKey],
    );
    if (!activation) throw ApiError.notFound('Activarea nu a fost găsită.');

    const row = await queryOne<{ id: string }>(
      'SELECT id FROM activations WHERE external_key = ?',
      [externalKey],
    );

    const materials = await queryRows(
      `SELECT m.external_key AS id, m.title, m.channel_raw AS channel, m.format_text AS format,
              m.other_channel AS otherChannel,
              m.budget_allocated AS budgetAllocated, m.run_start_date AS runStartDate,
              m.run_end_date AS runEndDate, m.public_url AS publicUrl, m.copy_text AS copy,
              m.visual_name AS visualName, m.visual_canva_url AS visualCanvaUrl,
              m.platform_external_id AS platformExternalId
         FROM activation_materials m
        WHERE m.activation_id = ? AND m.deleted_at IS NULL
        ORDER BY m.run_start_date, m.title`,
      [row!.id],
    );

    const kpis = await queryRows(
      `SELECT external_key AS id, enabled, name, target_text AS target, result_text AS result,
              source_text AS source, collection_text AS collection
         FROM activation_kpis
        WHERE activation_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
      [row!.id],
    );

    const fundingSources = await queryRows(
      // Both the label (display) and the code (editing). The code is the
      // identity; binding the editor to the label would break on rename.
      `SELECT ft.label AS type, ft.code AS typeCode, f.custom_label AS label, f.amount
         FROM activation_funding_sources f
         JOIN funding_types ft ON ft.id = f.funding_type_id
        WHERE f.activation_id = ? ORDER BY f.sort_order`,
      [row!.id],
    );

    // A custom audience has no catalog code and must stay as free text.
    const audiences = await queryRows(
      `SELECT COALESCE(s.label, aa.custom_label) AS label, s.code
         FROM activation_audiences aa
         LEFT JOIN audience_segments s ON s.id = aa.audience_segment_id
        WHERE aa.activation_id = ? ORDER BY aa.sort_order`,
      [row!.id],
    );

    sendData(res, { ...activation, materials, kpis, fundingSources, audiences });
  }),
);
