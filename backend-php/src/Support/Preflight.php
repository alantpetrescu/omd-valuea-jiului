<?php

/**
 * Environment self-check.
 *
 * The PHP backend exists to run on hosting nobody can SSH into, which means the
 * usual way of finding out why it does not work — read the logs, run a command,
 * try again — is unavailable. This answers "will this run here, and if not
 * which part is wrong" in one pass, from either the CLI or a guarded URL.
 *
 * Every check returns a status rather than throwing, so one failure does not
 * hide the five after it. That matters most on a host where each attempt costs
 * a round trip through a file manager.
 */

declare(strict_types=1);

namespace Omd\Support;

use Omd\Config\Env;
use Omd\Database\Db;
use Throwable;

final class Preflight
{
    public const OK = 'ok';
    public const WARN = 'warn';
    public const FAIL = 'fail';

    /** The version this port targets. `readonly` properties make 8.1 the floor. */
    private const MIN_PHP = 80100;

    /**
     * @return list<array{name:string,status:string,detail:string}>
     */
    public static function run(): array
    {
        $results = [];
        $add = static function (string $name, string $status, string $detail) use (&$results): void {
            $results[] = ['name' => $name, 'status' => $status, 'detail' => $detail];
        };

        // --- PHP itself ---------------------------------------------------
        $add(
            'Versiune PHP',
            PHP_VERSION_ID >= self::MIN_PHP ? self::OK : self::FAIL,
            PHP_VERSION . (PHP_VERSION_ID >= self::MIN_PHP ? '' : ' — necesar 8.1 sau mai nou'),
        );

        // 8.1 stopped receiving security fixes at the end of 2025. Not a
        // blocker, but the person deploying should know.
        if (PHP_VERSION_ID >= 80100 && PHP_VERSION_ID < 80200) {
            $add(
                'Suport de securitate',
                self::WARN,
                'PHP 8.1 nu mai primește actualizări de securitate. Dacă gazda oferă 8.2+, '
                . 'schimbă din MultiPHP Manager — aplicația merge pe oricare.',
            );
        }

        foreach (['pdo_mysql', 'json', 'mbstring', 'filter'] as $extension) {
            $add(
                "Extensia {$extension}",
                extension_loaded($extension) ? self::OK : self::FAIL,
                extension_loaded($extension) ? 'încărcată' : 'lipsește — activeaz-o în php.ini',
            );
        }

        $add(
            'Hashing parole',
            self::OK,
            Password::hasArgon2()
                ? 'Argon2id disponibil — hash-urile sunt compatibile cu backendul Node'
                : 'Argon2 lipsește; parolele NOI vor folosi bcrypt. Cele existente se verifică în continuare.',
        );
        if (!Password::hasArgon2()) {
            $results[count($results) - 1]['status'] = self::WARN;
        }

        // --- Layout on disk -----------------------------------------------
        $root = Env::repoRoot();
        $add('Rădăcina proiectului', is_dir($root) ? self::OK : self::FAIL, $root);

        foreach ([
            'Contracte JSON' => Env::contractsDir(),
            'Migrații' => Env::migrationsDir(),
        ] as $label => $directory) {
            $exists = is_dir($directory) && is_readable($directory);
            $count = $exists ? count(glob($directory . '/*.*') ?: []) : 0;
            $add(
                $label,
                $exists && $count > 0 ? self::OK : self::FAIL,
                $exists
                    ? "{$directory} ({$count} fișiere)"
                    : "{$directory} lipsește — trebuie să fie LÂNGĂ backend-php/, nu în el",
            );
        }

        // --- Configuration ------------------------------------------------
        try {
            Env::string('DB_NAME');
            $add('Configurație .env', self::OK, 'toate variabilele critice sunt prezente');

            $envFile = dirname(__DIR__, 2) . '/.env';
            if (is_file($envFile)) {
                $mode = substr(sprintf('%o', fileperms($envFile)), -3);
                // Windows reports 666 regardless; only meaningful on the host.
                $tooOpen = DIRECTORY_SEPARATOR === '/' && (int) $mode % 10 !== 0;
                $add(
                    'Permisiuni .env',
                    $tooOpen ? self::WARN : self::OK,
                    $tooOpen
                        ? "mod {$mode} — conține parole; rulează chmod 600 .env"
                        : "mod {$mode}",
                );
            }
        } catch (Throwable $error) {
            $add('Configurație .env', self::FAIL, $error->getMessage());
            // Nothing below can work without configuration.
            return $results;
        }

        // --- Writable storage ---------------------------------------------
        foreach ([
            'Director uploads' => Env::path('UPLOAD_DIR'),
            'Director import-temp' => Env::path('IMPORT_TEMP_DIR'),
        ] as $label => $directory) {
            if (!is_dir($directory)) {
                @mkdir($directory, 0770, true);
            }
            $writable = is_dir($directory) && is_writable($directory);
            $add(
                $label,
                $writable ? self::OK : self::FAIL,
                $writable ? $directory : "{$directory} — nu există sau nu e writable",
            );
        }

        // --- Database -----------------------------------------------------
        try {
            $version = (string) Db::scalar('SELECT VERSION()');
            $modern = version_compare($version, '8.0', '>=');
            $add(
                'Conexiune MySQL',
                $modern ? self::OK : self::FAIL,
                $version . ($modern ? '' : ' — schema cere 8.0+ pentru utf8mb4_0900_ai_ci'),
            );

            $collation = (string) Db::scalar(
                'SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
                [Env::string('DB_NAME')],
            );
            $add(
                'Colație bază de date',
                $collation === 'utf8mb4_0900_ai_ci' ? self::OK : self::WARN,
                $collation === '' ? 'necunoscută' : $collation,
            );

            $hasTracking = Db::count(
                'SELECT COUNT(*) FROM information_schema.TABLES
                  WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
                [Env::string('DB_NAME'), 'schema_migrations'],
            ) > 0;

            if (!$hasTracking) {
                $add('Schemă', self::WARN, 'nemigrată — rulează migrate');
            } else {
                $applied = Db::count('SELECT COUNT(*) FROM schema_migrations');
                $pending = count(glob(Env::migrationsDir() . '/*.sql') ?: []) - $applied;
                $add(
                    'Schemă',
                    $pending > 0 ? self::WARN : self::OK,
                    $pending > 0
                        ? "{$applied} migrații aplicate, {$pending} în așteptare"
                        : "{$applied} migrații aplicate, la zi",
                );

                $users = Db::count('SELECT COUNT(*) FROM users');
                $add(
                    'Conturi',
                    $users > 0 ? self::OK : self::WARN,
                    $users > 0 ? "{$users} utilizatori" : 'niciun utilizator — rulează seed',
                );
            }
        } catch (Throwable $error) {
            $add('Conexiune MySQL', self::FAIL, $error->getMessage());
        }

        return $results;
    }

    /**
     * One report line.
     *
     * `printf('%-24s')` pads by BYTES, so a name carrying diacritics — every
     * second one here — comes out short and the column drifts. Padding by
     * characters is the only way to line them up.
     *
     * A multi-line detail (the .env report lists one problem per line) is
     * indented to the value column, so it reads as one entry rather than
     * spilling into the left margin.
     *
     * @param array{name:string,status:string,detail:string} $result
     */
    public static function format(array $result): string
    {
        $name = $result['name'];
        $padding = max(0, 24 - self::characters($name));

        $indent = str_repeat(' ', 33);
        $detail = str_replace(PHP_EOL, PHP_EOL . $indent, rtrim($result['detail']));
        $detail = str_replace(chr(10), PHP_EOL . $indent, $detail);

        return sprintf(
            '  [%s] %s %s',
            str_pad(strtoupper($result['status']), 4),
            $name . str_repeat(' ', $padding),
            $detail,
        );
    }

    /**
     * Character count that does not need mbstring.
     *
     * This report exists to run on a broken installation, and a missing
     * mbstring is one of the things it reports — so calling mb_strlen here
     * would kill the check precisely when it has something to say. PCRE with
     * the /u flag is a separate extension and is compiled in by default.
     */
    private static function characters(string $value): int
    {
        $count = @preg_match_all('/./us', $value);
        return $count === false ? strlen($value) : $count;
    }

    /** @param list<array{name:string,status:string,detail:string}> $results */
    public static function worst(array $results): string
    {
        foreach ($results as $result) {
            if ($result['status'] === self::FAIL) {
                return self::FAIL;
            }
        }
        foreach ($results as $result) {
            if ($result['status'] === self::WARN) {
                return self::WARN;
            }
        }
        return self::OK;
    }
}
