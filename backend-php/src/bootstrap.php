<?php

/**
 * Autoloader and shared bootstrap for the PHP port.
 *
 * No Composer: shared cPanel accounts frequently have no shell, and requiring
 * `composer install` on the host would make the deployment impossible on
 * exactly the plans this port exists to serve. Everything here is written
 * against the PHP standard library.
 *
 * Class `Omd\Campaigns\CampaignRoutes` lives in `src/Campaigns/CampaignRoutes.php`.
 */

declare(strict_types=1);

/**
 * Idempotent: setup.php requires this, then requires a script in bin/ which
 * requires it again. Registering the autoloader twice would work but would
 * double every lookup.
 */
if (defined('OMD_BOOTSTRAPPED')) {
    return;
}
define('OMD_BOOTSTRAPPED', true);

spl_autoload_register(static function (string $class): void {
    $prefix = 'Omd\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $path = __DIR__ . '/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($path)) {
        require_once $path;
    }
});

/**
 * PHP 8.1 is the floor.
 *
 * `readonly` properties are the binding constraint — they appear on the DTOs
 * and on ApiError, and they are a parse error on 8.0. A parse error happens at
 * compile time, so the check below could not report it for those files; it
 * exists to fail with a readable message rather than a blank 500 when the
 * version is obviously too old.
 */
if (PHP_VERSION_ID < 80100) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'error' => [
            'code' => 'INTERNAL_ERROR',
            'message' => 'PHP 8.1 sau mai nou este necesar.',
            'details' => ['versiunea curentă: ' . PHP_VERSION],
            'requestId' => null,
        ],
    ], JSON_UNESCAPED_UNICODE);
    exit;
}
