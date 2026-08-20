<?php

/**
 * Front controller shim — upload to `public_html/api/index.php`.
 *
 * The application lives outside the document root, where the web server cannot
 * reach it directly. Apache on shared hosting cannot Alias a path outside the
 * docroot from `.htaccess`, so this one-line file inside the docroot stands in
 * for that: the only thing the internet can reach is this `require`.
 *
 * `__DIR__` resolves per file, so the real front controller still finds its own
 * bootstrap, and `Env::repoRoot()` still resolves to the folder holding
 * `contracts/` and `database/`. Nothing here needs to know those paths.
 *
 * The request URI is untouched, which is what matters: the route table declares
 * full `/api/v1/...` paths, exactly as the Express routers do.
 *
 * EDIT THE PATH BELOW if the cPanel account is not `visit`.
 */

declare(strict_types=1);

require '/home/visit/omd/backend-php/public/index.php';
