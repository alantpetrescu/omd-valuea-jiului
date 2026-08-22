<?php

/**
 * The backend suite.
 *
 *   php tests/backend/run.php            # everything
 *   php tests/backend/run.php auth roles # only those files
 *
 * Runs against `omd_vj_test` (override with `OMD_TEST_DB`, which must still end
 * in `_test`). Starts its own PHP server on port 8099 (`OMD_TEST_PORT`), so the
 * development server on 8080 and the staging database are left alone.
 *
 * Covers BACKEND.md §1–§5.
 */

declare(strict_types=1);

require __DIR__ . '/../shared/harness.php';

/*
 * Point the in-process `Db` at the test database, before `Env` reads anything.
 *
 * The HTTP side of the suite talks to a server started with `DB_NAME` in its
 * environment, but a test that calls a class directly goes through `Env`, which
 * reads `.env` — staging. Nothing warned about it, and the first test to write
 * through such a call would have written there. `Env::values()` is lazy and
 * caches, and `$_SERVER` beats `.env`, so setting it here is enough.
 */
$_SERVER['DB_NAME'] = Harness::database();

// The application's own bootstrap rather than a second autoloader: the unit
// tests call StrategyService in process, and they should resolve classes exactly
// the way a request does.
require Harness::backendRoot() . '/src/bootstrap.php';

/*
 * The order is the dependency order, not alphabetical.
 *
 * `unit` needs nothing. Everything after it needs the server and the seeded
 * users, so it runs inside the try/finally that shuts the server down.
 * `regression` is last on purpose: it asserts the fixture survived everything
 * above it, which only means something once everything above it has run.
 */
const SUITES_OFFLINE = ['unit'];
const SUITES_SERVED = [
    'database',
    'auth',
    'roles',
    'api',
    'campaigns',
    'activations',
    'catalogs',
    'imports',
    'monitoring',
    'files',
    'contract',
    'dialect',
    'cascade',
    'regression',
];

$only = array_values(array_filter(
    array_slice($argv, 1),
    static fn (string $argument): bool => !str_starts_with($argument, '-'),
));
$wanted = static fn (string $name): bool => $only === [] || in_array($name, $only, true);

$unknown = array_diff($only, SUITES_OFFLINE, SUITES_SERVED);
if ($unknown !== []) {
    fwrite(STDERR, 'Suite necunoscute: ' . implode(', ', $unknown) . PHP_EOL);
    exit(2);
}

$started = microtime(true);

printf("\033[1mSuita de backend\033[0m\n");

foreach (SUITES_OFFLINE as $suite) {
    if ($wanted($suite)) {
        require __DIR__ . "/{$suite}.php";
    }
}

$served = array_values(array_filter(SUITES_SERVED, $wanted));
if ($served !== []) {
    Harness::boot();
    Harness::ensureUsers();

    try {
        foreach ($served as $suite) {
            require __DIR__ . "/{$suite}.php";
        }
    } finally {
        // The API only soft-deletes, by design. Without this the rows the
        // tests created would stay behind, and every run would start from a
        // slightly larger database than the one before it.
        Harness::cleanup();
        Harness::shutdown();
    }
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
