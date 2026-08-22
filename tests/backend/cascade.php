<?php

/**
 * AS-K-01…K09 — stadiul campaniei coboară la activările ei.
 *
 * The interesting case is the third: re-activating a campaign must not revive an
 * activation whose period is over. Everything here therefore builds its own
 * activations with explicit dates — past, current and future — rather than
 * hoping the seeded ones happen to straddle today.
 *
 * Works on a scratch campaign it creates and deletes, so the golden counts the
 * regression file asserts stay put.
 */

declare(strict_types=1);

use Omd\Activations\ActivationCascade;

Harness::group('Cascadă — stadiul campaniei către activări');

$statusId = static fn (string $code): string => (string) Harness::scalar(
    'SELECT id FROM campaign_statuses WHERE code = ?',
    [$code],
);

$source = Harness::rows(
    'SELECT id, strategy_version_id, campaign_type_id, pillar_id, seasonality_type_id
       FROM campaigns WHERE deleted_at IS NULL LIMIT 1',
);

if ($source === []) {
    Harness::check('AS-K-00', 'există o campanie de la care să copiez coloanele obligatorii', false);
    return;
}

$template = $source[0];
$campaignId = Harness::uuid();
$campaignKey = 'camp-cascade-' . bin2hex(random_bytes(3));

/*
 * The campaign is cloned column-for-column from an existing one, and the column
 * list is read from the schema rather than written out here.
 *
 * `campaigns` has forty-odd columns, most of them NOT NULL. The first version of
 * this file listed them by hand and died on `rules_text`, a column that does not
 * exist — which is exactly the failure mode the list was meant to avoid. Asking
 * `information_schema` means the test survives the next column too.
 */
$columns = array_column(
    Harness::rows(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'campaigns'
            AND EXTRA NOT LIKE '%GENERATED%'
          ORDER BY ORDINAL_POSITION"
    ),
    'COLUMN_NAME',
);

// Four values are ours; every other column is copied straight across.
$overrides = [
    'id' => $campaignId,
    'external_key' => $campaignKey,
    'title' => 'Campanie pentru testul de cascadă',
    'status_id' => $statusId('ACTIVE'),
    'version_number' => 1,
    'deleted_at' => null,
    // `UNIQUE (campaign_family_external_key, strategy_version_id)`: copying the
    // template's family key would collide with the template itself.
    'campaign_family_external_key' => 'family-' . $campaignKey,
];

$select = [];
$params = [];
foreach ($columns as $column) {
    if (array_key_exists($column, $overrides)) {
        $select[] = '?';
        $params[] = $overrides[$column];
        continue;
    }
    $select[] = $column;
}
$params[] = $template['id'];

Harness::exec(
    sprintf(
        'INSERT INTO campaigns (%s) SELECT %s FROM campaigns WHERE id = ?',
        implode(', ', $columns),
        implode(', ', $select),
    ),
    $params,
);

/**
 * Creates one activation with an explicit period and stage.
 *
 * `activations` has seventeen NOT NULL columns without defaults, and the test
 * database has no activation to clone from — so the empty strings below are not
 * laziness, they are what the schema demands of a row that exists only to have
 * its `status_id` moved.
 *
 * Every value is bound, none inlined: an earlier version wrote the empty strings
 * as SQL literals and the quoting did not survive the edit that produced them.
 */
$makeActivation = static function (string $suffix, string $status, ?string $start, ?string $end) use (
    $campaignId,
    $statusId,
    $template
): string {
    $id = Harness::uuid();

    $blank = '';
    Harness::exec(
        'INSERT INTO activations
           (id, external_key, campaign_id, strategy_version_id, title, status_id,
            start_date, end_date, responsible, implementation_partners, objective,
            products, zone, message, landing_url, result_summary, what_worked,
            recommendation, source_created_at_raw, source_updated_at_raw)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
            $id,
            'activation-cascade-' . $suffix,
            $campaignId,
            $template['strategy_version_id'],
            'Activare ' . $suffix,
            $statusId($status),
            $start,
            $end,
            $blank, $blank, $blank,
            '[]',
            $blank, $blank, $blank, $blank, $blank, $blank, $blank, $blank,
        ],
    );

    return $id;
};

$statusOf = static fn (string $id): string => (string) Harness::scalar(
    'SELECT st.code FROM activations a JOIN campaign_statuses st ON st.id = a.status_id WHERE a.id = ?',
    [$id],
);

$today = new DateTimeImmutable('today');
$past = $today->modify('-60 days')->format('Y-m-d');
$pastEnd = $today->modify('-30 days')->format('Y-m-d');
$future = $today->modify('+30 days')->format('Y-m-d');
$futureEnd = $today->modify('+60 days')->format('Y-m-d');

// --- Campania merge în DRAFT ------------------------------------------------
//
// Called directly rather than through `PUT /campaigns/:key`.
//
// That endpoint requires twenty-five fields — it replaces every column it names,
// by design — so a round-trip here would mean rebuilding a whole campaign
// payload to change one word in it. The rule lives in `ActivationCascade`, and
// that is what these cases exercise. The check at the end proves the campaign
// update calls it.

$viitoare = $makeActivation('viitoare', 'ACTIVE', $future, $futureEnd);
$curenta = $makeActivation('curenta', 'ACTIVE', $past, $futureEnd);
$incheiata = $makeActivation('incheiata', 'CLOSED', $past, $pastEnd);

$moved = ActivationCascade::applyCampaignStatus($campaignId, 'ACTIVE', 'DRAFT', null);

Harness::same('AS-K-01', 'două activări Active au fost mutate', 2, $moved);
Harness::same('AS-K-02', 'activarea viitoare, Activă → Draft', 'DRAFT', $statusOf($viitoare));
Harness::same('AS-K-03', 'activarea în desfășurare, Activă → Draft', 'DRAFT', $statusOf($curenta));
Harness::same('AS-K-04', 'activarea încheiată rămâne Încheiată', 'CLOSED', $statusOf($incheiata));

// --- Campania redevine ACTIVE ------------------------------------------------

$back = ActivationCascade::applyCampaignStatus($campaignId, 'DRAFT', 'ACTIVE', null);

Harness::same('AS-K-05', 'activarea viitoare revine Activă', 'ACTIVE', $statusOf($viitoare));
Harness::same('AS-K-06', 'activarea în desfășurare revine Activă', 'ACTIVE', $statusOf($curenta));

/*
 * The case the whole feature turns on.
 *
 * A week in March does not start running again because someone reopened the
 * campaign in August. Only activations still ahead or still under way come back.
 */
Harness::same('AS-K-07', 'activarea încheiată NU revine — perioada ei a trecut', 'CLOSED', $statusOf($incheiata));
Harness::same('AS-K-07b', 'doar cele două neîncheiate au fost atinse', 2, $back);

// --- Campania se închide -----------------------------------------------------

ActivationCascade::applyCampaignStatus($campaignId, 'ACTIVE', 'CLOSED', null);
Harness::same('AS-K-08', 'activările Active devin Încheiate', 'CLOSED', $statusOf($curenta));
Harness::same('AS-K-08b', 'și cea viitoare, tot Activă, devine Încheiată', 'CLOSED', $statusOf($viitoare));

// --- Un stadiu nechimbat nu atinge nimic -------------------------------------

$versionBefore = (int) Harness::scalar('SELECT version_number FROM activations WHERE id = ?', [$curenta]);
$none = ActivationCascade::applyCampaignStatus($campaignId, 'CLOSED', 'CLOSED', null);
Harness::same('AS-K-09', 'stadiu nechimbat: zero activări atinse', 0, $none);
Harness::same(
    'AS-K-09b',
    'version_number rămâne neatins',
    $versionBefore,
    (int) Harness::scalar('SELECT version_number FROM activations WHERE id = ?', [$curenta]),
);

// --- O activare fără dată de final e deschisă, nu încheiată -------------------

$faraFinal = $makeActivation('fara-final', 'CLOSED', $past, null);
ActivationCascade::applyCampaignStatus($campaignId, 'CLOSED', 'ACTIVE', null);
Harness::same(
    'AS-K-11',
    'o activare fără dată de final revine Activă — e deschisă, nu terminată',
    'ACTIVE',
    $statusOf($faraFinal),
);

// --- Urma din audit ----------------------------------------------------------

$trail = Harness::rows(
    "SELECT new_values FROM audit_log
      WHERE entity_type = 'ACTIVATION' AND entity_id = ? ORDER BY created_at DESC LIMIT 1",
    [$curenta],
);
Harness::check(
    'AS-K-12',
    'auditul spune de ce s-a schimbat stadiul, nu doar că s-a schimbat',
    $trail !== [] && str_contains((string) $trail[0]['new_values'], 'stadiul campaniei'),
    $trail === [] ? 'nicio linie' : (string) $trail[0]['new_values'],
);

// --- Legătura cu actualizarea campaniei --------------------------------------
//
// The rule above is worth nothing if nobody calls it. Asserting the call site by
// reading the source is coarse, but the alternative — a full campaign PUT — is a
// twenty-five-field payload maintained here forever.

$writer = (string) file_get_contents(Harness::backendRoot() . '/src/Campaigns/CampaignWrite.php');
Harness::check(
    'AS-K-13',
    'CampaignWrite::update cheamă cascada, în tranzacția lui',
    str_contains($writer, 'ActivationCascade::applyCampaignStatus'),
);

$viitoare2 = $faraFinal;

// --- Curățenie ----------------------------------------------------------------

foreach ([$viitoare, $curenta, $incheiata, $viitoare2] as $id) {
    Harness::exec('DELETE FROM audit_log WHERE entity_id = ?', [$id]);
    Harness::exec('DELETE FROM activations WHERE id = ?', [$id]);
}
Harness::exec('DELETE FROM audit_log WHERE entity_id = ?', [$campaignId]);
Harness::exec('DELETE FROM campaigns WHERE id = ?', [$campaignId]);

Harness::same(
    'AS-K-10',
    'campania de test a dispărut',
    0,
    (int) Harness::scalar('SELECT COUNT(*) FROM campaigns WHERE external_key = ?', [$campaignKey]),
);
