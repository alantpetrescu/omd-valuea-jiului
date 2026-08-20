<?php

/**
 * Installer shim — upload to `public_html/api/setup.php`.
 *
 * Reaches the same installer the CLI would run, for a host with no Terminal.
 * It refuses without `APP_SECRET` as a token, refuses over plain HTTP, and logs
 * every call with the caller's address.
 *
 *   https://visitvaleajiului.ro/api/setup.php?token=<APP_SECRET>
 *   ...&action=migrate
 *   ...&action=seed
 *   ...&action=import
 *
 * DELETE THIS FILE once the database is set up. Deleting the shim is enough —
 * the real installer sits outside the docroot and becomes unreachable.
 *
 * EDIT THE PATH BELOW if the cPanel account is not `visit`.
 */

declare(strict_types=1);

require '/home/visit/omd/backend-php/public/setup.php';
