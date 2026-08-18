/**
 * Monitoring API — spec sections 28 and 29.
 *
 * Performance lives in `material_performance_snapshots` as history; the
 * dashboard reads the latest snapshot per material. Derived metrics
 * (interactions, engagement, CTR, CPC, CPM) are NOT stored — the frontend
 * computes them from the raw counters, so one formula serves every screen.
 *
 * NULL is preserved end to end: a metric that was never supplied stays null and
 * must never be rendered as 0.
 */
import { Router } from 'express';

import { limitClause, queryOne, queryRows } from '../database/db';
import { requireAuth } from '../auth/middleware';
import { asyncHandler, pageMeta, readPagination, sendData } from '../shared/http';

export const monitoringRouter = Router();

/**
 * Latest snapshot per material.
 *
 * The window function keeps row 1 per material ordered by observed_at, which is
 * what "current results" means for the dashboard. Older snapshots stay in the
 * table and remain reachable through the history endpoint.
 */
const LATEST_PER_MATERIAL = `
  SELECT * FROM (
    SELECT
      s.external_key      AS id,
      s.observed_at       AS observedAt,
      s.channel_code      AS channelCode,
      s.measurement_type  AS measurementType,
      s.provider_label    AS provider,
      s.currency,
      s.impressions, s.reach, s.views, s.reactions, s.comments,
      s.shares, s.saves, s.clicks, s.spend,
      m.external_key      AS materialId,
      m.title             AS materialTitle,
      m.format_text       AS materialFormat,
      a.external_key      AS activationId,
      a.title             AS activationTitle,
      c.external_key      AS campaignId,
      c.title             AS campaignTitle,
      ROW_NUMBER() OVER (PARTITION BY s.material_id ORDER BY s.observed_at DESC) AS rn
    FROM material_performance_snapshots s
    JOIN activation_materials m ON m.id = s.material_id
    JOIN activations a ON a.id = s.activation_id
    LEFT JOIN campaigns c ON c.id = a.campaign_id
  ) ranked
`;

monitoringRouter.get(
  '/monitoring/activations/latest',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const filters = ['rn = 1'];
    const params: Array<string | number> = [];

    if (req.query.campaign) {
      filters.push('campaignId = ?');
      params.push(String(req.query.campaign));
    }
    if (req.query.activation) {
      filters.push('activationId = ?');
      params.push(String(req.query.activation));
    }
    if (req.query.channel) {
      filters.push('channelCode = ?');
      params.push(String(req.query.channel));
    }

    const where = `WHERE ${filters.join(' AND ')}`;

    const total = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM (${LATEST_PER_MATERIAL} ${where}) counted`,
      params,
    );

    const rows = await queryRows(
      `${LATEST_PER_MATERIAL} ${where} ORDER BY observedAt DESC ${limitClause(pageSize, offset)}`,
      params,
    );

    sendData(res, rows, pageMeta(total?.total ?? 0, page, pageSize));
  }),
);

/** Totals across the latest snapshots, for the dashboard header. */
monitoringRouter.get(
  '/monitoring/activations/summary',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const summary = await queryOne(
      `SELECT COUNT(*) AS materials,
              COALESCE(SUM(impressions), 0) AS impressions,
              COALESCE(SUM(reach), 0)       AS reach,
              COALESCE(SUM(clicks), 0)      AS clicks,
              COALESCE(SUM(reactions), 0)   AS reactions,
              COALESCE(SUM(comments), 0)    AS comments,
              COALESCE(SUM(shares), 0)      AS shares,
              COALESCE(SUM(saves), 0)       AS saves,
              COALESCE(SUM(spend), 0)       AS spend,
              MAX(observedAt)               AS lastObservedAt
         FROM (${LATEST_PER_MATERIAL} WHERE rn = 1) latest`,
    );

    const byChannel = await queryRows(
      `SELECT channelCode,
              COUNT(*) AS materials,
              COALESCE(SUM(impressions), 0) AS impressions,
              COALESCE(SUM(clicks), 0)      AS clicks,
              COALESCE(SUM(spend), 0)       AS spend
         FROM (${LATEST_PER_MATERIAL} WHERE rn = 1) latest
        GROUP BY channelCode ORDER BY impressions DESC`,
    );

    sendData(res, { ...summary, byChannel });
  }),
);

/** Full history for one material, newest first. */
monitoringRouter.get(
  '/monitoring/materials/:materialExternalKey/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);
    const key = String(req.params.materialExternalKey);

    const total = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM material_performance_snapshots s
         JOIN activation_materials m ON m.id = s.material_id
        WHERE m.external_key = ?`,
      [key],
    );

    const rows = await queryRows(
      `SELECT s.external_key AS id, s.observed_at AS observedAt, s.provider_label AS provider,
              s.measurement_type AS measurementType, s.currency,
              s.impressions, s.reach, s.views, s.reactions, s.comments,
              s.shares, s.saves, s.clicks, s.spend
         FROM material_performance_snapshots s
         JOIN activation_materials m ON m.id = s.material_id
        WHERE m.external_key = ?
        ORDER BY s.observed_at DESC ${limitClause(pageSize, offset)}`,
      [key],
    );

    sendData(res, rows, pageMeta(total?.total ?? 0, page, pageSize));
  }),
);

/** Most recent reputation snapshot with its themes and sources. */
monitoringRouter.get(
  '/monitoring/reputation/latest',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const snapshot = await queryOne<Record<string, unknown>>(
      `SELECT id, external_key AS externalKey, scope_type AS scopeType,
              scope_external_key AS scopeExternalKey, scope_label AS scopeLabel,
              observed_at AS observedAt, provider_label AS provider,
              mentions_count AS mentionsCount, reviews_count AS reviewsCount,
              average_rating AS averageRating, positive_share_pct AS positiveSharePct,
              neutral_share_pct AS neutralSharePct, negative_share_pct AS negativeSharePct,
              sentiment_analyzed_count AS sentimentAnalyzedCount
         FROM reputation_snapshots ORDER BY observed_at DESC LIMIT 1`,
    );

    if (!snapshot) {
      sendData(res, null);
      return;
    }

    const snapshotId = snapshot.id as string;

    const themes = await queryRows(
      `SELECT code, label, mentions_count AS mentionsCount, share_pct AS sharePct, score
         FROM reputation_theme_metrics WHERE reputation_snapshot_id = ? ORDER BY sort_order`,
      [snapshotId],
    );
    const sources = await queryRows(
      `SELECT code, label, mentions_count AS mentionsCount, share_pct AS sharePct,
              reviews_count AS reviewsCount, average_rating AS averageRating,
              positive_share_pct AS positiveSharePct
         FROM reputation_source_metrics WHERE reputation_snapshot_id = ? ORDER BY sort_order`,
      [snapshotId],
    );

    // Previous snapshot for the same scope, so the UI can show deltas.
    const previous = await queryOne(
      `SELECT observed_at AS observedAt, mentions_count AS mentionsCount,
              reviews_count AS reviewsCount, average_rating AS averageRating,
              positive_share_pct AS positiveSharePct
         FROM reputation_snapshots
        WHERE scope_type = ? AND scope_external_key = ? AND observed_at < ?
        ORDER BY observed_at DESC LIMIT 1`,
      [
        snapshot.scopeType as string,
        snapshot.scopeExternalKey as string,
        snapshot.observedAt as string,
      ],
    );

    // The internal id never leaves the backend.
    delete snapshot.id;
    sendData(res, { ...snapshot, themes, sources, previous });
  }),
);

/** Reputation history, for the trend table. */
monitoringRouter.get(
  '/monitoring/reputation/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const total = await queryOne<{ total: number }>(
      'SELECT COUNT(*) AS total FROM reputation_snapshots',
    );

    const rows = await queryRows(
      `SELECT external_key AS id, scope_label AS scopeLabel, observed_at AS observedAt,
              provider_label AS provider, mentions_count AS mentionsCount,
              reviews_count AS reviewsCount, average_rating AS averageRating,
              positive_share_pct AS positiveSharePct
         FROM reputation_snapshots
        ORDER BY observed_at DESC ${limitClause(pageSize, offset)}`,
    );

    sendData(res, rows, pageMeta(total?.total ?? 0, page, pageSize));
  }),
);
