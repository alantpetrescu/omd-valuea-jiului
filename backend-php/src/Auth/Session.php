<?php

/**
 * Session tokens — port of `auth/session.ts`.
 *
 * Format, signature and cookie are byte-for-byte the Node original's:
 *
 *   <userId>.<expiresAtEpochSeconds>.<hmacSha256 base64url>
 *
 * Because both sign with `AUTH_SECRET` over the same payload, **a session
 * issued by the Node backend is accepted here and vice versa** — the two can
 * run side by side during a migration without logging anyone out.
 *
 * PHP has no `base64url` encoder, so the three-character substitution is done
 * by hand. Getting it wrong would not fail loudly; it would silently reject
 * every token that happened to contain `+` or `/`.
 */

declare(strict_types=1);

namespace Omd\Auth;

use Omd\Config\Env;

final class Session
{
    public const COOKIE = 'omd_session';

    private static function sign(string $payload): string
    {
        $raw = hash_hmac('sha256', $payload, Env::string('AUTH_SECRET'), true);
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }

    /** @return array{token:string,expiresAt:int} */
    public static function issue(string $userId, ?int $now = null): array
    {
        $now ??= time();
        $expiresAt = $now + Env::int('AUTH_TOKEN_TTL');
        $payload = $userId . '.' . $expiresAt;

        return [
            'token' => $payload . '.' . self::sign($payload),
            'expiresAt' => $expiresAt,
        ];
    }

    /** Returns the user id, or null for anything malformed, tampered or expired. */
    public static function read(?string $token, ?int $now = null): ?string
    {
        if ($token === null || $token === '') {
            return null;
        }

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$userId, $expiresAt, $signature] = $parts;
        $expected = self::sign($userId . '.' . $expiresAt);

        // Constant-time compare, so a wrong signature cannot be narrowed down
        // byte by byte from response timing.
        if (!hash_equals($expected, $signature)) {
            return null;
        }

        if (!ctype_digit($expiresAt) || (int) $expiresAt <= ($now ?? time())) {
            return null;
        }

        return $userId;
    }

    /**
     * Sets the session cookie.
     *
     * `HttpOnly` keeps it out of JavaScript, `SameSite=Lax` out of cross-site
     * requests, and `Secure` is on in production — the spec forbids the token
     * ever reaching localStorage.
     */
    public static function setCookie(string $token, int $expiresAt): void
    {
        setcookie(self::COOKIE, $token, [
            'expires' => $expiresAt,
            'path' => '/',
            'httponly' => true,
            'secure' => Env::isProduction(),
            'samesite' => 'Lax',
        ]);
    }

    public static function clearCookie(): void
    {
        setcookie(self::COOKIE, '', [
            'expires' => time() - 3600,
            'path' => '/',
            'httponly' => true,
            'secure' => Env::isProduction(),
            'samesite' => 'Lax',
        ]);
    }
}
