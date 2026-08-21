<?php

/**
 * Which server we are talking to, and what that implies.
 *
 * The schema was written for MySQL 8: every table declares
 * `utf8mb4_0900_ai_ci`, a UCA 9.0 collation that exists only there. Most shared
 * hosts run MariaDB, which rejects it outright — `1273 Unknown collation`, at
 * connect, before the application can so much as report which server it found.
 *
 * Rather than making the collation a setting someone has to remember, the server
 * is asked and the answer decides: which collation to speak, and which set of
 * migration files to run. A deployment that gets this wrong fails on the first
 * `CREATE TABLE`, which is late, and with a message about collations, which
 * sounds cosmetic and is not.
 *
 * ### Why `utf8mb4_unicode_520_nopad_ci`
 *
 * MySQL's `utf8mb4_0900_ai_ci` is accent-insensitive, case-insensitive and
 * NO PAD. Matching all three on MariaDB 10.11 leaves exactly one candidate:
 *
 *   | collation                      | UCA   | pad       |
 *   |--------------------------------|-------|-----------|
 *   | utf8mb4_general_ci (default)   | —     | PAD SPACE |
 *   | utf8mb4_unicode_ci             | 4.0.0 | PAD SPACE |
 *   | utf8mb4_unicode_520_ci         | 5.2.0 | PAD SPACE |
 *   | utf8mb4_unicode_nopad_ci       | 4.0.0 | NO PAD    |
 *   | **utf8mb4_unicode_520_nopad_ci** | **5.2.0** | **NO PAD** |
 *
 * MariaDB 10.10 added UCA 14.0.0 collations (`utf8mb4_uca1400_*`), which would
 * be closer still — but they are absent from the CloudLinux build this was
 * verified against, even at 10.11.18. Checked, not assumed: the list above comes
 * from `information_schema.COLLATIONS` on that server.
 *
 * NO PAD is not a detail. Under PAD SPACE, `'P5.1 '` and `'P5.1'` compare equal,
 * which changes what a UNIQUE index accepts — see `Shared\CodeIdentity`, whose
 * reason for trimming depends on exactly this.
 */

declare(strict_types=1);

namespace Omd\Database;

use Omd\Config\Env;
use PDO;

final class Dialect
{
    public const MYSQL = 'utf8mb4_0900_ai_ci';
    public const MARIADB = 'utf8mb4_unicode_520_nopad_ci';

    private static ?bool $isMariaDb = null;

    /** Reads the server banner from a handle that may not be `Db::$pdo` yet. */
    public static function isMariaDbBanner(string $version): bool
    {
        return stripos($version, 'mariadb') !== false;
    }

    /**
     * MariaDB reports `10.11.18-MariaDB-cll-lve`.
     *
     * Detected by name, never by `version_compare`: MariaDB's 10.x is
     * numerically greater than MySQL's 8.0, so a version comparison declares it
     * modern and lets the deployment proceed to a schema it cannot create.
     */
    public static function isMariaDb(): bool
    {
        if (self::$isMariaDb === null) {
            self::$isMariaDb = self::isMariaDbBanner((string) Db::scalar('SELECT VERSION()'));
        }
        return self::$isMariaDb;
    }

    public static function collation(): string
    {
        return self::isMariaDb() ? self::MARIADB : self::MYSQL;
    }

    public static function collationFor(PDO $pdo): string
    {
        $version = (string) $pdo->query('SELECT VERSION()')->fetchColumn();
        return self::isMariaDbBanner($version) ? self::MARIADB : self::MYSQL;
    }

    /**
     * The migration set for this server.
     *
     * Two directories, not one file rewritten on the fly: the MySQL migrations
     * carry the blueprint's SHA-256 in their header and say not to edit them in
     * place. `bin/generate-mariadb-migrations.php` derives the second set from
     * the first, so they cannot drift apart by hand.
     */
    public static function migrationsDir(): string
    {
        return self::isMariaDb()
            ? Env::repoRoot() . '/database/migrations-mariadb'
            : Env::migrationsDir();
    }

    /** Only for tests, which point one process at two databases. */
    public static function reset(): void
    {
        self::$isMariaDb = null;
    }
}
