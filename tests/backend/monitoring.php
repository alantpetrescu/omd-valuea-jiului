<?php

/**
 * B-M-01…M05 — monitoring.
 *
 * Monitoring is append-only: every measurement is a snapshot with its own
 * timestamp, and the screens read the latest one. That shape is the whole design
 * — a table holding "current results" per material would have no history to plot
 * and no way to tell a correction from a new reading.
 *
 * The fixture is built here rather than looked for. A test database with no
 * measurements in it would make every case below skip, and a suite that reports
 * success for having found nothing to do is worse than no suite: it is a green
 * line that means nothing.
 */

declare(strict_types=1);

Harness::group('Monitorizare');

// --- Fixtura: o activare, un material, două măsurători ----------------------

$campaignKey = (string) Harness::scalar(
    "SELECT c.external_key
       FROM campaigns c
       JOIN campaign_statuses s ON s.id = c.status_id
      WHERE c.deleted_at IS NULL AND s.code = 'ACTIVE'
      LIMIT 1"
);

$created = Harness::request('POST', '/api/v1/activations', Harness::activationPayload([
    'title' => 'Activare monitorizată ' . substr(Harness::uuid(), 0, 8),
    'campaignExternalKey' => $campaignKey,
    'startDate' => '2026-02-01',
    'endDate' => '2026-02-28',
    'materials' => [['title' => 'Postare măsurată', 'channel' => 'Facebook']],
]));

$activationKey = (string) ($created['body']['data']['id'] ?? '');
Harness::check('B-M-00', 'fixtura de monitorizare a fost creată', $activationKey !== '', json_encode($created['body']));

if ($activationKey === '') {
    return;
}
Harness::track('activations', $activationKey);

$activationId = (string) Harness::scalar('SELECT id FROM activations WHERE external_key = ?', [$activationKey]);
$material = Harness::rows(
    'SELECT id, external_key FROM activation_materials WHERE activation_id = ? AND deleted_at IS NULL LIMIT 1',
    [$activationId],
)[0] ?? [];

$materialId = (string) ($material['id'] ?? '');
$materialKey = (string) ($material['external_key'] ?? '');

/** One measurement for that material, `$daysAgo` days back. */
$snapshot = static function (int $daysAgo, int $impressions) use ($activationId, $materialId): string {
    $id = Harness::uuid();
    Harness::exec(
        'INSERT INTO material_performance_snapshots
           (id, external_key, activation_id, material_id, channel_code, measurement_type,
            observed_at, provider_code, provider_label, currency, impressions, reach, clicks)
         VALUES (?, ?, ?, ?, ?, ?, DATE_SUB(CURRENT_TIMESTAMP(6), INTERVAL ? DAY), ?, ?, ?, ?, ?, ?)',
        [
            $id, 'snap-test-' . $id, $activationId, $materialId, 'FACEBOOK', 'CUMULATIVE_SNAPSHOT',
            $daysAgo, 'TEST', 'Sursă de test', 'RON', $impressions, $impressions, 10,
        ],
    );
    return $id;
};

$older = $snapshot(7, 1000);
$newer = $snapshot(1, 2500);

// --- B-M-01: ultimul instantaneu per material --------------------------------

$latest = Harness::request('GET', '/api/v1/monitoring/activations/latest');
Harness::same('B-M-01a', 'GET monitoring/activations/latest → 200', 200, $latest['status']);

$rows = $latest['body']['data'] ?? [];
Harness::check('B-M-01b', 'răspunsul este o listă', is_array($rows), gettype($rows));

/*
 * One row per material, not one per snapshot.
 *
 * The query behind this endpoint picks the newest measurement for each material.
 * A join written slightly wrong returns every measurement instead — which looks
 * right on a fresh database, where each material has exactly one, and doubles the
 * screen the first time anything is measured twice. Which is why the fixture
 * above writes two.
 */
// The endpoint names the material's external key `materialId`, which is worth
// saying out loud: `id` in this response is the snapshot's key, not the material's.
$mine = array_values(array_filter(
    $rows,
    static fn (array $row): bool => ($row['materialId'] ?? '') === $materialKey,
));

Harness::same('B-M-01c', 'materialul apare exact o dată, deși are două măsurători', 1, count($mine));

// --- B-M-02: se raportează cea mai recentă, nu prima --------------------------

$reported = $mine[0] ?? [];
$impressions = (int) ($reported['impressions'] ?? -1);

Harness::check(
    'B-M-02',
    'valoarea raportată este cea mai recentă (2500), nu cea veche (1000)',
    $impressions === 2500,
    'primit ' . $impressions . ' din câmpurile ' . json_encode(array_keys($reported)),
);

// --- B-M-03: sinteza și istoricul --------------------------------------------

$summary = Harness::request('GET', '/api/v1/monitoring/activations/summary');
Harness::same('B-M-03a', 'GET monitoring/activations/summary → 200', 200, $summary['status']);

$history = Harness::request('GET', "/api/v1/monitoring/materials/{$materialKey}/history");
Harness::same('B-M-03b', 'GET istoricul unui material → 200', 200, $history['status']);
Harness::same(
    'B-M-03c',
    'istoricul păstrează ambele măsurători',
    2,
    count($history['body']['data'] ?? []),
);

// --- B-M-04: reputația -------------------------------------------------------

$reputation = Harness::request('GET', '/api/v1/monitoring/reputation/latest');
Harness::same('B-M-04a', 'GET reputation/latest → 200', 200, $reputation['status']);

$reputationHistory = Harness::request('GET', '/api/v1/monitoring/reputation/history');
Harness::same('B-M-04b', 'GET reputation/history → 200', 200, $reputationHistory['status']);

// --- B-M-05: o măsurătoare nouă nu o suprascrie pe cea veche -----------------

$third = $snapshot(0, 4000);

Harness::same(
    'B-M-05a',
    'o măsurătoare nouă se adaugă, nu înlocuiește',
    3,
    (int) Harness::scalar(
        'SELECT COUNT(*) FROM material_performance_snapshots WHERE material_id = ?',
        [$materialId],
    ),
);

$after = Harness::request('GET', "/api/v1/monitoring/materials/{$materialKey}/history");
Harness::same('B-M-05b', 'și istoricul le arată pe toate trei', 3, count($after['body']['data'] ?? []));

// --- Curățenie ---------------------------------------------------------------

foreach ([$older, $newer, $third] as $id) {
    Harness::exec('DELETE FROM material_performance_snapshots WHERE id = ?', [$id]);
}
