<?php

/**
 * Authentication and role enforcement — port of `auth/middleware.ts`.
 *
 * The backend is the security authority. Hiding buttons in React is
 * convenience, never protection: every protected route re-checks the role here,
 * and `is_active` is re-read from the database on every single request, so
 * deactivating an account takes effect immediately rather than when its token
 * happens to expire.
 */

declare(strict_types=1);

namespace Omd\Auth;

use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;

final class Guard
{
    public static function loadUser(string $userId): ?AuthenticatedUser
    {
        $row = Db::one(
            'SELECT u.id, u.name, u.email, r.code AS role, u.is_active, u.must_change_password
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.id = ?',
            [$userId],
        );

        // A deactivated account is rejected even with a still-valid token.
        if ($row === null || (int) $row['is_active'] !== 1) {
            return null;
        }

        return new AuthenticatedUser(
            (string) $row['id'],
            (string) $row['name'],
            (string) $row['email'],
            (string) $row['role'],
            (int) $row['must_change_password'] === 1,
        );
    }

    /** Attaches the user when a valid session cookie is present. Never rejects. */
    public static function attachUser(Request $request): void
    {
        $userId = Session::read($request->cookies[Session::COOKIE] ?? null);
        if ($userId !== null) {
            $request->user = self::loadUser($userId);
        }
    }

    public static function requireAuth(Request $request): void
    {
        if ($request->user === null) {
            throw ApiError::unauthenticated();
        }
    }

    /** @param list<string> $roles */
    public static function requireRole(array $roles): callable
    {
        return static function (Request $request) use ($roles): void {
            if ($request->user === null) {
                throw ApiError::unauthenticated();
            }
            if (!in_array($request->user->role, $roles, true)) {
                throw ApiError::forbidden();
            }
        };
    }

    /** Anything that writes: ADMIN and EDITOR only. VIEWER is read-only. */
    public static function requireWrite(): callable
    {
        return self::requireRole(['ADMIN', 'EDITOR']);
    }

    public static function requireAdmin(): callable
    {
        return self::requireRole(['ADMIN']);
    }

    /**
     * The id of whoever is acting, for audit rows.
     *
     * Null is legitimate: the technical seed and the import CLI both write
     * audit entries with no user behind them.
     */
    public static function actorId(Request $request): ?string
    {
        return $request->user?->id;
    }
}
