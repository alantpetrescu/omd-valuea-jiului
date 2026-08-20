<?php

/**
 * Monitoring API — port of `monitoring/monitoring-routes.ts`.
 *
 * Performance lives in `material_performance_snapshots` as history; the
 * dashboard reads the latest snapshot per material. Derived metrics
 * (interactions, engagement, CTR, CPC, CPM) are NOT stored — the frontend
 * computes them from the raw counters, so one formula serves every screen.
 *
 * NULL is preserved end to end: a metric that was never supplied stays null and
 * must never be rendered as 0. That is why every counter goes through
 * `Db::int()` rather than being cast with `(int)`, which would turn a missing
 * measurement into a measured zero.
 */

declare(strict_types=1);

namespace Omd\Monitoring;

use Omd\Auth\Guard;
use Omd\Database\Db;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;

final class MonitoringRoutes
{
    /**
     * Latest snapshot per material.
     *
     * The window function keeps row 1 per material ordered by observed_at,
     * which is what "current results" means for the dashboard. Older snapshots
     * stay in the table and remain reachable through the history endpoint.
     */
    private const LATEST_PER_MATERIAL = <<<'SQL'
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
        SQL;

    /** The raw counters, each nullable. */
    private const METRICS = [
        'impressions', 'reach', 'views', 'reactions', 'comments', 'shares', 'saves', 'clicks',
    ];

    public static function register(Router $router): void
    {
        $auth = [[Guard::class, 'requireAuth']];

        $router->get('/api/v1/monitoring/activations/latest', [self::class, 'latest'], $auth);
        $router->get('/api/v1/monitoring/activations/summary', [self::class, 'summary'], $auth);
        $router->get('/api/v1/monitoring/materials/:materialExternalKey/history', [self::class, 'history'], $auth);
        $router->get('/api/v1/monitoring/reputation/latest', [self::class, 'reputationLatest'], $auth);
        $router->get('/api/v1/monitoring/reputation/history', [self::class, 'reputationHistory'], $auth);
    }

    /** @param array<string,mixed> $row */
    private static function castMetrics(array $row): array
    {
        foreach (self::METRICS as $metric) {
            if (array_key_exists($metric, $row)) {
                $row[$metric] = Db::int($row[$metric]);
            }
        }
        if (array_key_exists('spend', $row)) {
            $row['spend'] = Db::decimal($row['spend']);
        }
        unset($row['rn']);
        return $row;
    }

    public static function latest(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $filters = ['rn = 1'];
        $params = [];

        foreach (['campaign' => 'campaignId = ?', 'activation' => 'activationId = ?', 'channel' => 'channelCode = ?'] as $key => $clause) {
            $value = $request->queryString($key);
            if ($value !== '') {
                $filters[] = $clause;
                $params[] = $value;
            }
        }

        $where = 'WHERE ' . implode(' AND ', $filters);

        $total = Db::count(
            'SELECT COUNT(*) FROM (' . self::LATEST_PER_MATERIAL . ' ' . $where . ') counted',
            $params,
        );

        $rows = Db::rows(
            self::LATEST_PER_MATERIAL . ' ' . $where
            . ' ORDER BY observedAt DESC ' . Db::limit($pageSize, $offset),
            $params,
        );

        Response::data(
            array_map([self::class, 'castMetrics'], $rows),
            Response::pageMeta($total, $page, $pageSize),
        );
    }

    /** Totals across the latest snapshots, for the dashboard header. */
    public static function summary(Request $request): void
    {
        $summary = Db::one(
            'SELECT COUNT(*) AS materials,
                    COALESCE(SUM(impressions), 0) AS impressions,
                    COALESCE(SUM(reach), 0)       AS reach,
                    COALESCE(SUM(clicks), 0)      AS clicks,
                    COALESCE(SUM(reactions), 0)   AS reactions,
                    COALESCE(SUM(comments), 0)    AS comments,
                    COALESCE(SUM(shares), 0)      AS shares,
                    COALESCE(SUM(saves), 0)       AS saves,
                    COALESCE(SUM(spend), 0)       AS spend,
                    MAX(observedAt)               AS lastObservedAt
               FROM (' . self::LATEST_PER_MATERIAL . ' WHERE rn = 1) latest'
        ) ?? [];

        // These are COALESCE-d sums over a filtered set, so 0 is a real total
        // rather than a missing measurement — plain casts are correct here.
        $summary['materials'] = (int) ($summary['materials'] ?? 0);
        foreach (['impressions', 'reach', 'clicks', 'reactions', 'comments', 'shares', 'saves'] as $key) {
            $summary[$key] = (int) ($summary[$key] ?? 0);
        }
        $summary['spend'] = Db::decimal($summary['spend'] ?? null);

        $byChannel = Db::rows(
            'SELECT channelCode,
                    COUNT(*) AS materials,
                    COALESCE(SUM(impressions), 0) AS impressions,
                    COALESCE(SUM(clicks), 0)      AS clicks,
                    COALESCE(SUM(spend), 0)       AS spend
               FROM (' . self::LATEST_PER_MATERIAL . ' WHERE rn = 1) latest
              GROUP BY channelCode ORDER BY impressions DESC'
        );
        foreach ($byChannel as &$channel) {
            $channel['materials'] = (int) $channel['materials'];
            $channel['impressions'] = (int) $channel['impressions'];
            $channel['clicks'] = (int) $channel['clicks'];
            $channel['spend'] = Db::decimal($channel['spend']);
        }
        unset($channel);

        Response::data($summary + ['byChannel' => $byChannel]);
    }

    /** Full history for one material, newest first. */
    public static function history(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);
        $key = $request->param('materialExternalKey');

        $total = Db::count(
            'SELECT COUNT(*) FROM material_performance_snapshots s
               JOIN activation_materials m ON m.id = s.material_id
              WHERE m.external_key = ?',
            [$key],
        );

        $rows = Db::rows(
            'SELECT s.external_key AS id, s.observed_at AS observedAt, s.provider_label AS provider,
                    s.measurement_type AS measurementType, s.currency,
                    s.impressions, s.reach, s.views, s.reactions, s.comments,
                    s.shares, s.saves, s.clicks, s.spend
               FROM material_performance_snapshots s
               JOIN activation_materials m ON m.id = s.material_id
              WHERE m.external_key = ?
              ORDER BY s.observed_at DESC ' . Db::limit($pageSize, $offset),
            [$key],
        );

        Response::data(
            array_map([self::class, 'castMetrics'], $rows),
            Response::pageMeta($total, $page, $pageSize),
        );
    }

    /** Most recent reputation snapshot with its themes and sources. */
    public static function reputationLatest(Request $request): void
    {
        $snapshot = Db::one(
            'SELECT id, external_key AS externalKey, scope_type AS scopeType,
                    scope_external_key AS scopeExternalKey, scope_label AS scopeLabel,
                    observed_at AS observedAt, provider_label AS provider,
                    mentions_count AS mentionsCount, reviews_count AS reviewsCount,
                    average_rating AS averageRating, positive_share_pct AS positiveSharePct,
                    neutral_share_pct AS neutralSharePct, negative_share_pct AS negativeSharePct,
                    sentiment_analyzed_count AS sentimentAnalyzedCount
               FROM reputation_snapshots ORDER BY observed_at DESC LIMIT 1'
        );

        if ($snapshot === null) {
            Response::data(null);
            return;
        }

        $snapshotId = (string) $snapshot['id'];

        $themes = Db::rows(
            'SELECT code, label, mentions_count AS mentionsCount, share_pct AS sharePct, score
               FROM reputation_theme_metrics WHERE reputation_snapshot_id = ? ORDER BY sort_order',
            [$snapshotId],
        );
        foreach ($themes as &$theme) {
            $theme['mentionsCount'] = Db::int($theme['mentionsCount']);
            $theme['sharePct'] = Db::decimal($theme['sharePct']);
            $theme['score'] = Db::decimal($theme['score']);
        }
        unset($theme);

        $sources = Db::rows(
            'SELECT code, label, mentions_count AS mentionsCount, share_pct AS sharePct,
                    reviews_count AS reviewsCount, average_rating AS averageRating,
                    positive_share_pct AS positiveSharePct
               FROM reputation_source_metrics WHERE reputation_snapshot_id = ? ORDER BY sort_order',
            [$snapshotId],
        );
        foreach ($sources as &$source) {
            $source['mentionsCount'] = Db::int($source['mentionsCount']);
            $source['reviewsCount'] = Db::int($source['reviewsCount']);
            $source['sharePct'] = Db::decimal($source['sharePct']);
            $source['averageRating'] = Db::decimal($source['averageRating']);
            $source['positiveSharePct'] = Db::decimal($source['positiveSharePct']);
        }
        unset($source);

        // Previous snapshot for the same scope, so the UI can show deltas.
        $previous = Db::one(
            'SELECT observed_at AS observedAt, mentions_count AS mentionsCount,
                    reviews_count AS reviewsCount, average_rating AS averageRating,
                    positive_share_pct AS positiveSharePct
               FROM reputation_snapshots
              WHERE scope_type = ? AND scope_external_key = ? AND observed_at < ?
              ORDER BY observed_at DESC LIMIT 1',
            [$snapshot['scopeType'], $snapshot['scopeExternalKey'], $snapshot['observedAt']],
        );
        if ($previous !== null) {
            $previous['mentionsCount'] = Db::int($previous['mentionsCount']);
            $previous['reviewsCount'] = Db::int($previous['reviewsCount']);
            $previous['averageRating'] = Db::decimal($previous['averageRating']);
            $previous['positiveSharePct'] = Db::decimal($previous['positiveSharePct']);
        }

        $snapshot['mentionsCount'] = Db::int($snapshot['mentionsCount']);
        $snapshot['reviewsCount'] = Db::int($snapshot['reviewsCount']);
        $snapshot['sentimentAnalyzedCount'] = Db::int($snapshot['sentimentAnalyzedCount']);
        foreach (['averageRating', 'positiveSharePct', 'neutralSharePct', 'negativeSharePct'] as $key) {
            $snapshot[$key] = Db::decimal($snapshot[$key]);
        }

        // The internal id never leaves the backend.
        unset($snapshot['id']);

        Response::data($snapshot + ['themes' => $themes, 'sources' => $sources, 'previous' => $previous]);
    }

    /** Reputation history, for the trend table. */
    public static function reputationHistory(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $total = Db::count('SELECT COUNT(*) FROM reputation_snapshots');

        $rows = Db::rows(
            'SELECT external_key AS id, scope_label AS scopeLabel, observed_at AS observedAt,
                    provider_label AS provider, mentions_count AS mentionsCount,
                    reviews_count AS reviewsCount, average_rating AS averageRating,
                    positive_share_pct AS positiveSharePct
               FROM reputation_snapshots
              ORDER BY observed_at DESC ' . Db::limit($pageSize, $offset)
        );
        foreach ($rows as &$row) {
            $row['mentionsCount'] = Db::int($row['mentionsCount']);
            $row['reviewsCount'] = Db::int($row['reviewsCount']);
            $row['averageRating'] = Db::decimal($row['averageRating']);
            $row['positiveSharePct'] = Db::decimal($row['positiveSharePct']);
        }
        unset($row);

        Response::data($rows, Response::pageMeta($total, $page, $pageSize));
    }
}
