<?php

/**
 * The backend test suite.
 *
 *   cd backend-php
 *   php tests/run.php
 *
 * Runs against `omd_vj_test` (override with `OMD_TEST_DB`, which must still end
 * in `_test`). Starts its own PHP server on port 8099 (`OMD_TEST_PORT`), so the
 * development server on 8080 and the staging database are left alone.
 *
 * Covers TASK-1 §3.1 (pure rules), §3.2 (schema and transactions), §3.3 (the
 * endpoints over HTTP) and §3.4 (the fixture is unchanged at the end).
 */

declare(strict_types=1);

require __DIR__ . '/harness.php';

// The application's own bootstrap rather than a second autoloader: the unit
// tests call StrategyService in process, and they should resolve classes exactly
// the way a request does.
require dirname(__DIR__) . '/src/bootstrap.php';

$started = microtime(true);

printf("\033[1mSuita de teste — repere strategice\033[0m\n");

require __DIR__ . '/unit.php';

Harness::boot();
Harness::ensureUsers();

try {
    require __DIR__ . '/database.php';
    require __DIR__ . '/api.php';
    require __DIR__ . '/catalogs.php';
    require __DIR__ . '/dialect.php';
    require __DIR__ . '/regression.php';
} finally {
    Harness::shutdown();
}

$elapsed = microtime(true) - $started;
$failed = count(Harness::$failures);

printf("\n");
if ($failed === 0) {
    printf("\033[32m%d verificări trecute\033[0m în %.1fs\n", Harness::$passed, $elapsed);
    exit(0);
}

printf("\033[31m%d eșecuri\033[0m din %d verificări, în %.1fs\n", $failed, Harness::$passed + $failed, $elapsed);
foreach (Harness::$failures as $failure) {
    printf("  %-10s %s\n", $failure['id'], $failure['message']);
}
exit(1);
