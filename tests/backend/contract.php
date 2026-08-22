<?php

/**
 * B-E-01…E04, B-P-01…P03 — the error and pagination contracts.
 *
 * These are the two shapes every client depends on and no single endpoint owns,
 * which is why they get their own file: a change here breaks every screen at
 * once, and a test attached to one endpoint would not say so.
 */

declare(strict_types=1);

Harness::group('Contractul de eroare și paginarea');

// --- B-E-01: forma unei erori ------------------------------------------------

$notFound = Harness::request('GET', '/api/v1/campaigns/camp-care-nu-exista-' . bin2hex(random_bytes(3)));
Harness::same('B-E-01a', 'o cheie inexistentă → 404', 404, $notFound['status']);

$error = $notFound['body']['error'] ?? null;
foreach (['code' => 'b', 'message' => 'c', 'details' => 'd', 'requestId' => 'e'] as $field => $letter) {
    Harness::check(
        'B-E-01' . $letter,
        "eroarea are câmpul „{$field}”",
        is_array($error) && array_key_exists($field, $error),
        json_encode($error),
    );
}

/*
 * `requestId` above is the one field that is useless to the screen and essential
 * afterwards: it is what connects "the user saw an error" to a line in the log.
 * A null value is allowed — a failure before the request is parsed has no id yet
 * — but the key has to be there, or the client has nothing to show.
 */

// --- B-E-02: o rută inexistentă răspunde la fel ------------------------------

$noRoute = Harness::request('GET', '/api/v1/rutainexistenta');
Harness::same('B-E-02a', 'rută inexistentă → 404', 404, $noRoute['status']);
Harness::same('B-E-02b', 'nu o pagină HTML, ci forma aplicației', 'NOT_FOUND', Harness::errorCode($noRoute));
Harness::check(
    'B-E-02c',
    'răspunsul nu conține HTML',
    !str_contains(strtolower($noRoute['raw']), '<html'),
    substr($noRoute['raw'], 0, 120),
);

/*
 * A path that matches a route only on the wrong verb is a 404 too, not a 405.
 * A 405 with an `Allow` header would enumerate the API for anyone who asks; the
 * Node app answered 404 here and the port kept the behaviour.
 */
$wrongVerb = Harness::request('DELETE', '/api/v1/campaigns');
Harness::same('B-E-02d', 'verb greșit pe o rută existentă → 404', 404, $wrongVerb['status']);

// --- B-E-03: nimic din interior nu iese --------------------------------------

/*
 * The stack trace test, done the only way it can be done without breaking the
 * application on purpose: force a failure through a route that has to touch the
 * database with input it cannot use, then check that nothing internal is in the
 * answer. Paths, SQL and class names all say more about the server than a client
 * has any business knowing.
 */
$leaky = Harness::request('GET', '/api/v1/admin/catalogs/tabela_inexistenta');
$body = strtolower($leaky['raw']);

$leaks = array_values(array_filter(
    ['#0 ', 'stack trace', '.php:', 'pdoexception', 'sqlstate', '/home/', 'd:\\'],
    static fn (string $needle): bool => str_contains($body, $needle),
));

Harness::check(
    'B-E-03',
    'un eșec nu scurge urma stivei, calea sau SQL-ul',
    $leaks === [],
    'găsite: ' . implode(', ', $leaks),
);

// --- B-E-04: 409 poartă acțiunea permisă -------------------------------------

/*
 * A refusal that only says "no" leaves the user stuck. `ENTITY_IN_USE` carries
 * `details.allowedAction` precisely so the screen can offer the way out —
 * deactivate instead of delete, close instead of remove — rather than making
 * them guess.
 *
 * The pair is created here rather than looked for. A campaign with an activation
 * may or may not be in the fixture, and a test that skipped when it was not
 * would be a test reporting success for having found nothing to do.
 */
$parent = Harness::request('POST', '/api/v1/campaigns', Harness::campaignPayload([
    'title' => 'Campanie cu istoric ' . substr(Harness::uuid(), 0, 8),
    'statusCode' => 'ACTIVE',
]));
$usedCampaign = (string) ($parent['body']['data']['id'] ?? '');

if ($usedCampaign === '') {
    Harness::check('B-E-04', 'campania de probă nu a putut fi creată', false, json_encode($parent['body']));
} else {
    Harness::track('campaigns', $usedCampaign);

    $child = Harness::request('POST', '/api/v1/activations', Harness::activationPayload([
        'title' => 'Activare care ține campania în loc',
        'campaignExternalKey' => $usedCampaign,
    ]));
    Harness::track('activations', (string) ($child['body']['data']['id'] ?? ''));

    $refused = Harness::request('DELETE', "/api/v1/campaigns/{$usedCampaign}");
    Harness::same('B-E-04a', 'ștergerea unei campanii cu istoric → 409', 409, $refused['status']);
    Harness::same('B-E-04b', 'codul este ENTITY_IN_USE', 'ENTITY_IN_USE', Harness::errorCode($refused));
    Harness::check(
        'B-E-04c',
        'refuzul spune ce se poate face în schimb',
        ($refused['body']['error']['details']['allowedAction'] ?? '') !== '',
        json_encode($refused['body']['error']['details'] ?? null),
    );
}

// --- B-P-01…P03: paginarea ---------------------------------------------------

$page = Harness::request('GET', '/api/v1/campaigns?page=1&pageSize=2');
Harness::same('B-P-01a', 'GET cu paginare → 200', 200, $page['status']);

$meta = $page['body']['meta'] ?? [];
foreach (['total' => 'b', 'page' => 'c', 'pageSize' => 'd'] as $field => $letter) {
    Harness::check(
        'B-P-01' . $letter,
        "meta are câmpul „{$field}”",
        array_key_exists($field, $meta),
        json_encode($meta),
    );
}

Harness::check(
    'B-P-01u',
    'meta.totalUnfiltered spune câte sunt în total',
    ($meta['totalUnfiltered'] ?? null) !== null,
    json_encode($meta),
);
Harness::check(
    'B-P-01c',
    'pagina cerută are cel mult pageSize rânduri',
    count($page['body']['data'] ?? []) <= 2,
    (string) count($page['body']['data'] ?? []),
);

/*
 * A page size above the ceiling is capped, not refused.
 *
 * The alternative — a 422 — turns a client that asks for too much into a client
 * that shows nothing. Capping gives it a smaller answer and a `meta` that says
 * what it actually got.
 */
$huge = Harness::request('GET', '/api/v1/campaigns?page=1&pageSize=100000');
Harness::same('B-P-02a', 'pageSize peste plafon nu e refuzat', 200, $huge['status']);
Harness::check(
    'B-P-02b',
    'pageSize peste plafon este plafonat',
    (int) ($huge['body']['meta']['pageSize'] ?? PHP_INT_MAX) < 100000,
    json_encode($huge['body']['meta'] ?? null),
);

/*
 * A page past the end is an empty list, not an error. The user who clicks
 * "next" once too often, or comes back to a bookmarked page 9 after rows were
 * deleted, should see an empty table — not a red banner.
 */
$beyond = Harness::request('GET', '/api/v1/campaigns?page=9999&pageSize=20');
Harness::same('B-P-03a', 'pagină în afara intervalului → 200', 200, $beyond['status']);
Harness::same('B-P-03b', 'și o listă goală', [], $beyond['body']['data'] ?? null);

/*
 * Bad input in the paging parameters falls back to the defaults rather than
 * failing. These arrive from a URL the user can edit, and the sane answer to
 * `?page=abc` is the first page.
 */
$nonsense = Harness::request('GET', '/api/v1/campaigns?page=abc&pageSize=-5');
Harness::same('B-P-03c', 'parametri fără sens → tot 200', 200, $nonsense['status']);
Harness::check(
    'B-P-03d',
    'și valori implicite rezonabile',
    (int) ($nonsense['body']['meta']['page'] ?? 0) >= 1
        && (int) ($nonsense['body']['meta']['pageSize'] ?? 0) >= 1,
    json_encode($nonsense['body']['meta'] ?? null),
);
