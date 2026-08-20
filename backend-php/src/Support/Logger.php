<?php

/**
 * Structured logger — port of `shared/logger.ts`.
 *
 * One JSON object per line, as pino writes, so the two backends produce logs a
 * single tool can read. Passwords and tokens are never written: the redaction
 * list below is the enforcement point, not a convention.
 *
 * Destination is `LOG_FILE` when set, otherwise PHP's error log — which on
 * cPanel lands in the account's `logs/` directory and is readable from the
 * Errors page.
 */

declare(strict_types=1);

namespace Omd\Support;

use Omd\Config\Env;
use Throwable;

final class Logger
{
    private const LEVELS = [
        'trace' => 10,
        'debug' => 20,
        'info' => 30,
        'warn' => 40,
        'error' => 50,
        'fatal' => 60,
    ];

    private const REDACT = [
        'password',
        'currentPassword',
        'newPassword',
        'token',
        'cookie',
        'authorization',
        'DB_PASSWORD',
        'APP_SECRET',
        'AUTH_SECRET',
    ];

    /** @param array<string,mixed> $context */
    public static function info(string $message, array $context = []): void
    {
        self::write('info', $message, $context);
    }

    /** @param array<string,mixed> $context */
    public static function warn(string $message, array $context = []): void
    {
        self::write('warn', $message, $context);
    }

    /** @param array<string,mixed> $context */
    public static function error(string $message, array $context = []): void
    {
        self::write('error', $message, $context);
    }

    /** @param array<string,mixed> $context */
    private static function write(string $level, string $message, array $context): void
    {
        try {
            $threshold = self::LEVELS[Env::string('LOG_LEVEL')] ?? 30;
        } catch (Throwable) {
            // Logging must survive a broken configuration — that is exactly when
            // it is most needed.
            $threshold = 30;
        }

        if ((self::LEVELS[$level] ?? 30) < $threshold) {
            return;
        }

        $line = json_encode([
            'level' => $level,
            'time' => gmdate('c'),
            'msg' => $message,
        ] + self::redact($context), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($line === false) {
            return;
        }

        $file = '';
        try {
            $file = Env::string('LOG_FILE');
        } catch (Throwable) {
            $file = '';
        }

        if ($file !== '') {
            @file_put_contents($file, $line . PHP_EOL, FILE_APPEND | LOCK_EX);
            return;
        }

        error_log($line);
    }

    /**
     * @param array<string,mixed> $context
     * @return array<string,mixed>
     */
    private static function redact(array $context): array
    {
        foreach ($context as $key => $value) {
            if (in_array((string) $key, self::REDACT, true)) {
                $context[$key] = '[redacted]';
                continue;
            }
            if (is_array($value)) {
                $context[$key] = self::redact($value);
            }
        }
        return $context;
    }
}
