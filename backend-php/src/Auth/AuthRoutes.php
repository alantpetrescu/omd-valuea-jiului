<?php

/**
 * Auth endpoints — port of `auth/auth-routes.ts`.
 *
 *   POST /api/v1/auth/login
 *   POST /api/v1/auth/logout
 *   GET  /api/v1/auth/me
 *   POST /api/v1/auth/change-password
 */

declare(strict_types=1);

namespace Omd\Auth;

use Omd\Audit\Audit;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Support\Password;
use Omd\Support\RateLimiter;
use Omd\Support\Validate;

final class AuthRoutes
{
    public static function register(Router $router): void
    {
        $router->post('/api/v1/auth/login', [self::class, 'login']);
        $router->post('/api/v1/auth/logout', [self::class, 'logout']);
        $router->get('/api/v1/auth/me', [self::class, 'me'], [[Guard::class, 'requireAuth']]);
        $router->post(
            '/api/v1/auth/change-password',
            [self::class, 'changePassword'],
            [[Guard::class, 'requireAuth']],
        );
    }

    public static function login(Request $request): void
    {
        $v = new Validate($request->body());
        $email = $v->string('email', required: true, max: 255);
        $password = $v->string('password', required: true);
        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $v->fail('email', 'Adresa de e-mail nu este validă.');
        }
        $v->check('Datele de autentificare nu sunt valide.');

        $key = $request->ip() . '|' . strtolower($email);

        if (RateLimiter::tooManyAttempts($key)) {
            throw ApiError::conflict(
                'Prea multe încercări de autentificare. Încearcă din nou peste 15 minute.'
            );
        }

        $row = Db::one(
            'SELECT u.id, u.name, u.email, u.password_hash, u.is_active, u.must_change_password,
                    r.code AS role
               FROM users u JOIN roles r ON r.id = u.role_id
              WHERE u.email = ?',
            [$email],
        );

        // The same message whether the account is missing, deactivated or the
        // password is wrong — nothing here reveals which accounts exist.
        $invalid = ApiError::unauthenticated('E-mail sau parolă incorecte.');

        if ($row === null || (int) $row['is_active'] !== 1) {
            RateLimiter::recordFailure($key);
            throw $invalid;
        }
        if (!Password::verify((string) $row['password_hash'], $password)) {
            RateLimiter::recordFailure($key);
            throw $invalid;
        }

        RateLimiter::clear($key);
        if (random_int(1, 50) === 1) {
            RateLimiter::sweep();
        }

        $session = Session::issue((string) $row['id']);
        Session::setCookie($session['token'], $session['expiresAt']);

        Db::execute('UPDATE users SET last_login_at = CURRENT_TIMESTAMP(6) WHERE id = ?', [$row['id']]);
        Audit::write(
            userId: (string) $row['id'],
            action: 'LOGIN',
            entityType: 'USER',
            entityId: (string) $row['id'],
            entityExternalKey: (string) $row['email'],
        );

        Response::data([
            'id' => $row['id'],
            'name' => $row['name'],
            'email' => $row['email'],
            'role' => $row['role'],
            'mustChangePassword' => (int) $row['must_change_password'] === 1,
        ]);
    }

    public static function logout(Request $request): void
    {
        Session::clearCookie();
        Response::data(['ok' => true]);
    }

    public static function me(Request $request): void
    {
        Response::data($request->user?->toArray());
    }

    public static function changePassword(Request $request): void
    {
        $v = new Validate($request->body());
        $current = $v->string('currentPassword', required: true);
        $new = $v->string('newPassword', required: true);
        if ($new !== '' && mb_strlen($new) < 10) {
            $v->fail('newPassword', 'Parola nouă trebuie să aibă minimum 10 caractere.');
        }
        $v->check('Parola nouă nu este validă.');

        $user = $request->user;
        if ($user === null) {
            throw ApiError::unauthenticated();
        }

        $row = Db::one('SELECT password_hash FROM users WHERE id = ?', [$user->id]);
        if ($row === null || !Password::verify((string) $row['password_hash'], $current)) {
            throw ApiError::unauthenticated('Parola actuală este incorectă.');
        }

        Db::execute(
            'UPDATE users SET password_hash = ?, must_change_password = 0, updated_by = ? WHERE id = ?',
            [Password::hash($new), $user->id, $user->id],
        );

        Audit::write(
            userId: $user->id,
            action: 'USER_CHANGE',
            entityType: 'USER',
            entityId: $user->id,
            entityExternalKey: $user->email,
            newValues: ['passwordChanged' => true],
        );

        Response::data(Guard::loadUser($user->id)?->toArray());
    }
}
