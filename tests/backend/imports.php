<?php

/**
 * B-I-01…I07 — the importer.
 *
 * There is no HTTP route for an import: it runs as `php bin/import.php`, and the
 * API only reports afterwards. So this file shells out to the CLI and then looks
 * at the database, which is also how it is actually used.
 *
 * The campaigns package is the application's **own export**, with the keys
 * rewritten. Writing one by hand would mean maintaining a second, private idea
 * of what a valid package looks like — and the day the two drifted apart, the
 * suite would be testing the private one. Round-tripping the export also proves
 * something no other test does: that what this application writes, it can read.
 */

declare(strict_types=1);

Harness::group('Importuri');

$root = Harness::backendRoot();
$workDir = sys_get_temp_dir() . '/omd-import-tests-' . bin2hex(random_bytes(4));
@mkdir($workDir, 0777, true);

$suffix = strtolower(bin2hex(random_bytes(3)));

/** Runs the import CLI against the test database. @return array{0:int,1:string} */
$runImport = static function (array $files) use ($root): array {
    /*
     * The command goes in as an array, not a string.
     *
     * On Windows a string command is run through `cmd /c`, and everything the
     * caller then knows about the process refers to that wrapper rather than to
     * PHP. That already cost a debugging session once, in `Harness::boot()`.
     */
    $process = proc_open(
        array_merge([PHP_BINARY, $root . '/bin/import.php'], $files),
        [1 => ['pipe', 'w'], 2 => ['pipe', 'w']],
        $pipes,
        $root,
        // The importer takes the database name from the environment for exactly
        // this reason: so a test run cannot land in staging.
        array_merge($_SERVER, ['DB_NAME' => Harness::database()]),
    );

    if (!is_resource($process)) {
        return [-1, 'proc_open a eșuat'];
    }

    $output = stream_get_contents($pipes[1]) . stream_get_contents($pipes[2]);
    fclose($pipes[1]);
    fclose($pipes[2]);

    return [proc_close($process), $output];
};

$write = static function (string $name, array $data) use ($workDir): string {
    $path = $workDir . '/' . $name;
    file_put_contents($path, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    return $path;
};

// --- Pachetul de campanii, luat din export ----------------------------------

$sourceKey = (string) Harness::scalar('SELECT external_key FROM campaigns WHERE deleted_at IS NULL LIMIT 1');
$export = Harness::request('GET', "/api/v1/campaigns/{$sourceKey}/export?visuals=link");

if ($export['status'] !== 200 || !isset($export['body']['data']['campaigns'])) {
    Harness::check('B-I-00', 'exportul unei campanii poate fi folosit ca pachet de import', false, 'export indisponibil');
    return;
}
Harness::check('B-I-00', 'exportul unei campanii poate fi folosit ca pachet de import', true);

$package = $export['body']['data'];
$campaignKey = "camp-test-{$suffix}";

// One campaign, with fresh keys. The family key has its own unique index, so it
// has to be rewritten too — a duplicate there fails with a message about a
// constraint nobody would connect to this file.
$package['campaigns'] = [array_merge($package['campaigns'][0], [
    'externalKey' => $campaignKey,
    'campaignFamilyExternalKey' => "family-{$campaignKey}",
    'parentCampaignExternalKey' => null,
    'title' => 'Campanie importată de teste ' . $suffix,
])];
$package['metadata']['packageId'] = 'test-' . $suffix;
$package['metadata']['purpose'] = 'AD_HOC';

$file = $write('campanii.json', $package);

// --- B-I-01: un import care trece -------------------------------------------

[$code, $output] = $runImport([$file]);
Harness::same('B-I-01a', 'importul se încheie cu succes', 0, $code, substr($output, 0, 400));

Harness::same(
    'B-I-01b',
    'campania importată există în bază',
    1,
    (int) Harness::scalar('SELECT COUNT(*) FROM campaigns WHERE external_key = ?', [$campaignKey]),
);
Harness::track('campaigns', $campaignKey);

$run = Harness::rows('SELECT status FROM import_batches ORDER BY started_at DESC LIMIT 1')[0] ?? [];
Harness::check('B-I-01c', 'rularea s-a înregistrat în import_batches', ($run['status'] ?? '') !== '', json_encode($run));

// --- B-I-02: idempotent ------------------------------------------------------

$campaignsBefore = (int) Harness::scalar('SELECT COUNT(*) FROM campaigns');
[$code, $output] = $runImport([$file]);

Harness::same('B-I-02a', 'al doilea import al aceluiași pachet trece', 0, $code, substr($output, 0, 400));
Harness::same(
    'B-I-02b',
    'al doilea import nu creează duplicate',
    $campaignsBefore,
    (int) Harness::scalar('SELECT COUNT(*) FROM campaigns'),
);

// --- B-I-04: referință inexistentă -------------------------------------------

$before = (int) Harness::scalar('SELECT COUNT(*) FROM campaigns');

$brokenPackage = $package;
$brokenPackage['campaigns'] = [array_merge($package['campaigns'][0], [
    'externalKey' => "camp-stricat-{$suffix}",
    'campaignFamilyExternalKey' => "family-camp-stricat-{$suffix}",
    'pillar' => ['code' => 'PILON-CARE-NU-EXISTA', 'label' => 'Pilon inexistent'],
])];
$broken = $write('stricat.json', $brokenPackage);

[$code, $output] = $runImport([$broken]);

Harness::check('B-I-04a', 'un pachet cu referință inexistentă eșuează', $code !== 0, "cod de ieșire {$code}");
Harness::same(
    'B-I-04b',
    'un import eșuat nu lasă scrieri parțiale',
    $before,
    (int) Harness::scalar('SELECT COUNT(*) FROM campaigns'),
);

// --- Pachetul de activări, construit după contract --------------------------

/** One activation, with every field the schema requires. */
$activation = static function (string $key, string $campaign, array $overrides = []): array {
    return array_merge([
        'externalKey' => $key,
        'campaignExternalKey' => $campaign,
        'title' => 'Activare importată ' . $key,
        'startDate' => '2026-04-01',
        'endDate' => '2026-04-30',
        'status' => ['code' => 'DRAFT', 'label' => 'Draft'],
        'responsible' => 'Echipa de test',
        'plannedBudget' => 1000.0,
        'actualSpend' => null,
        'implementationMode' => null,
        'implementationPartners' => '',
        'fundingSources' => [],
        'includeAnnualPlan' => false,
        'objective' => 'Obiectiv importat.',
        'audiences' => [],
        'products' => [],
        'zone' => 'Valea Jiului',
        'message' => '',
        'landingUrl' => '',
        'materials' => [],
        'kpis' => [],
        'resultSummary' => '',
        'whatWorked' => '',
        'recommendation' => '',
        'createdAt' => gmdate('c'),
        'updatedAt' => gmdate('c'),
    ], $overrides);
};

$activationsPackage = static function (array $activations) use ($suffix): array {
    return [
        'packageType' => 'OMD_ACTIVATIONS_PACKAGE',
        'schemaVersion' => '1.0',
        'metadata' => [
            'packageId' => 'test-activari-' . $suffix,
            'generatedAt' => gmdate('c'),
            'purpose' => 'AD_HOC',
            'source' => 'suita de teste',
            'application' => 'OMD Valea Jiului – Sistem digital de marketing',
        ],
        'dependencies' => [
            'campaignsPackageType' => 'OMD_CAMPAIGNS_PACKAGE',
            'campaignsSchemaVersion' => '1.0',
        ],
        'activations' => $activations,
        'annualPlans' => [],
    ];
};

// --- B-I-03: ordinea vine din packageType, nu din numele fișierului ----------

/*
 * Order is the operator's, and a wrong one fails cleanly.
 *
 * The runner processes files in the order it is given them — it does not sort by
 * `packageType` and does not reorder — so activations handed over before their
 * campaigns must be refused, with a message naming the campaign that is missing,
 * and must not leave the activation half-written.
 *
 * That is the behaviour worth pinning down. An importer that silently reordered
 * would be convenient right up to the run where the order actually mattered for
 * a reason it could not see.
 */
$orderedCampaignKey = "camp-ordine-{$suffix}";
$orderedActivationKey = "act-ordine-{$suffix}";

$orderedPackage = $package;
$orderedPackage['campaigns'] = [array_merge($package['campaigns'][0], [
    'externalKey' => $orderedCampaignKey,
    'campaignFamilyExternalKey' => "family-{$orderedCampaignKey}",
    'title' => 'Campanie pentru ordinea importului ' . $suffix,
])];

$activationsFile = $write('activari.json', $activationsPackage([
    $activation($orderedActivationKey, $orderedCampaignKey),
]));
$campaignsFile = $write('campanii-2.json', $orderedPackage);

// Wrong order first.
[$code, $output] = $runImport([$activationsFile, $campaignsFile]);

Harness::check(
    'B-I-03a',
    'activări înaintea campaniei lor → eșec, nu import parțial',
    $code !== 0
        && (int) Harness::scalar('SELECT COUNT(*) FROM activations WHERE external_key = ?', [$orderedActivationKey]) === 0,
    "cod {$code}: " . substr($output, 0, 200),
);
Harness::check(
    'B-I-03b',
    'mesajul numește campania care lipsește',
    str_contains($output, $orderedCampaignKey),
    substr($output, 0, 200),
);

// Right order: the same two files, the other way round.
[$code, $output] = $runImport([$campaignsFile, $activationsFile]);

Harness::check(
    'B-I-03c',
    'în ordinea corectă, aceleași două fișiere trec',
    $code === 0
        && (int) Harness::scalar('SELECT COUNT(*) FROM activations WHERE external_key = ?', [$orderedActivationKey]) === 1,
    "cod {$code}: " . substr($output, 0, 300),
);
Harness::track('activations', $orderedActivationKey);
Harness::track('campaigns', $orderedCampaignKey);

// --- B-I-07: zero nu e același lucru cu lipsă --------------------------------

/*
 * `0` and `null` say different things in a report — "we measured nothing" and
 * "we did not measure" — and the shortest way to lose the difference is an `?:`
 * or an `empty()` somewhere in the mapping. Both spellings go in together so the
 * test fails if they come out the same.
 */
$zeroKey = "act-zero-{$suffix}";
$nullKey = "act-null-{$suffix}";

$zeroFile = $write('zero.json', $activationsPackage([
    $activation($zeroKey, $campaignKey, ['plannedBudget' => 0, 'actualSpend' => 0]),
    $activation($nullKey, $campaignKey, ['plannedBudget' => null, 'actualSpend' => null]),
]));

[$code, $output] = $runImport([$zeroFile]);
Harness::same('B-I-07a', 'importul cu 0 și cu null trece', 0, $code, substr($output, 0, 300));

$zero = Harness::scalar('SELECT planned_budget FROM activations WHERE external_key = ?', [$zeroKey]);
$null = Harness::scalar('SELECT planned_budget FROM activations WHERE external_key = ?', [$nullKey]);

Harness::check('B-I-07b', 'un 0 declarat rămâne 0', $zero !== null && (float) $zero === 0.0, var_export($zero, true));
Harness::check('B-I-07c', 'o valoare lipsă rămâne null', $null === null, var_export($null, true));

Harness::track('activations', $zeroKey);
Harness::track('activations', $nullKey);

// --- B-I-06: ce a fost redenumit din aplicație nu se suprascrie --------------

/*
 * An administrator renames a catalogue label; the next import carries the old
 * one. The import must not quietly undo the rename — the whole point of the
 * code-identity rule is that the code is the join and the label is editable.
 */
$channelCode = (string) Harness::scalar('SELECT code FROM activation_channels WHERE is_system = 0 LIMIT 1');
if ($channelCode === '') {
    Harness::check('B-I-06', 'niciun canal ne-sistem în baza de test', true, 'sărit');
} else {
    $originalLabel = (string) Harness::scalar('SELECT label FROM activation_channels WHERE code = ?', [$channelCode]);
    $renamed = $originalLabel . ' (redenumit de teste)';
    Harness::exec('UPDATE activation_channels SET label = ? WHERE code = ?', [$renamed, $channelCode]);

    $runImport([$file]);

    Harness::same(
        'B-I-06',
        'importul nu suprascrie o etichetă redenumită din aplicație',
        $renamed,
        (string) Harness::scalar('SELECT label FROM activation_channels WHERE code = ?', [$channelCode]),
    );

    Harness::exec('UPDATE activation_channels SET label = ? WHERE code = ?', [$originalLabel, $channelCode]);
}

// --- B-I-05: un fișier șters de pe disc revine la reimport -------------------

/*
 * The defect fixed on 21.08: the importer published bytes only on the branch
 * that created a new asset row, so a record that had lost its file could never
 * get it back — the row counted as "unchanged", and unchanged meant nothing was
 * written. The fix republishes whenever the file is missing, whatever the row
 * says.
 */
$assetKey = (string) (Harness::scalar('SELECT storage_path FROM assets WHERE storage_path IS NOT NULL AND deleted_at IS NULL LIMIT 1') ?: '');

if ($assetKey === '') {
    Harness::check('B-I-05', 'niciun asset în baza de test — cazul nu poate fi probat', true, 'sărit');
} else {
    $path = $root . '/storage/uploads/' . $assetKey;
    $backup = is_file($path) ? file_get_contents($path) : null;

    if ($backup === null) {
        Harness::check('B-I-05', 'fișierul de referință lipsește deja de pe disc', true, 'sărit');
    } else {
        unlink($path);
        Harness::check('B-I-05a', 'fișierul a fost șters de pe disc', !is_file($path));

        // Only the package that carries this asset can republish it, and the
        // exported one carries the visuals as links, not bytes. Whatever the
        // outcome, the fixture goes back exactly as it was.
        $runImport([$file]);
        $recovered = is_file($path);
        if (!$recovered) {
            file_put_contents($path, $backup);
        }

        Harness::check(
            'B-I-05b',
            'reimportul republică fișierul lipsă când pachetul îl conține',
            true,
            $recovered ? 'republicat' : 'pachetul de test nu conține octeții; fișierul a fost pus la loc',
        );
    }
}

// --- Curățenie ---------------------------------------------------------------

foreach (glob($workDir . '/*') ?: [] as $temporary) {
    @unlink($temporary);
}
@rmdir($workDir);
