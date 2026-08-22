<?php

/**
 * AS-C-01…C14 — the code-identity rule applied to the ten master catalogs.
 *
 * Same rule as the strategic repere, plus one condition they do not have: a
 * value flagged `is_system` is compared by code in the application's own logic,
 * so renaming it breaks behaviour rather than only the next import.
 *
 * Works on `channels`, and only on values it creates itself — the seeded
 * catalog is a fixture the rest of the suite and the golden numbers depend on.
 */

declare(strict_types=1);

Harness::group('Nomenclatoare — identitatea codului');

$CATALOG = 'activation_channels';
$base = '/api/v1/admin/catalogs/' . $CATALOG;
$scratch = 'TEST_CANAL_' . strtoupper(bin2hex(random_bytes(3)));

/*
 * Labels carry the same suffix as the codes.
 *
 * `activation_channels` is unique on `label` too. With a fixed label, a run that
 * died before its cleanup left a row that made every later run fail on the very
 * first request — which is how that unique index was found in the first place.
 */
$labelSuffix = substr($scratch, -6);

$before = (int) Harness::scalar("SELECT COUNT(*) FROM {$CATALOG}");

// --- Creare: validează, nu transforma --------------------------------------

$created = Harness::request('POST', $base, [
    'code' => $scratch,
    'label' => "Canal creat de teste {$labelSuffix}",
    'sortOrder' => 900,
]);
Harness::same('AS-C-01', 'POST valoare nouă → 201', 201, $created['status']);

$lowercase = 'test-canal-' . bin2hex(random_bytes(3));
$lower = Harness::request('POST', $base, [
    'code' => $lowercase,
    'label' => "Cod cu litere mici {$labelSuffix}",
    'sortOrder' => 901,
]);
Harness::same('AS-C-02a', 'POST cu litere mici → 201', 201, $lower['status']);
Harness::same(
    'AS-C-02b',
    'codul este stocat exact așa cum a fost trimis — validat, nu transformat',
    $lowercase,
    (string) Harness::scalar("SELECT code FROM {$CATALOG} WHERE code = ?", [$lowercase]),
);

$empty = Harness::request('POST', $base, ['code' => '   ', 'label' => "Fără cod {$labelSuffix}"]);
Harness::same('AS-C-03', 'POST cu cod vid → 422', 422, $empty['status']);

$long = Harness::request('POST', $base, ['code' => str_repeat('X', 65), 'label' => "Cod prea lung {$labelSuffix}"]);
Harness::same('AS-C-04a', 'POST cu cod de 65 de caractere → 422', 422, $long['status']);
Harness::same(
    'AS-C-04b',
    'codul lung nu a fost trunchiat și salvat pe ascuns',
    0,
    (int) Harness::scalar("SELECT COUNT(*) FROM {$CATALOG} WHERE code LIKE 'XXXXX%'"),
);

// --- Usage raportează noile câmpuri ----------------------------------------

$usage = Harness::request('GET', $base . '/' . rawurlencode($scratch) . '/usage');
Harness::same('AS-C-05a', 'GET usage pe o valoare nouă → 200', 200, $usage['status']);
Harness::same('AS-C-05b', 'canEditCode este true pentru o valoare nefolosită', true, $usage['body']['data']['canEditCode'] ?? null);
// `array_key_exists`, not `??`: the coalescing operator fires on a null value
// as readily as on a missing key, so it cannot tell "reported as null" — which
// is what this asserts — from "not reported at all".
Harness::check(
    'AS-C-05c',
    'importedAt este raportat, și este null',
    array_key_exists('importedAt', $usage['body']['data'] ?? []) && $usage['body']['data']['importedAt'] === null,
);

// --- Redenumire ------------------------------------------------------------

$renamed = $scratch . '_R';
$rename = Harness::request('PUT', $base . '/' . rawurlencode($scratch), [
    'newCode' => $renamed,
    'label' => "Canal creat de teste {$labelSuffix}",
    'sortOrder' => 900,
]);
Harness::same('AS-C-06a', 'PUT cu newCode pe o valoare nefolosită → 200', 200, $rename['status']);
Harness::same(
    'AS-C-06b',
    'codul s-a schimbat în baza de date',
    1,
    (int) Harness::scalar("SELECT COUNT(*) FROM {$CATALOG} WHERE code = ?", [$renamed]),
);

$clash = Harness::request('PUT', $base . '/' . rawurlencode($renamed), [
    'newCode' => $lowercase,
    'label' => "Canal creat de teste {$labelSuffix}",
]);
Harness::same('AS-C-07a', 'PUT cu newCode deja existent → 409', 409, $clash['status']);
Harness::same('AS-C-07b', 'codul de eroare este CONFLICT', 'CONFLICT', Harness::errorCode($clash));

// --- Valoare de sistem ------------------------------------------------------
//
// In `campaign_statuses`, not here: the protected codes are the three campaign
// statuses the application compares by name (`DRAFT`, `ACTIVE`, `CLOSED`), and
// the channel nomenclature has none.

$systemCatalog = 'campaign_statuses';
$systemBase = '/api/v1/admin/catalogs/' . $systemCatalog;
$systemCode = Harness::scalar("SELECT code FROM {$systemCatalog} WHERE is_system = 1 LIMIT 1");
if ($systemCode !== false) {
    $systemUsage = Harness::request('GET', $systemBase . '/' . rawurlencode((string) $systemCode) . '/usage');
    Harness::same('AS-C-08a', 'usage pe o valoare de sistem: canEditCode false', false, $systemUsage['body']['data']['canEditCode'] ?? null);

    $systemRename = Harness::request('PUT', $systemBase . '/' . rawurlencode((string) $systemCode), [
        'newCode' => 'REDENUMIT_DE_TEST',
        'label' => 'Nu ar trebui să se schimbe',
    ]);
    Harness::same('AS-C-08b', 'PUT cu newCode pe o valoare de sistem → 409', 409, $systemRename['status']);
    Harness::same('AS-C-08c', 'codul de eroare este CODE_LOCKED', 'CODE_LOCKED', Harness::errorCode($systemRename));
    Harness::same(
        'AS-C-08d',
        'codul de sistem a rămas neatins',
        1,
        (int) Harness::scalar("SELECT COUNT(*) FROM {$systemCatalog} WHERE code = ?", [$systemCode]),
    );
} else {
    Harness::check('AS-C-08', 'există o valoare de sistem de testat', false, 'niciun is_system = 1');
}

// --- Valoare folosită -------------------------------------------------------
//
// A campaign type the seeded campaigns point at, rather than a channel: this
// database has campaigns but no activation materials, so manufacturing a used
// channel would have quietly skipped the whole block — which is exactly what an
// earlier version of this file did.

$usedCatalog = 'campaign_types';
$usedBase = '/api/v1/admin/catalogs/' . $usedCatalog;

/*
 * Found by asking the endpoint, not by joining a column this file would have to
 * guess the name of — and did, wrongly, the first time. `dependenciesOf()`
 * already knows every table that points at a catalog; borrowing its answer keeps
 * the test tied to the same definition the feature uses.
 */
$usedCode = false;
foreach (Harness::request('GET', $usedBase)['body']['data'] ?? [] as $candidate) {
    if (($candidate['isSystem'] ?? 0) === 1) {
        continue;
    }
    $probe = Harness::request('GET', $usedBase . '/' . rawurlencode((string) $candidate['code']) . '/usage');
    if (($probe['body']['data']['canDelete'] ?? true) === false) {
        $usedCode = (string) $candidate['code'];
        break;
    }
}

if ($usedCode !== false) {
    $usedLabel = (string) Harness::scalar("SELECT label FROM {$usedCatalog} WHERE code = ?", [$usedCode]);

    $usedUsage = Harness::request('GET', $usedBase . '/' . rawurlencode((string) $usedCode) . '/usage');
    Harness::same('AS-C-09a', 'usage pe o valoare folosită: canEditCode false', false, $usedUsage['body']['data']['canEditCode'] ?? null);
    Harness::same('AS-C-09b', 'canDelete este false', false, $usedUsage['body']['data']['canDelete'] ?? null);

    $usedRename = Harness::request('PUT', $usedBase . '/' . rawurlencode((string) $usedCode), [
        'newCode' => $usedCode . '_X',
        'label' => $usedLabel,
    ]);
    Harness::same('AS-C-10a', 'PUT cu newCode pe o valoare folosită → 409', 409, $usedRename['status']);
    Harness::same('AS-C-10b', 'codul de eroare este CODE_LOCKED', 'CODE_LOCKED', Harness::errorCode($usedRename));
    Harness::same(
        'AS-C-10c',
        'codul a rămas neatins',
        1,
        (int) Harness::scalar("SELECT COUNT(*) FROM {$usedCatalog} WHERE code = ?", [$usedCode]),
    );

    // Only the code is frozen — the rest of the value stays editable, which is
    // the whole difference between this rule and "the row is read-only".
    $labelEdit = Harness::request('PUT', $usedBase . '/' . rawurlencode((string) $usedCode), [
        'label' => 'Etichetă schimbată de teste',
    ]);
    Harness::same('AS-C-11a', 'PUT fără newCode pe o valoare folosită → 200', 200, $labelEdit['status']);
    Harness::same(
        'AS-C-11b',
        'eticheta s-a schimbat, codul nu',
        'Etichetă schimbată de teste',
        (string) Harness::scalar("SELECT label FROM {$usedCatalog} WHERE code = ?", [$usedCode]),
    );

    Harness::exec("UPDATE {$usedCatalog} SET label = ? WHERE code = ?", [$usedLabel, $usedCode]);
} else {
    Harness::check('AS-C-09', 'există o valoare de nomenclator folosită de o campanie', false, 'niciuna');
}

// --- Valoare adusă prin import ----------------------------------------------

$importedCode = Harness::scalar(
    "SELECT c.code FROM {$CATALOG} c
      WHERE c.is_system = 0
        AND EXISTS (SELECT 1 FROM import_batch_items i WHERE i.entity_id = c.id)
      LIMIT 1"
);
if ($importedCode !== false) {
    $importedUsage = Harness::request('GET', $base . '/' . rawurlencode((string) $importedCode) . '/usage');
    Harness::same('AS-C-12a', 'usage pe o valoare importată: canEditCode false', false, $importedUsage['body']['data']['canEditCode'] ?? null);
    Harness::check('AS-C-12b', 'importedAt este nenul', ($importedUsage['body']['data']['importedAt'] ?? null) !== null);
} else {
    // Simulated rather than skipped: the rule matters whether or not this
    // particular seed happens to have imported a channel.
    $syntheticId = (string) Harness::scalar("SELECT id FROM {$CATALOG} WHERE code = ?", [$lowercase]);
    $batchId = Harness::scalar('SELECT id FROM import_batches LIMIT 1');
    if ($batchId !== false) {
        $itemId = Harness::uuid();
        Harness::exec(
            "INSERT INTO import_batch_items (id, import_batch_id, entity_type, external_key, entity_id, operation, status)
             VALUES (?, ?, 'CHANNEL', ?, ?, 'CREATE', 'OK')",
            [$itemId, $batchId, $lowercase, $syntheticId],
        );

        $syntheticUsage = Harness::request('GET', $base . '/' . rawurlencode($lowercase) . '/usage');
        Harness::same('AS-C-12a', 'usage pe o valoare importată: canEditCode false', false, $syntheticUsage['body']['data']['canEditCode'] ?? null);
        Harness::check('AS-C-12b', 'importedAt este nenul', ($syntheticUsage['body']['data']['importedAt'] ?? null) !== null);

        $syntheticRename = Harness::request('PUT', $base . '/' . rawurlencode($lowercase), [
            'newCode' => $lowercase . '-x',
            'label' => 'Cod cu litere mici',
        ]);
        Harness::same('AS-C-13', 'PUT cu newCode pe o valoare importată → 409 CODE_LOCKED', 'CODE_LOCKED', Harness::errorCode($syntheticRename));

        Harness::exec('DELETE FROM import_batch_items WHERE id = ?', [$itemId]);
    }
}

// --- Curățenie: nomenclatorul rămâne cum a fost -----------------------------

foreach ([$renamed, $lowercase] as $code) {
    Harness::request('DELETE', $base . '/' . rawurlencode($code));
}
Harness::same(
    'AS-C-14',
    'nomenclatorul are exact aceleași valori ca la început',
    $before,
    (int) Harness::scalar("SELECT COUNT(*) FROM {$CATALOG}"),
);
