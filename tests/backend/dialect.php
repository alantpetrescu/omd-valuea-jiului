<?php

/**
 * AS-D-01…D08 — the two migration sets, and how the server is recognised.
 *
 * The MariaDB set is generated, so the failure mode is not a wrong statement —
 * it is the two sets silently drifting apart after someone edits a MySQL
 * migration and forgets to regenerate. That is what most of this file watches.
 *
 * Runs against whichever server the suite is pointed at; the parity checks read
 * files and need no database at all.
 */

declare(strict_types=1);

use Omd\Config\Env;
use Omd\Database\Dialect;

Harness::group('Dialect — MySQL și MariaDB');

// --- Recunoașterea serverului ----------------------------------------------

Harness::check(
    'AS-D-01',
    'MariaDB e recunoscută după nume, nu după numărul de versiune',
    Dialect::isMariaDbBanner('10.11.18-MariaDB-cll-lve')
    && Dialect::isMariaDbBanner('11.4.2-MariaDB')
    && !Dialect::isMariaDbBanner('8.0.46')
    && !Dialect::isMariaDbBanner('8.4.24'),
);

/*
 * The trap this replaced: MariaDB's 10.x is numerically greater than MySQL's
 * 8.0, so a version comparison calls it modern and lets the deployment reach a
 * schema it cannot create.
 */
Harness::check(
    'AS-D-02',
    'version_compare singur ar fi declarat MariaDB 10.11 drept „MySQL 8+"',
    version_compare('10.11.18-MariaDB-cll-lve', '8.0', '>=') === true,
);

// --- Cele două seturi -------------------------------------------------------

$mysqlDir = Env::migrationsDir();
$mariaDir = Env::repoRoot() . '/database/migrations-mariadb';

$listOf = static function (string $directory): array {
    $names = array_values(array_filter(
        scandir($directory) ?: [],
        static fn (string $name): bool => str_ends_with($name, '.sql'),
    ));
    sort($names);
    return $names;
};

Harness::check('AS-D-03', 'setul MariaDB există', is_dir($mariaDir));

if (is_dir($mariaDir)) {
    Harness::same(
        'AS-D-04',
        'aceleași nume de fișiere în ambele seturi',
        $listOf($mysqlDir),
        $listOf($mariaDir),
    );

    $leftovers = [];
    $missing = [];
    $statementCounts = [];

    /*
     * Comment lines are stripped before comparing.
     *
     * The generated header explains the substitution, and to do that it has to
     * name both collations — so a naive search for the MySQL name finds it in
     * every file and reports ten failures that are not failures. What matters is
     * the SQL that gets executed.
     */
    $statementsOnly = static fn (string $sql): string => (string) preg_replace('/^\s*--.*$/m', '', $sql);

    foreach ($listOf($mariaDir) as $name) {
        $mysql = $statementsOnly((string) file_get_contents($mysqlDir . '/' . $name));
        $maria = $statementsOnly((string) file_get_contents($mariaDir . '/' . $name));

        if (str_contains($maria, Dialect::MYSQL)) {
            $leftovers[] = $name;
        }
        if (substr_count($mysql, Dialect::MYSQL) !== substr_count($maria, Dialect::MARIADB)) {
            $missing[] = $name;
        }

        // Statement count as a cheap structural comparison: the substitution
        // must not have swallowed or split anything.
        $statementCounts[$name] = [substr_count($mysql, ';'), substr_count($maria, ';')];
    }

    Harness::check(
        'AS-D-05',
        'nicio colație MySQL rămasă în setul MariaDB',
        $leftovers === [],
        implode(', ', $leftovers),
    );

    Harness::check(
        'AS-D-06',
        'fiecare colație înlocuită, una la una',
        $missing === [],
        implode(', ', $missing),
    );

    $mismatched = array_keys(array_filter(
        $statementCounts,
        static fn (array $pair): bool => $pair[0] !== $pair[1],
    ));
    Harness::check(
        'AS-D-07',
        'același număr de instrucțiuni în fiecare fișier',
        $mismatched === [],
        implode(', ', $mismatched),
    );
}

/*
 * The generator's own `--check`, run from here.
 *
 * Editing a MySQL migration and forgetting to regenerate is the one way these
 * two directories can disagree, and it would not show up until a MariaDB
 * deployment ran an outdated schema.
 */
$generator = escapeshellarg(Harness::backendRoot() . '/bin/generate-mariadb-migrations.php');
exec(escapeshellarg(PHP_BINARY) . ' ' . $generator . ' --check 2>&1', $output, $status);
Harness::check(
    'AS-D-08',
    'setul generat este la zi față de sursă',
    $status === 0,
    implode(' ', array_slice($output, 0, 2)),
);
