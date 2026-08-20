<?php

/**
 * Login attempt limiting — spec 11.6: 10 attempts per 15 minutes, per IP+email.
 *
 * The Node version keeps a `Map` in module scope, which works because one
 * process serves every request. PHP has no such luxury: each request is a fresh
 * process and an in-memory counter would reset on every attempt, making the
 * limiter decorative.
 *
 * So the counter lives in a file, one per key, under `storage/rate-limit/`.
 * Not a database table, because the schema is frozen and this is not business
 * data. Not APCu, because shared hosting frequently ships without it.
 *
 * The file is locked while it is read and rewritten, so two simultaneous
 * attempts cannot both read "9" and both be allowed through.
 */

declare(strict_types=1);

namespace Omd\Support;

use Omd\Config\Env;

final class RateLimiter
{
    private const MAX_ATTEMPTS = 10;
    private const WINDOW_SECONDS = 900;

    public static function tooManyAttempts(string $key): bool
    {
        $entry = self::read($key);
        if ($entry === null || (time() - $entry['firstAt']) > self::WINDOW_SECONDS) {
            return false;
        }
        return $entry['count'] >= self::MAX_ATTEMPTS;
    }

    public static function recordFailure(string $key): void
    {
        $file = self::file($key);
        $handle = @fopen($file, 'c+');
        if ($handle === false) {
            // A limiter that cannot write must not block logins outright; the
            // failure is logged and the attempt proceeds.
            Logger::warn('rate limiter unwritable', ['file' => $file]);
            return;
        }

        try {
            flock($handle, LOCK_EX);
            $raw = stream_get_contents($handle) ?: '';
            $entry = json_decode($raw, true);

            $now = time();
            if (!is_array($entry)
                || !isset($entry['firstAt'], $entry['count'])
                || ($now - (int) $entry['firstAt']) > self::WINDOW_SECONDS
            ) {
                $entry = ['count' => 1, 'firstAt' => $now];
            } else {
                $entry = ['count' => (int) $entry['count'] + 1, 'firstAt' => (int) $entry['firstAt']];
            }

            ftruncate($handle, 0);
            rewind($handle);
            fwrite($handle, (string) json_encode($entry));
            fflush($handle);
        } finally {
            flock($handle, LOCK_UN);
            fclose($handle);
        }
    }

    public static function clear(string $key): void
    {
        @unlink(self::file($key));
    }

    /**
     * Removes windows that have expired.
     *
     * Called opportunistically on a small fraction of failures rather than on a
     * schedule — shared hosting may have no cron, and the directory would
     * otherwise grow one file per attacked address forever.
     */
    public static function sweep(): void
    {
        $dir = self::directory();
        $cutoff = time() - self::WINDOW_SECONDS;

        foreach (glob($dir . '/*.json') ?: [] as $file) {
            if (@filemtime($file) < $cutoff) {
                @unlink($file);
            }
        }
    }

    /** @return array{count:int,firstAt:int}|null */
    private static function read(string $key): ?array
    {
        $raw = @file_get_contents(self::file($key));
        if ($raw === false || $raw === '') {
            return null;
        }
        $entry = json_decode($raw, true);
        if (!is_array($entry) || !isset($entry['count'], $entry['firstAt'])) {
            return null;
        }
        return ['count' => (int) $entry['count'], 'firstAt' => (int) $entry['firstAt']];
    }

    private static function file(string $key): string
    {
        // The key contains an e-mail address, so it is hashed rather than used
        // as a filename: no address ends up readable in a directory listing.
        return self::directory() . '/' . hash('sha256', $key) . '.json';
    }

    private static function directory(): string
    {
        $dir = Env::path('IMPORT_TEMP_DIR') . '/../rate-limit';
        if (!is_dir($dir)) {
            @mkdir($dir, 0770, true);
        }
        return $dir;
    }
}
