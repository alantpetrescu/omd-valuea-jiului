<?php

/**
 * B-A-01…A09 — authentication and session.
 *
 * These are the only tests that must not use `Harness::request()`: it logs in
 * for you and caches the cookie, which is exactly the machinery under test.
 * Everything here goes through `Harness::raw()` and looks at the headers.
 *
 * `B-A-09` (the rate limiter) is deliberately last and deliberately cleans up
 * after itself — ten failed attempts against the same key would otherwise lock
 * out every login for the following fifteen minutes, including the ones the
 * rest of the suite makes.
 */

declare(strict_types=1);

Harness::group('Autentificare și sesiune');

$login = '/api/v1/auth/login';

// --- Ce trece --------------------------------------------------------------

$ok = Harness::raw('POST', $login, [
    'email' => 'admin@test.local',
    'password' => Harness::PASSWORD,
]);

Harness::same('B-A-01a', 'login corect → 200', 200, $ok['status']);
Harness::check(
    'B-A-01b',
    'login corect pune un cookie de sesiune',
    Harness::sessionCookie($ok) !== null,
    Harness::header($ok, 'Set-Cookie') ?? 'niciun Set-Cookie',
);
Harness::same(
    'B-A-01c',
    'răspunsul spune rolul',
    'ADMIN',
    $ok['body']['data']['role'] ?? ($ok['body']['data']['user']['role'] ?? null),
);

$cookie = Harness::sessionCookie($ok) ?? '';

/*
 * The session cookie must be HttpOnly.
 *
 * Not in the spec's test list, and it belongs here anyway: a session readable
 * from JavaScript is a session any injected script can take, and the attribute
 * is one word that is easy to drop while editing the line it sits on.
 */
Harness::check(
    'B-A-01d',
    'cookie-ul de sesiune este HttpOnly',
    stripos(Harness::header($ok, 'Set-Cookie') ?? '', 'httponly') !== false,
    Harness::header($ok, 'Set-Cookie') ?? '',
);

// --- Ce nu trece -----------------------------------------------------------

$wrongPassword = Harness::raw('POST', $login, [
    'email' => 'admin@test.local',
    'password' => 'nu-este-parola',
]);
Harness::same('B-A-02a', 'parolă greșită → 401', 401, $wrongPassword['status']);
Harness::check(
    'B-A-02b',
    'parolă greșită nu pune cookie',
    Harness::sessionCookie($wrongPassword) === null,
);

$noSuchUser = Harness::raw('POST', $login, [
    'email' => 'nimeni-' . bin2hex(random_bytes(4)) . '@test.local',
    'password' => Harness::PASSWORD,
]);
Harness::same('B-A-03a', 'e-mail inexistent → 401', 401, $noSuchUser['status']);

/*
 * The message must be identical to the wrong-password one.
 *
 * This is the case worth having in the file. A distinct "no such account" reply
 * turns the login form into a directory: an attacker learns which addresses are
 * real before trying a single password. Both branches also have to cost about
 * the same, but timing is not something this suite can measure honestly.
 */
Harness::same(
    'B-A-03b',
    'același mesaj pentru cont inexistent și parolă greșită',
    $wrongPassword['body']['error']['message'] ?? 'A',
    $noSuchUser['body']['error']['message'] ?? 'B',
);

// --- Cont dezactivat -------------------------------------------------------

$email = 'suspendat-' . bin2hex(random_bytes(4)) . '@test.local';
$roleId = Harness::scalar("SELECT id FROM roles WHERE code = 'VIEWER'");
Harness::exec(
    'INSERT INTO users (id, role_id, name, email, password_hash, is_active) VALUES (?, ?, ?, ?, ?, 0)',
    [Harness::uuid(), $roleId, 'Cont suspendat', $email, \Omd\Support\Password::hash(Harness::PASSWORD)],
);

$suspended = Harness::raw('POST', $login, ['email' => $email, 'password' => Harness::PASSWORD]);
Harness::same('B-A-04', 'cont dezactivat → 401', 401, $suspended['status']);

// --- Sesiunea --------------------------------------------------------------

$anonymous = Harness::raw('GET', '/api/v1/auth/me');
Harness::same('B-A-05', 'GET /auth/me fără cookie → 401', 401, $anonymous['status']);

$corrupt = Harness::raw('GET', '/api/v1/auth/me', null, ['Cookie: omd_session=nu-este-un-token']);
Harness::same('B-A-06a', 'cookie stricat → 401', 401, $corrupt['status']);
Harness::check(
    'B-A-06b',
    'cookie stricat nu produce 500',
    $corrupt['status'] !== 500,
    'primit ' . $corrupt['status'],
);

$me = Harness::raw('GET', '/api/v1/auth/me', null, ['Cookie: ' . $cookie]);
Harness::same('B-A-07a', 'GET /auth/me cu cookie → 200', 200, $me['status']);

$mustChange = $me['body']['data']['mustChangePassword'] ?? ($me['body']['data']['user']['mustChangePassword'] ?? null);
Harness::check(
    'B-A-08',
    '/auth/me raportează mustChangePassword',
    $mustChange !== null,
    'câmpul lipsește din răspuns',
);

$loggedOut = Harness::raw('POST', '/api/v1/auth/logout', null, ['Cookie: ' . $cookie]);

/*
 * What logout actually contracts is that the browser stops holding a session:
 * the response clears the cookie, so the next request carries nothing.
 *
 * It does **not** revoke the token. Sessions are stateless — a signed
 * `userId.expiresAt.signature` with no server-side record — so a token captured
 * before logout keeps working until it expires. That is a real property of the
 * design, written down in KNOWN_DEVIATIONS.md as D-008; it is deliberately not
 * asserted here, because a green check saying "the old token still works" would
 * read as the intended behaviour rather than as the limitation it is.
 */
$clearing = Harness::header($loggedOut, 'Set-Cookie') ?? '';
Harness::check(
    'B-A-07b',
    'logout trimite un cookie care expiră imediat',
    str_starts_with($clearing, \Omd\Auth\Session::COOKIE . '=')
        && (str_contains($clearing, 'Max-Age=0') || str_contains($clearing, '1970')),
    $clearing !== '' ? $clearing : 'niciun Set-Cookie',
);

$afterLogout = Harness::raw('GET', '/api/v1/auth/me', null, ['Cookie: ' . \Omd\Auth\Session::COOKIE . '=']);
Harness::same('B-A-07c', 'cu cookie-ul golit, /auth/me → 401', 401, $afterLogout['status']);

// --- Limitatorul de rată ---------------------------------------------------

/*
 * Its own address, on purpose.
 *
 * The limiter keys on IP + e-mail and every test here shares the IP, so hammering
 * `admin@test.local` would lock out the account the rest of the suite logs in
 * with. A throwaway address that no other test uses fails in isolation.
 */
$victim = 'ratelimit-' . bin2hex(random_bytes(4)) . '@test.local';
$statuses = [];
for ($attempt = 0; $attempt < 12; $attempt++) {
    $statuses[] = Harness::raw('POST', $login, ['email' => $victim, 'password' => 'gresit'])['status'];
}

/*
 * 409, not 429.
 *
 * `Too Many Requests` is the code this deserves, and the application answers
 * `ApiError::conflict` instead. That is a deviation worth knowing about — it is
 * D-009 — but it is the shipped contract, and a test that demanded 429 would
 * fail every run while proving nothing about whether the limiter works. What
 * matters here is that ten wrong passwords stop being answered with "wrong
 * password" and start being refused outright.
 */
$refusals = array_values(array_filter($statuses, static fn (int $status): bool => $status === 409));

Harness::check(
    'B-A-09a',
    'după 10 încercări greșite, autentificarea e refuzată, nu doar respinsă',
    $refusals !== [],
    'stări primite: ' . implode(',', array_unique($statuses)),
);
Harness::same(
    'B-A-09b',
    'primele încercări primesc 401, nu refuzul limitatorului',
    401,
    $statuses[0],
);

// The limiter keeps one file per key under `storage/rate-limit/`; the lock is
// on disk, so it outlives the run unless it is removed here.
foreach (glob(Harness::backendRoot() . '/storage/rate-limit/*') ?: [] as $file) {
    @unlink($file);
}

Harness::exec('DELETE FROM users WHERE email IN (?, ?)', [$email, $victim]);
