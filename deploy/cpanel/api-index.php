<?php

/**
 * Front controller shim — upload to `public_html/api/index.php`.
 *
 * The application lives outside the document root, where the web server cannot
 * reach it directly. Apache on shared hosting cannot Alias a path outside the
 * docroot from `.htaccess`, so this one file inside the docroot stands in for
 * that: the only thing the internet can reach is the `require` below.
 *
 * `__DIR__` resolves per file, so the real front controller still finds its own
 * bootstrap, and `Env::repoRoot()` still resolves to the folder holding
 * `contracts/` and `database/`. Nothing here needs to know those paths.
 *
 * The request URI is untouched, which is what matters: the route table declares
 * full `/api/v1/...` paths, exactly as the Express routers do.
 *
 * The path is derived rather than written in. This file sits at
 * `<home>/public_html/api/`, so two levels up is the account home, and the
 * backend is at `<home>/omd/backend-php` where the runbook puts it.
 *
 * It used to be a literal `/home/visit/...` with a comment saying to edit it on
 * another account. On the second deployment the account name was not what the
 * database prefix suggested, `require` hit a file that was not there, and PHP
 * died before a line of our code ran — a 500 with an empty body, which says
 * nothing about what is wrong. Deriving the path removes the step, and the
 * check below replaces the silence with an answer.
 */

declare(strict_types=1);

/** Override only if the backend is not at `<home>/omd/backend-php`. */
$backend = dirname(__DIR__, 2) . '/omd/backend-php';

$entry = $backend . '/public/index.php';

if (!is_file($entry)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => [
            'code' => 'INTERNAL_ERROR',
            'message' => 'Backendul nu a fost găsit la calea așteptată.',
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
