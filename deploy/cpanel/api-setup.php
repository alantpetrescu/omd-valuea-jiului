<?php

/**
 * Installer shim — upload to `public_html/api/setup.php`.
 *
 * Reaches the same installer the CLI would run, for a host with no Terminal.
 * It refuses without `APP_SECRET` as a token, refuses over plain HTTP, and logs
 * every call with the caller's address.
 *
 *   https://<domeniu>/api/setup.php?token=<APP_SECRET>&action=check
 *   ...&action=migrate
 *   ...&action=seed
 *   ...&action=import
 *
 * DELETE THIS FILE once the database is set up. Deleting the shim is enough —
 * the real installer sits outside the docroot and becomes unreachable.
 *
 * The path is derived from this file's own location, for the reason explained
 * in `api-index.php`: a hard-coded home directory is a step that gets missed,
 * and missing it produces a blank 500 that explains nothing.
 */

declare(strict_types=1);

/** Override only if the backend is not at `<home>/omd/backend-php`. */
$backend = dirname(__DIR__, 2) . '/omd/backend-php';

$entry = $backend . '/public/setup.php';

if (!is_file($entry)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => [
            'code' => 'INTERNAL_ERROR',
            'message' => 'Instalatorul nu a fost găsit la calea așteptată.',
            'details' => [
                'căutat' => $entry,
                'acestFisier' => __FILE__,
                'sugestie' => 'Verifică unde ai dezarhivat omd-backend.zip, apoi corectează $backend în acest fișier.',
            ],
            'requestId' => null,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

require $entry;
