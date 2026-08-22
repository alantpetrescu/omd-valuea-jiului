<?php

/**
 * AS-B-R02, AS-B-R03 — the fixture is where it started.
 *
 * AS-B-R01 (paritatea vizuală, 22/22) belongs to the frontend suite and is run
 * from there; it cannot be asserted from here.
 *
 * R03 is not decoration. The whole API suite works inside a scratch version so
 * that these numbers do not move; if a future test forgets to clean up, this is
 * where it shows, once, instead of in every later run.
 */

declare(strict_types=1);

Harness::group('Regresie — starea de plecare');

$sourceId = (string) Harness::scalar(
    "SELECT id FROM strategy_versions WHERE external_key = 'strategy-2026-2028'"
);

$golden = [
    'piloni' => ['strategic_pillars', 4],
    'programe' => ['strategic_programs', 8],
    'obiective' => ['strategic_objectives', 18],
];

foreach ($golden as $label => [$table, $expected]) {
    Harness::same(
        'AS-B-R03',
        "versiunea sursă are {$expected} {$label}",
        $expected,
        (int) Harness::scalar("SELECT COUNT(*) FROM {$table} WHERE strategy_version_id = ?", [$sourceId]),
    );
}

/*
 * AS-B-R02 — the rule from §4.1 stated as the outcome it protects.
 *
 * A re-import is idempotent because it matches on code. Every seeded reper is
 * therefore both import-touched and code-locked; if someone relaxes
 * `codeEditable`, a renamed reper stops matching and the next import creates a
 * second one. Rather than running a full import here — which would need the
 * package files and would rewrite the fixture — the test asserts the invariant
 * that makes the import idempotent in the first place.
 */
$unlocked = Harness::rows(
    'SELECT p.code FROM strategic_programs p
      WHERE p.strategy_version_id = ?
        AND EXISTS (SELECT 1 FROM import_batch_items i WHERE i.entity_id = p.id)',
    [$sourceId],
);

$allLocked = true;
$leaked = [];
foreach ($unlocked as $row) {
    $id = (string) Harness::scalar(
        'SELECT id FROM strategic_programs WHERE strategy_version_id = ? AND code = ?',
        [$sourceId, $row['code']],
    );
    $response = Harness::request(
        'GET',
        '/api/v1/strategy/strategy-2026-2028/programs/' . rawurlencode((string) $row['code']) . '/usage',
    );
    if (($response['body']['data']['canEditCode'] ?? true) !== false) {
        $allLocked = false;
        $leaked[] = (string) $row['code'];
    }
    unset($id);
}

Harness::check(
    'AS-B-R02',
    'niciun reper adus prin import nu are codul editabil — importul rămâne idempotent',
    $allLocked && $unlocked !== [],
    $leaked === [] ? '' : 'deblocate: ' . implode(', ', $leaked),
);
