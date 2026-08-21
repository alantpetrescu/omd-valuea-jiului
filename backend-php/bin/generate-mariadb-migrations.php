<?php

/**
 * Derives `database/migrations-mariadb/` from `database/migrations/`.
 *
 *   php bin/generate-mariadb-migrations.php           write the files
 *   php bin/generate-mariadb-migrations.php --check   verify they are current
 *
 * The MySQL migrations are generated verbatim from
 * `02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql` and carry its SHA-256 in their
 * header, with an instruction not to edit them in place. That instruction is
 * right, so the MariaDB set is produced from them rather than maintained beside
 * them — one substitution, applied mechanically, re-runnable whenever the
 * blueprint changes.
 *
 * `--check` exists so the test suite can fail when the two sets drift, which is
 * the only failure mode this design still has.
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Config\Env;
use Omd\Database\Dialect;

$check = in_array('--check', $argv, true);

$source = Env::migrationsDir();
$target = Env::repoRoot() . '/database/migrations-mariadb';

if (!is_dir($source)) {
    fwrite(STDERR, "Nu găsesc migrațiile MySQL: {$source}\n");
    exit(2);
}

if (!$check && !is_dir($target) && !mkdir($target, 0o755, true) && !is_dir($target)) {
    fwrite(STDERR, "Nu pot crea {$target}\n");
    exit(2);
}

$names = array_values(array_filter(
    scandir($source) ?: [],
    static fn (string $name): bool => str_ends_with($name, '.sql'),
));
sort($names);

$header = <<<TXT
-- GENERAT AUTOMAT — nu edita acest fișier.
--
-- Sursa: database/migrations/%s
-- Comanda: php bin/generate-mariadb-migrations.php
--
-- Singura diferență față de sursă este colația: MySQL 8 folosește
-- `%s`, care nu există în MariaDB. Echivalentul cel mai apropiat
-- disponibil acolo este `%s` — aceeași insensibilitate la diacritice
-- și la majuscule, același tratament NO PAD al spațiilor finale.
--
-- Motivul alegerii e explicat în src/Database/Dialect.php.


TXT;

$written = 0;
$stale = [];

foreach ($names as $name) {
    $contents = (string) file_get_contents($source . '/' . $name);

    if (!str_contains($contents, Dialect::MYSQL)) {
        // A migration with no collation of its own still belongs in the set, so
        // both directories hold the same filenames and the runner never has to
        // decide whether a missing file is an error.
        $body = $contents;
    } else {
        $body = str_replace(Dialect::MYSQL, Dialect::MARIADB, $contents);
    }

    $out = sprintf($header, $name, Dialect::MYSQL, Dialect::MARIADB) . $body;
    $path = $target . '/' . $name;

    if ($check) {
        $current = is_file($path) ? (string) file_get_contents($path) : '';
        if ($current !== $out) {
            $stale[] = $name;
        }
        continue;
    }

    file_put_contents($path, $out);
    $written++;
    printf("  %s\n", $name);
}

if ($check) {
    if ($stale === []) {
        printf("migrations-mariadb este la zi (%d fișiere)\n", count($names));
        exit(0);
    }
    fwrite(STDERR, sprintf(
        "migrations-mariadb nu mai corespunde sursei: %s\nRulează php bin/generate-mariadb-migrations.php\n",
        implode(', ', $stale),
    ));
    exit(1);
}

printf("\n%d migrații scrise în %s\n", $written, $target);
