<?php

/**
 * Monitoring imports — OMD_ACTIVATION_MONITORING_PACKAGE and
 * OMD_REPUTATION_MONITORING_PACKAGE. Port of `monitoring/monitoring-import.ts`.
 *
 * The rule that governs both (spec section 28, rule 67.7):
 *
 *   0    = measured, and the measurement was zero
 *   NULL = not supplied / not available
 *
 * A missing metric must therefore stay NULL all the way into the column. The
 * Node original says "`??` and never `||`"; the PHP equivalent is `??` and never
 * `?:`, because `?:` would turn a measured 0 into a missing value — the exact
 * bug the rule exists to prevent.
 *
 * Snapshots are history: a new quarter arrives as new external keys and never
 * overwrites an earlier observation. Re-importing the same key updates that one
 * snapshot idempotently. `spend` never touches `activations.actual_spend`.
 */

declare(strict_types=1);

namespace Omd\Monitoring;

use Omd\Database\Db;
use Omd\Imports\ImportContext;
use Omd\Support\Ids;
use RuntimeException;

final class MonitoringImport
{
    /**
     * Preserves null and preserves zero. Only a missing key becomes null.
     *
     * @param array<string,mixed> $metrics
     */
    private static function metric(array $metrics, string $name): int|float|null
    {
        $value = $metrics[$name] ?? null;
        if ($value === null) {
            return null;
        }
        return is_int($value) || is_float($value) ? $value : (float) $value;
    }

    private static function toMysqlDateTime(mixed $iso, string $where): string
    {
        $text = is_string($iso) ? trim($iso) : '';
        $timestamp = $text === '' ? false : strtotime($text);

        if ($timestamp === false) {
            throw new RuntimeException("{$where}.observedAt: dată invalidă „{$text}”.");
        }

        // Both sides are UTC; the column carries no zone of its own.
        return gmdate('Y-m-d H:i:s', $timestamp);
    }

    /** @param list<array<string,mixed>> $snapshots */
    public static function importPerformanceSnapshots(array $snapshots, ImportContext $ctx): void
    {
        foreach (array_values($snapshots) as $index => $snapshot) {
            $where = "performanceSnapshots[{$index}]";

            $activationKey = (string) ($snapshot['activationExternalKey'] ?? '');
            $activation = Db::one('SELECT id FROM activations WHERE external_key = ?', [$activationKey]);
            if ($activation === null) {
                throw new RuntimeException(
                    "{$where}.activationExternalKey: activare inexistentă ({$activationKey})."
                );
            }

            $materialKey = (string) ($snapshot['materialExternalKey'] ?? '');
            $material = Db::one(
                'SELECT id, activation_id FROM activation_materials WHERE external_key = ?',
                [$materialKey],
            );
            if ($material === null) {
                throw new RuntimeException(
                    "{$where}.materialExternalKey: material inexistent ({$materialKey})."
                );
            }
            // Spec section 31: reject a material that belongs to a different activation.
            if ((string) $material['activation_id'] !== (string) $activation['id']) {
                throw new RuntimeException(
                    "{$where}: materialul {$materialKey} nu aparține activării {$activationKey}."
                );
            }

            $channelCode = (string) ($snapshot['channelCode'] ?? '');
            $channel = Db::one('SELECT code FROM activation_channels WHERE code = ?', [$channelCode]);
            if ($channel === null) {
                throw new RuntimeException("{$where}.channelCode: canal inexistent ({$channelCode}).");
            }

            $metrics = is_array($snapshot['metrics'] ?? null) ? $snapshot['metrics'] : [];

            $values = [
                (string) $activation['id'],
                (string) $material['id'],
                $channelCode,
                $snapshot['platformExternalId'] ?? null,
                $snapshot['measurementType'] ?? '',
                self::toMysqlDateTime($snapshot['observedAt'] ?? null, $where),
                $snapshot['provider']['code'] ?? '',
                $snapshot['provider']['label'] ?? '',
                $snapshot['provider']['recordId'] ?? null,
                $snapshot['currency'] ?? 'RON',
                self::metric($metrics, 'impressions'),
                self::metric($metrics, 'reach'),
                self::metric($metrics, 'views'),
                self::metric($metrics, 'reactions'),
                self::metric($metrics, 'comments'),
                self::metric($metrics, 'shares'),
                self::metric($metrics, 'saves'),
                self::metric($metrics, 'clicks'),
                self::metric($metrics, 'spend'),
                $ctx->batchId,
            ];

            $externalKey = (string) $snapshot['externalKey'];
            $existing = Db::one(
                'SELECT id FROM material_performance_snapshots WHERE external_key = ?',
                [$externalKey],
            );

            if ($existing !== null) {
                Db::execute(
                    'UPDATE material_performance_snapshots
                        SET activation_id = ?, material_id = ?, channel_code = ?, platform_external_id = ?,
                            measurement_type = ?, observed_at = ?, provider_code = ?, provider_label = ?,
                            provider_record_id = ?, currency = ?, impressions = ?, reach = ?, views = ?,
                            reactions = ?, comments = ?, shares = ?, saves = ?, clicks = ?, spend = ?,
                            import_batch_id = ?
                      WHERE id = ?',
                    [...$values, $existing['id']],
                );
                $ctx->recordItem(
                    'material_performance_snapshots',
                    $externalKey,
                    (string) $existing['id'],
                    ImportContext::UPDATE,
                );
            } else {
                $id = Ids::newId();
                Db::execute(
                    sprintf(
                        'INSERT INTO material_performance_snapshots
                           (id, external_key, activation_id, material_id, channel_code, platform_external_id,
                            measurement_type, observed_at, provider_code, provider_label, provider_record_id,
                            currency, impressions, reach, views, reactions, comments, shares, saves, clicks,
                            spend, import_batch_id)
                         VALUES (?, ?, %s)',
                        implode(', ', array_fill(0, count($values), '?')),
                    ),
                    [$id, $externalKey, ...$values],
                );
                $ctx->recordItem('material_performance_snapshots', $externalKey, $id, ImportContext::CREATE);
            }
        }
    }

    /** @param list<array<string,mixed>> $snapshots */
    public static function importReputationSnapshots(array $snapshots, ImportContext $ctx): void
    {
        foreach (array_values($snapshots) as $index => $snapshot) {
            $where = "reputationSnapshots[{$index}]";
            $metrics = is_array($snapshot['metrics'] ?? null) ? $snapshot['metrics'] : [];

            $values = [
                $snapshot['scope']['type'] ?? 'DESTINATION',
                $snapshot['scope']['externalKey'] ?? '',
                $snapshot['scope']['label'] ?? '',
                self::toMysqlDateTime($snapshot['observedAt'] ?? null, $where),
                $snapshot['provider']['code'] ?? '',
                $snapshot['provider']['label'] ?? '',
                $snapshot['provider']['recordId'] ?? null,
                self::metric($metrics, 'mentionsCount'),
                self::metric($metrics, 'reviewsCount'),
                self::metric($metrics, 'averageRating'),
                self::metric($metrics, 'positiveSharePct'),
                self::metric($metrics, 'neutralSharePct'),
                self::metric($metrics, 'negativeSharePct'),
                self::metric($metrics, 'sentimentAnalyzedCount'),
                $ctx->batchId,
            ];

            $externalKey = (string) $snapshot['externalKey'];
            $existing = Db::one('SELECT id FROM reputation_snapshots WHERE external_key = ?', [$externalKey]);

            if ($existing !== null) {
                $snapshotId = (string) $existing['id'];
                Db::execute(
                    'UPDATE reputation_snapshots
                        SET scope_type = ?, scope_external_key = ?, scope_label = ?, observed_at = ?,
                            provider_code = ?, provider_label = ?, provider_record_id = ?,
                            mentions_count = ?, reviews_count = ?, average_rating = ?, positive_share_pct = ?,
                            neutral_share_pct = ?, negative_share_pct = ?, sentiment_analyzed_count = ?,
                            import_batch_id = ?
                      WHERE id = ?',
                    [...$values, $snapshotId],
                );
                $ctx->recordItem('reputation_snapshots', $externalKey, $snapshotId, ImportContext::UPDATE);
            } else {
                $snapshotId = Ids::newId();
                Db::execute(
                    sprintf(
                        'INSERT INTO reputation_snapshots
                           (id, external_key, scope_type, scope_external_key, scope_label, observed_at,
                            provider_code, provider_label, provider_record_id, mentions_count, reviews_count,
                            average_rating, positive_share_pct, neutral_share_pct, negative_share_pct,
                            sentiment_analyzed_count, import_batch_id)
                         VALUES (?, ?, %s)',
                        implode(', ', array_fill(0, count($values), '?')),
                    ),
                    [$snapshotId, $externalKey, ...$values],
                );
                $ctx->recordItem('reputation_snapshots', $externalKey, $snapshotId, ImportContext::CREATE);
            }

            // Children are reconciled per snapshot; the FK cascades, so a clean
            // replace is safe and keeps ordering meaningful.
            Db::execute(
                'DELETE FROM reputation_theme_metrics WHERE reputation_snapshot_id = ?',
                [$snapshotId],
            );
            foreach (array_values($snapshot['themes'] ?? []) as $position => $theme) {
                Db::execute(
                    'INSERT INTO reputation_theme_metrics
                       (reputation_snapshot_id, code, label, mentions_count, share_pct, score, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [
                        $snapshotId,
                        $theme['code'] ?? '',
                        $theme['label'] ?? '',
                        self::metric($theme, 'mentionsCount'),
                        self::metric($theme, 'sharePct'),
                        self::metric($theme, 'score'),
                        $position,
                    ],
                );
            }

            Db::execute(
                'DELETE FROM reputation_source_metrics WHERE reputation_snapshot_id = ?',
                [$snapshotId],
            );
            foreach (array_values($snapshot['sources'] ?? []) as $position => $source) {
                Db::execute(
                    'INSERT INTO reputation_source_metrics
                       (reputation_snapshot_id, code, label, mentions_count, share_pct, reviews_count,
                        average_rating, positive_share_pct, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $snapshotId,
                        $source['code'] ?? '',
                        $source['label'] ?? '',
                        self::metric($source, 'mentionsCount'),
                        self::metric($source, 'sharePct'),
                        self::metric($source, 'reviewsCount'),
                        self::metric($source, 'averageRating'),
                        self::metric($source, 'positiveSharePct'),
                        $position,
                    ],
                );
            }
        }
    }
}
