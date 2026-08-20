<?php

/**
 * Front controller — port of `app.ts` and `server.ts`.
 *
 * Apache rewrites every request here (see .htaccess), so this file plays the
 * part Express's app object did: build the route table, attach the user, run
 * the handler, and turn anything thrown into the API's error shape.
 *
 * Route patterns keep their full `/api/v1/...` prefix, exactly as the Express
 * routers declared them, so the two backends can be compared line by line.
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Activations\ActivationRoutes;
use Omd\Admin\AdminRoutes;
use Omd\Assets\Storage;
use Omd\AnnualPlans\AnnualPlanRoutes;
use Omd\Auth\AuthRoutes;
use Omd\Auth\Guard;
use Omd\Campaigns\CampaignRoutes;
use Omd\Config\Env;
use Omd\Database\Db;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Monitoring\MonitoringRoutes;
use Omd\Strategy\StrategyRoutes;
use Omd\Support\Logger;

// Errors are logged, never printed: a stack trace in a JSON response leaks
// paths and query fragments. The error handler below decides what the client
// sees.
ini_set('display_errors', '0');
error_reporting(E_ALL);

$request = null;

try {
    $request = Request::fromGlobals();

    // Uploaded files, before anything else and before authentication — the
    // position `app.use('/uploads', express.static(...))` holds in the Node app.
    // A production web server normally answers these without ever reaching PHP;
    // this is what makes them work where it does not.
    if (Storage::serve($request->path)) {
        return;
    }

    $router = new Router();

    // Health probes answer before authentication, as in the Node app: a
    // monitoring check must not need a session.
    $router->get('/api/v1/health', static function (): void {
        Response::raw(['status' => 'ok']);
    });

    $router->get('/api/v1/health/ready', static function (): void {
        try {
            Db::ping();
            Response::raw(['status' => 'ok', 'database' => 'ok']);
        } catch (Throwable $error) {
            Logger::error('readiness probe failed', ['message' => $error->getMessage()]);
            Response::status(503);
            Response::raw(['status' => 'degraded', 'database' => 'unavailable']);
        }
    });

    // Attaches the user when a valid session cookie is present; never rejects.
    // Route guards do the rejecting.
    $router->before([Guard::class, 'attachUser']);

    AuthRoutes::register($router);
    CampaignRoutes::register($router);
    ActivationRoutes::register($router);
    AnnualPlanRoutes::register($router);
    MonitoringRoutes::register($router);
    StrategyRoutes::register($router);
    AdminRoutes::register($router);

    if (!$router->dispatch($request)) {
        Response::notFound();
    }
} catch (Throwable $error) {
    Response::error($error, $request?->requestId);
}
