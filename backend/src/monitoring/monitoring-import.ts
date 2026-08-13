/**
 * Monitoring imports — OMD_ACTIVATION_MONITORING_PACKAGE and
 * OMD_REPUTATION_MONITORING_PACKAGE.
 *
 * The rule that governs both (spec section 28, rule 67.7):
 *
 *   0    = measured, and the measurement was zero
 *   NULL = not supplied / not available
 *
 * A missing metric must therefore stay NULL all the way into the column. In
 * JavaScript that means `??` and never `||`, and never `Number(x) || 0`.
 *
 * Snapshots are history: a new quarter arrives as new external keys and never
 * overwrites an earlier observation. Re-importing the same key updates that one
 * snapshot idempotently. `spend` never touches `activations.actual_spend`.
 */
import { execute, queryOne } from '../database/db';
import { newId } from '../shared/ids';
import type { ImportContext } from '../imports/import-context';

export interface PerformanceSnapshotPayload {
  externalKey: string;
  activationExternalKey: string;
  materialExternalKey: string;
  channelCode: string;
  platformExternalId?: string | null;
  measurementType: 'CUMULATIVE_SNAPSHOT' | 'PERIOD_TOTAL';
  observedAt: string;
  provider: { code: string; label: string; recordId?: string | null };
  currency: string;
  metrics: {
    impressions?: number | null;
    reach?: number | null;
    views?: number | null;
    reactions?: number | null;
    comments?: number | null;
    shares?: number | null;
    saves?: number | null;
    clicks?: number | null;
    spend?: number | null;
  };
}

export interface ReputationSnapshotPayload {
  externalKey: string;
  scope: { type: 'DESTINATION' | 'UAT' | 'CUSTOM'; externalKey: string; label: string };
  observedAt: string;
  provider: { code: string; label: string; recordId?: string | null };
  metrics: {
    mentionsCount?: number | null;
    reviewsCount?: number | null;
    averageRating?: number | null;
    positiveSharePct?: number | null;
    neutralSharePct?: number | null;
    negativeSharePct?: number | null;
    sentimentAnalyzedCount?: number | null;
  };
  themes?: Array<{
    code: string;
    label: string;
    mentionsCount?: number | null;
    sharePct?: number | null;
    score?: number | null;
  }>;
  sources?: Array<{
    code: string;
    label: string;
    mentionsCount?: number | null;
    sharePct?: number | null;
    reviewsCount?: number | null;
    averageRating?: number | null;
    positiveSharePct?: number | null;
  }>;
}

/** Preserves null; only undefined collapses to null. Never converts to 0. */
const metric = (value: number | null | undefined): number | null => value ?? null;

function toMysqlDateTime(iso: string, where: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${where}.observedAt: dată invalidă „${iso}”.`);
  return parsed.toISOString().replace('T', ' ').replace('Z', '');
}

export async function importPerformanceSnapshots(
  snapshots: PerformanceSnapshotPayload[],
  ctx: ImportContext,
): Promise<void> {
  for (const [index, snapshot] of snapshots.entries()) {
    const where = `performanceSnapshots[${index}]`;

    const activation = await queryOne<{ id: string }>(
      'SELECT id FROM activations WHERE external_key = ?',
      [snapshot.activationExternalKey],
      ctx.connection,
    );
    if (!activation) {
      throw new Error(`${where}.activationExternalKey: activare inexistentă (${snapshot.activationExternalKey}).`);
    }

    const material = await queryOne<{ id: string; activation_id: string }>(
      'SELECT id, activation_id FROM activation_materials WHERE external_key = ?',
      [snapshot.materialExternalKey],
      ctx.connection,
    );
    if (!material) {
      throw new Error(`${where}.materialExternalKey: material inexistent (${snapshot.materialExternalKey}).`);
    }
    // Spec section 31: reject a material that belongs to a different activation.
    if (material.activation_id !== activation.id) {
      throw new Error(
        `${where}: materialul ${snapshot.materialExternalKey} nu aparține activării ` +
          `${snapshot.activationExternalKey}.`,
      );
    }

    const channel = await queryOne<{ code: string }>(
      'SELECT code FROM activation_channels WHERE code = ?',
      [snapshot.channelCode],
      ctx.connection,
    );
    if (!channel) throw new Error(`${where}.channelCode: canal inexistent (${snapshot.channelCode}).`);

    const values = [
      activation.id,
      material.id,
      snapshot.channelCode,
      snapshot.platformExternalId ?? null,
      snapshot.measurementType,
      toMysqlDateTime(snapshot.observedAt, where),
      snapshot.provider?.code ?? '',
      snapshot.provider?.label ?? '',
      snapshot.provider?.recordId ?? null,
      snapshot.currency ?? 'RON',
      metric(snapshot.metrics?.impressions),
      metric(snapshot.metrics?.reach),
      metric(snapshot.metrics?.views),
      metric(snapshot.metrics?.reactions),
      metric(snapshot.metrics?.comments),
      metric(snapshot.metrics?.shares),
      metric(snapshot.metrics?.saves),
      metric(snapshot.metrics?.clicks),
      metric(snapshot.metrics?.spend),
      ctx.batchId,
    ];

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM material_performance_snapshots WHERE external_key = ?',
      [snapshot.externalKey],
      ctx.connection,
    );

    if (existing) {
      await execute(
        `UPDATE material_performance_snapshots
            SET activation_id = ?, material_id = ?, channel_code = ?, platform_external_id = ?,
                measurement_type = ?, observed_at = ?, provider_code = ?, provider_label = ?,
                provider_record_id = ?, currency = ?, impressions = ?, reach = ?, views = ?,
                reactions = ?, comments = ?, shares = ?, saves = ?, clicks = ?, spend = ?,
                import_batch_id = ?
          WHERE id = ?`,
        [...values, existing.id],
        ctx.connection,
      );
      await ctx.recordItem('material_performance_snapshots', snapshot.externalKey, existing.id, 'UPDATE');
    } else {
      const id = newId();
      await execute(
        `INSERT INTO material_performance_snapshots
           (id, external_key, activation_id, material_id, channel_code, platform_external_id,
            measurement_type, observed_at, provider_code, provider_label, provider_record_id, currency,
            impressions, reach, views, reactions, comments, shares, saves, clicks, spend, import_batch_id)
         VALUES (?, ?, ${values.map(() => '?').join(', ')})`,
        [id, snapshot.externalKey, ...values],
        ctx.connection,
      );
      await ctx.recordItem('material_performance_snapshots', snapshot.externalKey, id, 'CREATE');
    }
  }
}

export async function importReputationSnapshots(
  snapshots: ReputationSnapshotPayload[],
  ctx: ImportContext,
): Promise<void> {
  for (const [index, snapshot] of snapshots.entries()) {
    const where = `reputationSnapshots[${index}]`;

    const values = [
      snapshot.scope?.type ?? 'DESTINATION',
      snapshot.scope?.externalKey ?? '',
      snapshot.scope?.label ?? '',
      toMysqlDateTime(snapshot.observedAt, where),
      snapshot.provider?.code ?? '',
      snapshot.provider?.label ?? '',
      snapshot.provider?.recordId ?? null,
      metric(snapshot.metrics?.mentionsCount),
      metric(snapshot.metrics?.reviewsCount),
      metric(snapshot.metrics?.averageRating),
      metric(snapshot.metrics?.positiveSharePct),
      metric(snapshot.metrics?.neutralSharePct),
      metric(snapshot.metrics?.negativeSharePct),
      metric(snapshot.metrics?.sentimentAnalyzedCount),
      ctx.batchId,
    ];

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM reputation_snapshots WHERE external_key = ?',
      [snapshot.externalKey],
      ctx.connection,
    );

    let snapshotId: string;
    if (existing) {
      snapshotId = existing.id;
      await execute(
        `UPDATE reputation_snapshots
            SET scope_type = ?, scope_external_key = ?, scope_label = ?, observed_at = ?,
                provider_code = ?, provider_label = ?, provider_record_id = ?,
                mentions_count = ?, reviews_count = ?, average_rating = ?, positive_share_pct = ?,
                neutral_share_pct = ?, negative_share_pct = ?, sentiment_analyzed_count = ?,
                import_batch_id = ?
          WHERE id = ?`,
        [...values, snapshotId],
        ctx.connection,
      );
      await ctx.recordItem('reputation_snapshots', snapshot.externalKey, snapshotId, 'UPDATE');
    } else {
      snapshotId = newId();
      await execute(
        `INSERT INTO reputation_snapshots
           (id, external_key, scope_type, scope_external_key, scope_label, observed_at,
            provider_code, provider_label, provider_record_id, mentions_count, reviews_count,
            average_rating, positive_share_pct, neutral_share_pct, negative_share_pct,
            sentiment_analyzed_count, import_batch_id)
         VALUES (?, ?, ${values.map(() => '?').join(', ')})`,
        [snapshotId, snapshot.externalKey, ...values],
        ctx.connection,
      );
      await ctx.recordItem('reputation_snapshots', snapshot.externalKey, snapshotId, 'CREATE');
    }

    // Children are reconciled per snapshot; the FK cascades, so a clean replace
    // is safe and keeps ordering meaningful.
    await execute(
      'DELETE FROM reputation_theme_metrics WHERE reputation_snapshot_id = ?',
      [snapshotId],
      ctx.connection,
    );
    for (const [position, theme] of (snapshot.themes ?? []).entries()) {
      await execute(
        `INSERT INTO reputation_theme_metrics
           (reputation_snapshot_id, code, label, mentions_count, share_pct, score, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId, theme.code, theme.label,
          metric(theme.mentionsCount), metric(theme.sharePct), metric(theme.score), position,
        ],
        ctx.connection,
      );
    }

    await execute(
      'DELETE FROM reputation_source_metrics WHERE reputation_snapshot_id = ?',
      [snapshotId],
      ctx.connection,
    );
    for (const [position, source] of (snapshot.sources ?? []).entries()) {
      await execute(
        `INSERT INTO reputation_source_metrics
           (reputation_snapshot_id, code, label, mentions_count, share_pct, reviews_count,
            average_rating, positive_share_pct, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          snapshotId, source.code, source.label,
          metric(source.mentionsCount), metric(source.sharePct), metric(source.reviewsCount),
          metric(source.averageRating), metric(source.positiveSharePct), position,
        ],
        ctx.connection,
      );
    }
  }
}
