<?php

/**
 * B-R-01…R06 — the role gate, over the whole surface.
 *
 * `api.php` checks permissions on the strategy endpoints. This file checks
 * every other route, and it does so by reading the route table out of the
 * source rather than from a list kept here.
 *
 * That is the whole point. A hand-written list only covers the routes someone
 * remembered to add to it, so the one case it can never catch is the one that
 * matters: a new endpoint shipped without a guard. Scanning the source means a
 * route that exists is a route that gets probed, whether or not anybody thought
 * about this file when they wrote it.
 */

declare(strict_types=1);

Harness::group('Roluri, pe toată suprafața');

// --- Tabela de rute, citită din sursă --------------------------------------

/** @return list<array{method:string,pattern:string}> */
$routeTable = static function (): array {
    $root = Harness::backendRoot();
    $files = array_merge(
        glob($root . '/src/*/*Routes.php') ?: [],
        [$root . '/public/index.php'],
    );

    $routes = [];
    foreach ($files as $file) {
        $source = file_get_contents($file) ?: '';
        preg_match_all(
            '/\$router->(get|post|put|delete)\(\s*\'([^\']+)\'/',
            $source,
            $matches,
            PREG_SET_ORDER,
        );
        foreach ($matches as $match) {
            $routes[] = ['method' => strtoupper($match[1]), 'pattern' => $match[2]];
        }
    }

    usort($routes, static fn (array $a, array $b): int => [$a['pattern'], $a['method']] <=> [$b['pattern'], $b['method']]);
    return $routes;
};

$routes = $routeTable();

Harness::check(
    'B-R-00',
    'tabela de rute a fost găsită în sursă',
    count($routes) >= 40,
    count($routes) . ' rute — dacă e mult sub 50, expresia de căutare nu mai prinde forma din sursă',
);

// --- Valori reale pentru parametri ------------------------------------------

/*
 * Real keys where the database has them.
 *
 * A guard runs before the handler, so a made-up key would prove the same thing
 * about the guard — but a 404 also hides whether a reader could have read it.
 * With real keys the read probes come back 200 and say both things at once.
 */
$campaignKey = (string) (Harness::scalar('SELECT external_key FROM campaigns WHERE deleted_at IS NULL LIMIT 1') ?: 'camp-inexistent');
$activationKey = (string) (Harness::scalar('SELECT external_key FROM activations WHERE deleted_at IS NULL LIMIT 1') ?: 'act-inexistent');
$versionKey = (string) (Harness::scalar('SELECT external_key FROM strategy_versions LIMIT 1') ?: 'sv-inexistent');
$objectiveCode = (string) (Harness::scalar('SELECT code FROM strategic_objectives LIMIT 1') ?: 'OS1');
$materialKey = (string) (Harness::scalar('SELECT external_key FROM activation_materials LIMIT 1') ?: 'mat-inexistent');
$importId = (string) (Harness::scalar('SELECT id FROM import_batches LIMIT 1') ?: Harness::uuid());
$catalogCode = (string) (Harness::scalar('SELECT code FROM activation_channels LIMIT 1') ?: 'FB');

$fill = static function (string $pattern) use (
    $campaignKey, $activationKey, $versionKey, $objectiveCode, $materialKey, $importId, $catalogCode
): string {
    $isActivation = str_contains($pattern, '/activations/');

    return strtr($pattern, [
        ':externalKey' => $isActivation ? $activationKey : $campaignKey,
        ':materialExternalKey' => $materialKey,
        ':versionKey' => $versionKey,
        ':kind' => 'objectives',
        ':catalog' => 'activation_channels',
        ':code' => str_contains($pattern, '/admin/catalogs/') ? $catalogCode : $objectiveCode,
        ':id' => $importId,
        ':year' => (string) (int) date('Y'),
    ]);
};

/*
 * Everything a session is not required for.
 *
 * `logout` belongs here: it clears a cookie, and clearing one you do not have is
 * a no-op. Answering 401 would mean a user whose session had already expired
 * could not press "Ieși din cont" without being told off.
 */
$public = [
    '/api/v1/health',
    '/api/v1/health/ready',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
];

// --- B-R-06: nimic fără sesiune ---------------------------------------------

$leaks = [];
foreach ($routes as $route) {
    if (in_array($route['pattern'], $public, true)) {
        continue;
    }

    $response = Harness::raw($route['method'], $fill($route['pattern']), $route['method'] === 'GET' ? null : []);
    if ($response['status'] !== 401) {
        $leaks[] = sprintf('%s %s → %d', $route['method'], $route['pattern'], $response['status']);
    }
}

Harness::check(
    'B-R-06',
    'neautentificat → 401 pe fiecare rută care nu e publică',
    $leaks === [],
    implode('; ', array_slice($leaks, 0, 6)),
);

// --- B-R-05: citirile sunt deschise celor două roluri de citire -------------

foreach (['VIEWER', 'EDITOR'] as $role) {
    $refused = [];
    foreach ($routes as $route) {
        if ($route['method'] !== 'GET'
            || in_array($route['pattern'], $public, true)
            || str_starts_with($route['pattern'], '/api/v1/admin/')
        ) {
            continue;
        }

        $response = Harness::request('GET', $fill($route['pattern']), null, $role);
        // A 404 for a key this database does not have is a correct answer and
        // says nothing about the gate; only 401 and 403 do.
        if (in_array($response['status'], [401, 403], true)) {
            $refused[] = sprintf('%s → %d', $route['pattern'], $response['status']);
        }
    }

    Harness::check(
        'B-R-05' . ($role === 'VIEWER' ? 'a' : 'b'),
        "{$role} poate citi toate rutele care nu sunt de administrare",
        $refused === [],
        implode('; ', array_slice($refused, 0, 6)),
    );
}

// --- B-R-01, B-R-02: VIEWER nu scrie ----------------------------------------

$writes = [
    ['POST', '/api/v1/campaigns', Harness::campaignPayload()],
    ['PUT', "/api/v1/campaigns/{$campaignKey}", Harness::campaignPayload()],
    ['DELETE', "/api/v1/campaigns/{$campaignKey}", null],
    ['POST', "/api/v1/campaigns/{$campaignKey}/restore", null],
];

$allowed = [];
foreach ($writes as [$method, $path, $body]) {
    $response = Harness::request($method, $path, $body, 'VIEWER');
    if ($response['status'] !== 403) {
        $allowed[] = sprintf('%s %s → %d', $method, $path, $response['status']);
    }
}
Harness::check('B-R-01', 'VIEWER nu poate scrie pe campanii', $allowed === [], implode('; ', $allowed));

$activationWrites = [
    ['POST', '/api/v1/activations', Harness::activationPayload()],
    ['PUT', "/api/v1/activations/{$activationKey}", Harness::activationPayload()],
    ['DELETE', "/api/v1/activations/{$activationKey}", null],
];

$allowed = [];
foreach ($activationWrites as [$method, $path, $body]) {
    $response = Harness::request($method, $path, $body, 'VIEWER');
    if ($response['status'] !== 403) {
        $allowed[] = sprintf('%s %s → %d', $method, $path, $response['status']);
    }
}
Harness::check('B-R-02', 'VIEWER nu poate scrie pe activări', $allowed === [], implode('; ', $allowed));

// --- B-R-03: EDITOR scrie ----------------------------------------------------

$created = Harness::request('POST', '/api/v1/campaigns', Harness::campaignPayload([
    'title' => 'Campanie creată de EDITOR ' . substr(Harness::uuid(), 0, 8),
]), 'EDITOR');
Harness::same('B-R-03a', 'EDITOR poate crea o campanie', 201, $created['status']);

$editorKey = (string) ($created['body']['data']['id'] ?? '');
if ($editorKey !== '') {
    Harness::track('campaigns', $editorKey);
}

$editorActivation = Harness::request('POST', '/api/v1/activations', Harness::activationPayload([
    'title' => 'Activare creată de EDITOR ' . substr(Harness::uuid(), 0, 8),
]), 'EDITOR');
Harness::same('B-R-03b', 'EDITOR poate crea o activare', 201, $editorActivation['status']);

$editorActivationKey = (string) ($editorActivation['body']['data']['id'] ?? '');
if ($editorActivationKey !== '') {
    Harness::track('activations', $editorActivationKey);
}

// --- B-R-04: administrarea e doar a ADMIN-ului -------------------------------

$adminRoutes = array_values(array_filter(
    $routes,
    static fn (array $route): bool => str_starts_with($route['pattern'], '/api/v1/admin/'),
));

$reached = [];
foreach ($adminRoutes as $route) {
    $response = Harness::request(
        $route['method'],
        $fill($route['pattern']),
        $route['method'] === 'GET' ? null : [],
        'EDITOR',
    );
    if ($response['status'] !== 403) {
        $reached[] = sprintf('%s %s → %d', $route['method'], $route['pattern'], $response['status']);
    }
}

Harness::check(
    'B-R-04',
    'EDITOR nu ajunge pe nicio rută de administrare',
    $reached === [],
    implode('; ', array_slice($reached, 0, 6)),
);
