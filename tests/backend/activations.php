<?php

/**
 * B-V-01…V08 — the activation endpoints.
 *
 * Activations are the thinner half of the pair: only `title` is required, and
 * almost everything else is optional or a nested list. So the interesting cases
 * here are not "does it save the field" but the three places where an activation
 * is more than a row — materials, KPIs, and its membership in the annual plan.
 */

declare(strict_types=1);

Harness::group('Activări');

// --- B-V-01: creare și citire ------------------------------------------------

/*
 * An ACTIVE campaign, not just any campaign.
 *
 * A new activation may only be created from one — the API refuses the rest with
 * "O activare nouă poate fi creată doar dintr-o campanie cu stadiul Activă". A
 * test that grabbed the first row would pass or fail depending on the order the
 * fixture happened to be in.
 */
$campaignKey = (string) Harness::scalar(
    "SELECT c.external_key
       FROM campaigns c
       JOIN campaign_statuses s ON s.id = c.status_id
      WHERE c.deleted_at IS NULL AND s.code = 'ACTIVE'
      LIMIT 1"
);
$title = 'Activare B-V ' . substr(Harness::uuid(), 0, 8);

$created = Harness::request('POST', '/api/v1/activations', Harness::activationPayload([
    'title' => $title,
    'campaignExternalKey' => $campaignKey,
    'startDate' => '2026-03-01',
    'endDate' => '2026-03-31',
    'plannedBudget' => 12500.50,
    'zone' => 'Petroșani',
    'objective' => 'Obiectiv de test.',
]));

Harness::same('B-V-01a', 'POST valid → 201', 201, $created['status']);

$key = (string) ($created['body']['data']['id'] ?? '');
if ($key === '') {
    Harness::check('B-V-01b', 'POST întoarce cheia activării', false, json_encode($created['body']));
    return;
}
Harness::track('activations', $key);
Harness::check('B-V-01b', 'POST întoarce cheia activării', true);

$detail = Harness::request('GET', "/api/v1/activations/{$key}");
Harness::same('B-V-01c', 'GET activarea → 200', 200, $detail['status']);
Harness::same('B-V-01d', 'titlul s-a păstrat', $title, $detail['body']['data']['title'] ?? null);

/*
 * A decimal that survives the round trip.
 *
 * `plannedBudget` is DECIMAL in the schema and JSON has only doubles, so this is
 * the field where a careless cast shows up: 12500.50 coming back as 12500 or as
 * 12500.499999 both look plausible in a list and are wrong in a budget.
 */
Harness::same(
    'B-V-01e',
    'bugetul planificat se întoarce exact',
    '12500.50',
    number_format((float) Harness::scalar('SELECT planned_budget FROM activations WHERE external_key = ?', [$key]), 2, '.', ''),
);

// --- B-V-02: câmp obligatoriu ------------------------------------------------

$noTitle = Harness::request('POST', '/api/v1/activations', ['statusCode' => 'DRAFT']);
Harness::same('B-V-02', 'POST fără titlu → 422', 422, $noTitle['status']);

// --- B-V-03: materiale -------------------------------------------------------

$put = Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'campaignExternalKey' => $campaignKey,
    'materials' => [
        ['title' => 'Postare Facebook de test', 'channel' => 'Facebook'],
        ['title' => 'Reel Instagram de test', 'channel' => 'Instagram'],
    ],
]));
Harness::same('B-V-03a', 'PUT cu materiale → 200', 200, $put['status']);

$activationId = (string) Harness::scalar('SELECT id FROM activations WHERE external_key = ?', [$key]);
Harness::same(
    'B-V-03b',
    'ambele materiale s-au scris',
    2,
    (int) Harness::scalar('SELECT COUNT(*) FROM activation_materials WHERE activation_id = ? AND deleted_at IS NULL', [$activationId]),
);

// One material removed: the list is replaced, not merged.
Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'campaignExternalKey' => $campaignKey,
    'materials' => [['title' => 'Postare Facebook de test', 'channel' => 'Facebook']],
]));
Harness::same(
    'B-V-03c',
    'un material scos din listă dispare',
    1,
    (int) Harness::scalar('SELECT COUNT(*) FROM activation_materials WHERE activation_id = ? AND deleted_at IS NULL', [$activationId]),
);

// --- B-V-04: KPI -------------------------------------------------------------

Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'campaignExternalKey' => $campaignKey,
    'kpis' => [
        ['name' => 'Afișări', 'target' => '10.000 de afișări', 'result' => '2.500', 'source' => 'Meta'],
    ],
]));

$kpiCount = (int) Harness::scalar('SELECT COUNT(*) FROM activation_kpis WHERE activation_id = ? AND deleted_at IS NULL', [$activationId]);
Harness::check('B-V-04', 'KPI-urile se scriu', $kpiCount >= 1, "găsite {$kpiCount}");

// --- B-V-05: perioade --------------------------------------------------------

$badPeriod = Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'startDate' => '2026-05-10',
    'endDate' => '2026-05-01',
]));
Harness::same('B-V-05a', 'data de final înaintea celei de început → 422', 422, $badPeriod['status']);

$openEnded = Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'startDate' => '2026-05-10',
    'endDate' => null,
]));
/*
 * A missing end date is a legitimate state — an open-ended activation — not a
 * validation failure. The cascade in `cascade.php` depends on it meaning exactly
 * that, so the two files have to agree.
 */
Harness::same('B-V-05b', 'activare fără dată de final este acceptată', 200, $openEnded['status']);

// --- B-V-06: Planul anual ----------------------------------------------------

$year = 2026;
Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'startDate' => $year . '-03-01',
    'endDate' => $year . '-03-31',
    'includeAnnualPlan' => true,
]));

$inPlan = (int) Harness::scalar(
    'SELECT COUNT(*) FROM annual_plan_activations WHERE activation_id = ?',
    [$activationId],
);
Harness::check('B-V-06a', 'includeAnnualPlan adaugă activarea în plan', $inPlan === 1, "găsite {$inPlan}");

Harness::request('PUT', "/api/v1/activations/{$key}", Harness::activationPayload([
    'title' => $title,
    'startDate' => $year . '-03-01',
    'endDate' => $year . '-03-31',
    'includeAnnualPlan' => false,
]));
Harness::same(
    'B-V-06b',
    'scoaterea din plan chiar scoate rândul',
    0,
    (int) Harness::scalar('SELECT COUNT(*) FROM annual_plan_activations WHERE activation_id = ?', [$activationId]),
);

// --- B-V-07: situația în calendar nu se stochează -----------------------------

/*
 * Spec §27: whether an activation is past, current or upcoming is derived from
 * its dates at display time. If it were ever stored, every row would need a
 * nightly job to stay true, and the day that job failed the whole calendar would
 * quietly lie. The test is that the column does not exist.
 */
$columns = array_column(
    Harness::rows(
        'SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?',
        ['activations'],
    ),
    'name',
);
$stored = array_values(array_filter(
    $columns,
    static fn (string $column): bool => in_array(strtolower($column), [
        'temporal_situation', 'situation', 'calendar_situation', 'is_current', 'is_past',
    ], true),
));
Harness::check(
    'B-V-07',
    'situația în calendar nu are coloană — se calculează la afișare',
    $stored === [],
    'găsite: ' . implode(', ', $stored),
);

// --- B-V-08: statistici ------------------------------------------------------

$stats = Harness::request('GET', '/api/v1/activations/stats');
Harness::same('B-V-08a', 'GET /activations/stats → 200', 200, $stats['status']);
Harness::check(
    'B-V-08b',
    'statisticile sunt numere, nu text',
    is_array($stats['body']['data'] ?? null)
        && array_reduce(
            array_values($stats['body']['data']),
            static fn (bool $carry, mixed $value): bool => $carry && ($value === null || is_int($value) || is_float($value) || is_array($value)),
            true,
        ),
    json_encode($stats['body']['data'] ?? null),
);
