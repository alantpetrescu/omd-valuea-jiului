<?php

/**
 * Environment configuration — the port of `backend/src/config/env.ts`.
 *
 * Same rule as the Node original: the application refuses to serve if a
 * critical variable is missing, validation happens exactly once, and no other
 * file reads `$_ENV` or `getenv()` directly.
 *
 * The `.env` parser is hand-written because there is no Composer here. It
 * covers what the file actually contains — `KEY=value`, `#` comments, optional
 * quotes — and deliberately not shell interpolation, which the Node version
 * does not support either.
 */

declare(strict_types=1);

namespace Omd\Config;

use RuntimeException;

final class Env
{
    /** @var array<string,mixed>|null */
    private static ?array $values = null;

    /**
     * Reads a validated setting.
     *
     * @return mixed
     */
    public static function get(string $key)
    {
        $values = self::values();
        if (!array_key_exists($key, $values)) {
            throw new RuntimeException("Unknown configuration key: {$key}");
        }
        return $values[$key];
    }

    public static function string(string $key): string
    {
        return (string) self::get($key);
    }

    public static function int(string $key): int
    {
        return (int) self::get($key);
    }

    public static function bool(string $key): bool
    {
        return (bool) self::get($key);
    }

    public static function isProduction(): bool
    {
        return self::string('APP_ENV') === 'production';
    }

    /**
     * The repository root — the directory holding `backend-php/`, `contracts/`
     * and `database/`.
     *
     * The Node build resolves this three levels up from `backend/dist/config`;
     * here it is two levels up from `backend-php/src/Config`. The important
     * part is unchanged: `contracts/` and `database/migrations/` are siblings
     * of the backend directory, not children of it.
     */
    public static function repoRoot(): string
    {
        return dirname(__DIR__, 3);
    }

    public static function migrationsDir(): string
    {
        return self::repoRoot() . '/database/migrations';
    }

    public static function contractsDir(): string
    {
        return self::repoRoot() . '/contracts';
    }

    /** Absolute path, whether the setting was absolute or repo-relative. */
    public static function path(string $key): string
    {
        $value = self::string($key);
        if ($value !== '' && ($value[0] === '/' || preg_match('/^[A-Za-z]:[\\\\\\/]/', $value) === 1)) {
            return $value;
        }
        return self::repoRoot() . '/' . ltrim($value, '/');
    }

    /** @return array<string,mixed> */
    private static function values(): array
    {
        if (self::$values !== null) {
            return self::$values;
        }

        $raw = self::loadDotEnv(dirname(__DIR__, 2) . '/.env');

        /*
         * What is already in the superglobals wins over a stale `.env`.
         *
         * "Superglobals", not "the process environment" — the difference is not
         * pedantry and it cost an hour to find. PHP's default
         * `variables_order = GPCS` has no `E`, so `$_ENV` is empty. The CLI SAPI
         * copies the environment into `$_SERVER` anyway, which is why
         * `DB_NAME=x php bin/import.php` targets another database exactly as
         * expected. **No web SAPI does that.** Under the built-in server or
         * PHP-FPM, an exported variable simply does not arrive, and the request
         * silently uses `.env` instead.
         *
         * So this covers `SetEnv` in `.htaccess`, which Apache passes through as
         * a server variable, and it covers every CLI entry point. It does not
         * cover a variable exported into a web server's process. Configure a web
         * deployment through `.env` or `SetEnv`; to point a dev server elsewhere,
         * start it with `-d variables_order=EGPCS`.
         */
        foreach (array_merge($_ENV, $_SERVER) as $key => $value) {
            if (is_string($key) && is_string($value) && preg_match('/^[A-Z][A-Z0-9_]*$/', $key) === 1) {
                $raw[$key] = $value;
            }
        }

        $problems = [];
        $out = [];

        $required = static function (string $key) use ($raw, &$problems, &$out): void {
            $value = $raw[$key] ?? '';
            if ($value === '') {
                $problems[] = "  - {$key}: este obligatoriu";
                return;
            }
            $out[$key] = $value;
        };

        $optional = static function (string $key, string $fallback) use ($raw, &$out): void {
            $value = $raw[$key] ?? '';
            $out[$key] = $value === '' ? $fallback : $value;
        };

        $numeric = static function (string $key, int $fallback) use ($raw, &$problems, &$out): void {
            $value = $raw[$key] ?? '';
            if ($value === '') {
                $out[$key] = $fallback;
                return;
            }
            if (!ctype_digit(ltrim($value, '+')) || (int) $value <= 0) {
                $problems[] = "  - {$key}: trebuie să fie un întreg pozitiv (primit: {$value})";
                return;
            }
            $out[$key] = (int) $value;
        };

        $minLength = static function (string $key, int $min) use ($raw, &$problems, &$out): void {
            $value = $raw[$key] ?? '';
            if (strlen($value) < $min) {
                $problems[] = "  - {$key}: minimum {$min} caractere";
                return;
            }
            $out[$key] = $value;
        };

        $enum = static function (string $key, array $allowed, string $fallback) use ($raw, &$problems, &$out): void {
            $value = $raw[$key] ?? '';
            if ($value === '') {
                $out[$key] = $fallback;
                return;
            }
            if (!in_array($value, $allowed, true)) {
                $problems[] = "  - {$key}: trebuie să fie una dintre " . implode(', ', $allowed);
                return;
            }
            $out[$key] = $value;
        };

        $enum('APP_ENV', ['staging', 'production'], '');
        if (($out['APP_ENV'] ?? '') === '') {
            $problems[] = '  - APP_ENV: este obligatoriu (staging sau production)';
        }
        $required('APP_BASE_URL');
        $minLength('APP_SECRET', 16);
        $minLength('AUTH_SECRET', 16);

        $required('DB_HOST');
        $numeric('DB_PORT', 3306);
        $required('DB_NAME');
        $required('DB_USER');
        $out['DB_PASSWORD'] = $raw['DB_PASSWORD'] ?? '';

        $optional('UPLOAD_DIR', 'storage/uploads');
        $optional('IMPORT_TEMP_DIR', 'storage/import-temp');
        $numeric('MAX_UPLOAD_MB', 15);
        $numeric('MAX_JSON_IMPORT_MB', 25);

        $numeric('AUTH_TOKEN_TTL', 28800);
        $optional('SEED_ADMIN_EMAIL', 'admin@omd.ro');
        $optional('SEED_ADMIN_NAME', 'Administrator OMD');
        $enum('LOG_LEVEL', ['fatal', 'error', 'warn', 'info', 'debug', 'trace'], 'info');
        $optional('LOG_FILE', '');

        /*
         * Number of proxies in front of the app; 0 means none.
         *
         * `$optional` rather than `$numeric` because `$numeric` rejects zero,
         * and zero is the correct value for a plain shared host — the common
         * case, which should not be a configuration error.
         *
         * It was missing from this list entirely while `.env.example` described
         * it and `Request::ip()` read it with `getenv()`. `.env` is parsed into
         * this array and never becomes process environment, so the setting read
         * as absent no matter what the file said.
         */
        $optional('TRUST_PROXY', '0');

        if ($problems !== []) {
            throw new RuntimeException(
                "Configurație de mediu invalidă:\n" . implode("\n", $problems)
                . "\n\nVezi backend-php/.env.example."
            );
        }

        self::$values = $out;
        return $out;
    }

    /** @return array<string,string> */
    private static function loadDotEnv(string $file): array
    {
        if (!is_file($file) || !is_readable($file)) {
            return [];
        }

        $values = [];
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = trim($line);
            if ($line === '' || $line[0] === '#') {
                continue;
            }
            $position = strpos($line, '=');
            if ($position === false) {
                continue;
            }
            $key = trim(substr($line, 0, $position));
            $value = trim(substr($line, $position + 1));

            // Strip one matching pair of surrounding quotes, as dotenv does.
            $length = strlen($value);
            if ($length >= 2
                && (($value[0] === '"' && $value[$length - 1] === '"')
                    || ($value[0] === "'" && $value[$length - 1] === "'"))
            ) {
                $value = substr($value, 1, -1);
            }

            $values[$key] = $value;
        }

        return $values;
    }
}
