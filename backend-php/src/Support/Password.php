<?php

/**
 * Password hashing — port of `shared/password.ts`.
 *
 * The parameters match the Node original exactly (OWASP's Argon2id baseline:
 * 19 MiB, 2 iterations, 1 lane), and that is not cosmetic. Both backends read
 * the same `users.password_hash` column, and both produce the standard PHC
 * string `$argon2id$v=19$m=19456,t=2,p=1$…`, so **a password set through the
 * Node backend verifies here and vice versa**. The two can run against the same
 * database during a migration.
 *
 * If the host's PHP was built without Argon2, the constant is missing and
 * hashing falls back to bcrypt. Verification is unaffected — `password_verify`
 * dispatches on the hash prefix — so existing Argon2 hashes keep working; only
 * newly set passwords would use bcrypt. `algorithm()` reports which is active
 * so the deployment check can surface it.
 */

declare(strict_types=1);

namespace Omd\Support;

final class Password
{
    private const ARGON2_OPTIONS = [
        'memory_cost' => 19456,
        'time_cost' => 2,
        'threads' => 1,
    ];

    public static function hasArgon2(): bool
    {
        return defined('PASSWORD_ARGON2ID');
    }

    public static function algorithm(): string
    {
        return self::hasArgon2() ? 'argon2id' : 'bcrypt';
    }

    public static function hash(string $plaintext): string
    {
        if (self::hasArgon2()) {
            $hash = password_hash($plaintext, PASSWORD_ARGON2ID, self::ARGON2_OPTIONS);
        } else {
            $hash = password_hash($plaintext, PASSWORD_BCRYPT, ['cost' => 12]);
        }

        if (!is_string($hash) || $hash === '') {
            throw new \RuntimeException('Parola nu a putut fi criptată.');
        }

        return $hash;
    }

    /**
     * Verifies a password.
     *
     * Returns false rather than throwing on a malformed or unrecognised hash,
     * so a corrupt row turns a failed login into a 401 and never a 500.
     */
    public static function verify(string $hash, string $plaintext): bool
    {
        if ($hash === '') {
            return false;
        }
        try {
            return password_verify($plaintext, self::canonicalise($hash));
        } catch (\Throwable) {
            return false;
        }
    }

    /**
     * Puts the Argon2 parameters in the order libargon2 insists on.
     *
     * The two libraries disagree about the encoded form, and only in the order
     * of three fields:
     *
     *   node argon2   $argon2id$v=19$m=19456,p=1,t=2$salt$hash
     *   PHP / libargon2  $argon2id$v=19$m=19456,t=2,p=1$salt$hash
     *
     * The values are identical; only the sequence differs. libargon2's decoder
     * reads the fields positionally, so it rejects Node's ordering outright and
     * `password_verify` returns false for every password ever set through the
     * Node backend — silently, as a wrong password rather than an error.
     *
     * Rewriting the order costs nothing and is not a weakening: the salt, the
     * digest and all three cost parameters are untouched, and a hash that does
     * not match this exact shape is passed through unchanged. Node's verifier
     * accepts the canonical order, so hashes written here stay readable by the
     * Node backend and the two really can share one `users` table.
     */
    private static function canonicalise(string $hash): string
    {
        if (!str_starts_with($hash, '$argon2')) {
            return $hash;
        }

        return (string) preg_replace(
            '/^(\$argon2(?:id|i|d)\$v=\d+\$)m=(\d+),p=(\d+),t=(\d+)\$/',
            '$1m=$2,t=$4,p=$3$',
            $hash,
            1,
        );
    }

    /**
     * A readable temporary password for the technical seed.
     *
     * Avoids the characters people misread when copying from a terminal
     * (`0/O`, `1/l/I`), because this one is transcribed by hand exactly once.
     */
    public static function temporary(int $length = 14): string
    {
        $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
        $max = strlen($alphabet) - 1;

        $out = '';
        for ($i = 0; $i < $length; $i++) {
            $out .= $alphabet[random_int(0, $max)];
        }
        return $out;
    }
}
