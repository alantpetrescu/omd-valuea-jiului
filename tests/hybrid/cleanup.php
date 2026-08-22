<?php

/**
 * Removes what the hybrid journeys leave behind.
 *
 *   php tests/hybrid/cleanup.php
 *
 * Most of it they clean up themselves, through the API. Two things they cannot:
 *
 *   - a user account, because there is no DELETE route for one, and that is
 *     deliberate — an account that did anything has to stay for the audit trail;
 *   - a campaign or activation whose journey died halfway, before its own
 *     cleanup ran.
 *
 * Everything here is matched on a marker the suite itself writes: the `qa-`
 * prefix on temporary e-mails, and a literal `[QA]` at the start of every title
 * the journeys create. Nothing is deleted for merely looking like test data — an
 * earlier version of this file matched words like „hibrid", which would have
 * taken a real campaign with it the day somebody named one that.
 */

declare(strict_types=1);

require __DIR__ . '/../shared/harness.php';

$_SERVER['DB_NAME'] = Harness::database();
require Harness::backendRoot() . '/src/bootstrap.php';

$removed = ['users' => 0, 'activations' => 0, 'campaigns' => 0];

// --- Conturile temporare -----------------------------------------------------

$users = Harness::rows(
    "SELECT id, email FROM users WHERE email LIKE 'qa-%@test.local'"
);

foreach ($users as $user) {
    // Audit rows point at the user; they go first, or the foreign key refuses.
    Harness::exec('DELETE FROM audit_log WHERE user_id = ?', [$user['id']]);
    Harness::exec('DELETE FROM users WHERE id = ?', [$user['id']]);
    $removed['users']++;
}

// --- Ce a rămas de la un parcurs întrerupt ----------------------------------

// `[` is a literal to LIKE — it has no character classes, only `%` and `_`.
$marker = '[QA]%';

foreach (['activations', 'campaigns'] as $table) {
    $rows = Harness::rows("SELECT external_key FROM {$table} WHERE title LIKE ?", [$marker]);
    foreach ($rows as $row) {
        Harness::track($table, (string) $row['external_key']);
        $removed[$table]++;
    }
}

// `cleanup()` knows how to reach the child rows first — the relations are
// ON DELETE RESTRICT throughout, so a parent cannot go until they do.
Harness::cleanup();

// --- Nomenclatoarele de probă ------------------------------------------------

$channels = Harness::rows("SELECT code FROM activation_channels WHERE code LIKE 'TEST_H05%' OR code LIKE 'TEST_EDITOR%' OR code LIKE 'TEST_VIEWER%'");
foreach ($channels as $channel) {
    Harness::exec('DELETE FROM activation_channels WHERE code = ?', [$channel['code']]);
}

printf(
    "Curățenie hibridă: %d conturi, %d activări, %d campanii, %d valori de nomenclator.\n",
    $removed['users'],
    $removed['activations'],
    $removed['campaigns'],
    count($channels),
);
