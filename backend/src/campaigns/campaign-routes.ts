/**
 * Campaign read API.
 *
 *   GET /api/v1/campaigns              paginated list for the Campanii screen
 *   GET /api/v1/campaigns/:externalKey single campaign
 *   GET /api/v1/catalogs               master data for filter dropdowns
 *
 * Spec section 8.2: the API speaks `external_key` as the functional identity.
 * The internal UUID never leaves the backend, so the React screens keep using
 * `camp-002` exactly as the v13.3 prototype does.
 *
 * Writes arrive in a later step; this is the read surface the first two pages
 * need.
 */
import { Router } from 'express';

import { dashInsensitive, limitClause, normalizeDashes, queryOne, queryRows } from '../database/db';
import { MASTER_CATALOGS } from '../catalogs/system-master-registry';
import { requireAuth, requireWriteAccess, requireRole } from '../auth/middleware';
import { assessCampaignDeletion, restoreEntity, softDeleteCampaign } from '../shared/deletion-policy';
import { asyncHandler, pageMeta, readPagination, sendData, ApiError } from '../shared/http';
import { loadCampaignActivations, loadCampaignDetail } from './campaign-detail';
import { CampaignInput, createCampaign, updateCampaign } from './campaign-write';

export const campaignRouter = Router();

/** List projection: what the Campanii screen renders, nothing heavier. */
const LIST_SELECT = `
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
`;

campaignRouter.get(
  '/campaigns',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const filters: string[] = ['c.deleted_at IS NULL'];
    const params: Array<string | number> = [];

    const q = String(req.query.q ?? '').trim();
    if (q) {
      // Matches the prototype's search scope: identity, messaging, audience and
      // the creative JSON columns (products, channels, headlines, mockups,
      // activation directions). JSON_SEARCH is case-insensitive with 'one'.
      // Text columns are compared dash-insensitively; JSON_SEARCH keeps the
      // raw term, since the JSON document cannot be rewritten in place.
      filters.push(`(
        ${dashInsensitive('c.title')} LIKE ?
        OR ${dashInsensitive('c.main_message')} LIKE ?
        OR ${dashInsensitive('c.marketing_objective')} LIKE ?
        OR ${dashInsensitive('c.primary_audience_description')} LIKE ?
        OR ${dashInsensitive('c.central_idea')} LIKE ?
        OR JSON_SEARCH(c.products, 'one', ?) IS NOT NULL
        OR JSON_SEARCH(c.channels, 'one', ?) IS NOT NULL
        OR JSON_SEARCH(c.headlines, 'one', ?) IS NOT NULL
        OR JSON_SEARCH(c.activation_examples, 'one', ?) IS NOT NULL
      )`);
      const like = `%${normalizeDashes(q)}%`;
      const raw = `%${q}%`;
      params.push(like, like, like, like, like, raw, raw, raw, raw);
    }
    if (req.query.status) {
      filters.push('st.code = ?');
      params.push(String(req.query.status));
    }
    if (req.query.type) {
      filters.push('ct.code = ?');
      params.push(String(req.query.type));
    }
    if (req.query.pillar) {
      filters.push('p.code = ?');
      params.push(String(req.query.pillar));
    }
    if (req.query.strategyVersion) {
      filters.push('sv.external_key = ?');
      params.push(String(req.query.strategyVersion));
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const total = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM campaigns c
         JOIN campaign_types ct ON ct.id = c.campaign_type_id
         JOIN campaign_statuses st ON st.id = c.status_id
         JOIN strategic_pillars p ON p.id = c.pillar_id
         JOIN strategy_versions sv ON sv.id = c.strategy_version_id
       ${where}`,
      params,
    );

    const rows = await queryRows(
      `${LIST_SELECT} ${where} ORDER BY c.external_key ${limitClause(pageSize, offset)}`,
      params,
    );

    const unfiltered = await queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM campaigns WHERE deleted_at IS NULL',
    );

    sendData(res, rows, {
      ...pageMeta(total?.total ?? 0, page, pageSize),
      // Unfiltered count, so the screen can render "N din M campanii".
      totalUnfiltered: unfiltered?.total ?? 0,
    });
  }),
);

/** Full canonical campaign, rebuilt from the relational tables. */
campaignRouter.get(
  '/campaigns/:externalKey',
  requireAuth,
  asyncHandler(async (req, res) => {
    const campaign = await loadCampaignDetail(String(req.params.externalKey));
    if (!campaign) throw ApiError.notFound('Campania nu a fost găsită.');
    // ETag carries version_number; the editor returns it as If-Match on save.
    res.setHeader('ETag', `"${campaign.versionNumber}"`);
    sendData(res, campaign);
  }),
);

/**
 * Create. ADMIN and EDITOR only — VIEWER is read-only and is rejected here, not
 * merely by hiding the button in React (rule 67.10).
 */
campaignRouter.post(
  '/campaigns',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    const parsed = CampaignInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele campaniei nu sunt valide.', parsed.error.issues);
    }

    const { externalKey } = await createCampaign(parsed.data, req.user?.id ?? null);
    const campaign = await loadCampaignDetail(externalKey);
    res.status(201);
    sendData(res, campaign);
  }),
);

/**
 * Update, guarded by If-Match against `version_number`.
 * A stale value returns 409 STALE_VERSION instead of overwriting.
 */
campaignRouter.put(
  '/campaigns/:externalKey',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    const parsed = CampaignInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele campaniei nu sunt valide.', parsed.error.issues);
    }

    const ifMatch = req.header('If-Match');
    const expectedVersion = ifMatch ? Number(ifMatch.replace(/\"/g, '')) : null;
    if (ifMatch && !Number.isFinite(expectedVersion)) {
      throw ApiError.validation('Antetul If-Match nu este valid.');
    }

    const externalKey = String(req.params.externalKey);
    await updateCampaign(externalKey, parsed.data, expectedVersion, req.user?.id ?? null);
    sendData(res, await loadCampaignDetail(externalKey));
  }),
);

/** Dependency preview: what blocks deletion, and what is allowed instead. */
campaignRouter.get(
  '/campaigns/:externalKey/dependencies',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
      [String(req.params.externalKey)],
    );
    if (!row) throw ApiError.notFound('Campania nu a fost gasita.');
    sendData(res, await assessCampaignDeletion(row.id));
  }),
);

/** Soft delete, allowed only for an unused campaign. */
campaignRouter.delete(
  '/campaigns/:externalKey',
  requireWriteAccess,
  asyncHandler(async (req, res) => {
    await softDeleteCampaign(String(req.params.externalKey), req.user?.id ?? null);
    sendData(res, { id: String(req.params.externalKey), deleted: true });
  }),
);

/** Restore, ADMIN only. */
campaignRouter.post(
  '/campaigns/:externalKey/restore',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    await restoreEntity('campaigns', String(req.params.externalKey), req.user?.id ?? null);
    sendData(res, { id: String(req.params.externalKey), restored: true });
  }),
);

/** Operational activations created from this campaign (detail view, section 7). */
campaignRouter.get(
  '/campaigns/:externalKey/activations',
  requireAuth,
  asyncHandler(async (req, res) => {
    sendData(res, await loadCampaignActivations(String(req.params.externalKey)));
  }),
);

/**
 * Master data for filter dropdowns. Nothing here is hardcoded in React —
 * every list comes from the database, as required by rule 68.14.
 */
campaignRouter.get(
  '/catalogs',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const catalogs: Record<string, unknown[]> = {};

    for (const catalog of MASTER_CATALOGS) {
      catalogs[catalog] = await queryRows(
        `SELECT code, label, display_label AS displayLabel, hint, is_system AS isSystem
           FROM ${catalog} WHERE is_active = 1 ORDER BY sort_order, label`,
      );
    }

    catalogs.pillars = await queryRows(
      `SELECT p.code, p.label, p.display_label AS displayLabel
         FROM strategic_pillars p
         JOIN strategy_versions sv ON sv.id = p.strategy_version_id
        WHERE p.is_active = 1 AND sv.status = 'ACTIVE'
        ORDER BY p.sort_order`,
    );

    // Strategic reference data for the wizard's dropdowns, scoped to the
    // ACTIVE version — codes are unique per version, never globally.
    catalogs.programs = await queryRows(
      `SELECT sp.code, sp.label, sp.name AS displayLabel
         FROM strategic_programs sp
         JOIN strategy_versions sv ON sv.id = sp.strategy_version_id
        WHERE sp.is_active = 1 AND sv.status = 'ACTIVE'
        ORDER BY sp.sort_order`,
    );
    catalogs.objectives = await queryRows(
      `SELECT so.code, so.label, so.name AS displayLabel
         FROM strategic_objectives so
         JOIN strategy_versions sv ON sv.id = so.strategy_version_id
        WHERE so.is_active = 1 AND sv.status = 'ACTIVE'
        ORDER BY so.sort_order`,
    );

    sendData(res, catalogs);
  }),
);
