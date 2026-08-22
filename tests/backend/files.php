<?php

/**
 * B-F-01…F05 — uploaded files.
 *
 * In production Apache serves `/uploads/` directly and PHP never sees the
 * request. `Storage::serve()` exists so the same paths work where it does not —
 * the built-in server, and this suite.
 *
 * Everything here is about the gap between "the bytes are on disk" and "the
 * browser can fetch them", which is exactly where the 21.08 defect lived: the
 * files were written correctly and Apache still answered 404, because it could
 * not traverse the directories they sat in.
 */

declare(strict_types=1);

Harness::group('Fișiere și /uploads');

$root = Harness::backendRoot();
$uploads = $root . '/storage/uploads';

// A file this suite owns, in a directory this suite creates.
$relative = 'teste/' . date('Y') . '/proba-' . bin2hex(random_bytes(4)) . '.png';
$absolute = $uploads . '/' . $relative;

// A one-pixel PNG, so the served bytes can be compared exactly.
$pixel = base64_decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
);

\Omd\Assets\Storage::write($relative, $pixel);

// --- B-F-05: drepturile directoarelor ---------------------------------------

/*
 * `0755`, not `0770`.
 *
 * These directories sit inside the document root and Apache runs as another
 * user. Without the world-execute bit it cannot traverse them, so every file
 * inside answers 404 — a present file, correct permissions of its own, and a
 * 404 anyway. That is exactly what happened on 21.08 and it took a File Manager
 * screenshot to see it, because nothing about the file itself was wrong.
 *
 * Windows has no POSIX mode bits, so there the check has nothing to say.
 */
if (DIRECTORY_SEPARATOR === '\\') {
    Harness::check('B-F-05', 'drepturile directoarelor — Windows nu are moduri POSIX', true, 'sărit');
} else {
    $mode = fileperms(dirname($absolute)) & 0777;
    Harness::check(
        'B-F-05',
        'directoarele create sunt 0755, ca Apache să poată intra în ele',
        ($mode & 0055) === 0055,
        sprintf('mod 0%o', $mode),
    );
}

// --- B-F-01: un fișier existent se servește ---------------------------------

$served = Harness::raw('GET', '/uploads/' . $relative);

Harness::same('B-F-01a', 'un vizual existent → 200', 200, $served['status']);
Harness::same('B-F-01b', 'tipul de conținut este cel al imaginii', 'image/png', Harness::header($served, 'Content-Type'));
Harness::same('B-F-01c', 'octeții sunt cei scriși', md5($pixel), md5($served['raw']));

/*
 * `nosniff` is not decoration here.
 *
 * The bytes are images the application named and wrote itself, but content-type
 * sniffing is still a way to get a file interpreted as something it is not — and
 * `/uploads/` is the one directory where content arrives from outside.
 */
Harness::same(
    'B-F-01d',
    'răspunsul poartă X-Content-Type-Options: nosniff',
    'nosniff',
    Harness::header($served, 'X-Content-Type-Options'),
);

// --- B-F-02: lipsă → 404 în forma aplicației --------------------------------

$missing = Harness::raw('GET', '/uploads/teste/nu-exista-' . bin2hex(random_bytes(4)) . '.png');
Harness::same('B-F-02a', 'fișier inexistent → 404', 404, $missing['status']);
Harness::same(
    'B-F-02b',
    '404-ul vine în forma de eroare a aplicației',
    'NOT_FOUND',
    $missing['body']['error']['code'] ?? '',
);

// --- B-F-03: ieșirea din rădăcină e refuzată --------------------------------

/*
 * The traversal has to be spelled in a way the HTTP client will not tidy up on
 * the way out: `file_get_contents` normalises `..` in a URL before sending it,
 * so a literal `/uploads/../.env` never reaches the server at all. Percent-encoded,
 * it arrives intact and the application is the one that has to refuse it.
 */
foreach (['%2e%2e%2f.env', '..%2f..%2f.env', 'teste/%2e%2e/%2e%2e/.env'] as $index => $attempt) {
    $traversal = Harness::raw('GET', '/uploads/' . $attempt);
    Harness::check(
        'B-F-03' . chr(97 + $index),
        "traversarea „{$attempt}” nu servește nimic",
        $traversal['status'] === 404 && !str_contains($traversal['raw'], 'DB_PASSWORD'),
        'stare ' . $traversal['status'],
    );
}

// --- B-F-04: separatori nativi și normalizați ---------------------------------

/*
 * `resolve()` turns backslashes into slashes before comparing, so a key stored
 * with Windows separators — which is what a naive `dirname()`/`DIRECTORY_SEPARATOR`
 * concatenation produces on this machine — has to find the same file as one
 * stored with forward slashes. If it did not, the same database would work on
 * the developer's laptop and 404 on the server.
 */
$windowsStyle = str_replace('/', '\\', $relative);
Harness::check(
    'B-F-04',
    'aceeași cheie se rezolvă la fel cu ambii separatori',
    \Omd\Assets\Storage::exists($windowsStyle) && \Omd\Assets\Storage::exists($relative),
    $windowsStyle,
);

// --- Curățenie ---------------------------------------------------------------

@unlink($absolute);
@rmdir(dirname($absolute));
@rmdir(dirname($absolute, 2));
