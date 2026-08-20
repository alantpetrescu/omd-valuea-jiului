<?php

/**
 * Installation entry point for hosting without a shell.
 *
 * The cPanel this port targets has no Terminal, so `php bin/migrate.php` cannot
 * be run at all. Without something like this the database could only be created
 * from another machine over Remote MySQL — which means opening the database
 * port to the internet, a far worse trade than a temporary guarded URL.
 *
 *   /setup.php?token=<APP_SECRET>
 *   /setup.php?token=<APP_SECRET>&action=migrate
 *   /setup.php?token=<APP_SECRET>&action=seed
 *   /setup.php?token=<APP_SECRET>&action=import
 *
 * Four things keep it from becoming a back door:
 *
 *   - it demands APP_SECRET, compared in constant time;
 *   - it refuses to run while APP_SECRET is still the placeholder;
 *   - it refuses over plain HTTP, because the token would cross the wire in
 *     the clear and end up in proxy logs;
 *   - every use is logged with the client address.
 *
 * DELETE THIS FILE once the database is set up. The banner says so, and there
 * is no reason to keep it: after the first install it does nothing you cannot
 * do from the application itself.
 */

declare(strict_types=1);

/**
 * Unlocks the CLI scripts in bin/ for this one entry point, which authorises
 * the caller below. Defined before anything else so a fatal later cannot leave
 * them reachable in a half-initialised state.
 */
define('OMD_SETUP', true);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Config\Env;
use Omd\Database\Db;
use Omd\Imports\ImportService;
use Omd\Support\Logger;
use Omd\Support\Preflight;

header('Content-Type: text/plain; charset=utf-8');
header('Cache-Control: no-store');
header('X-Robots-Tag: noindex, nofollow');

/**
 * The reminder has to be a shutdown handler, not a finally block: the scripts
 * in bin/ end with exit(), which skips finally entirely.
 */
register_shutdown_function(static function (): void {
    echo PHP_EOL, str_repeat('=', 62), PHP_EOL;
    echo 'STERGE public/setup.php dupa ce baza de date e gata.', PHP_EOL;
});

/** Fails closed: any problem reading configuration means no access. */
function authorise(): void
{
    try {
        $secret = Env::string('APP_SECRET');
    } catch (Throwable $error) {
        http_response_code(500);
        exit("Configurația nu poate fi citită:\n" . $error->getMessage() . "\n");
    }

    if ($secret === '' || str_starts_with($secret, 'change-me')) {
        http_response_code(403);
        exit("APP_SECRET este încă valoarea implicită. Pune una reală în .env înainte de a folosi acest script.\n");
    }

    $https = ($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off';
    $forwarded = strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
    if (!$https && !$forwarded) {
        http_response_code(403);
        exit("Refuzat pe HTTP. Tokenul ar circula în clar. Activează SSL și reîncearcă pe https://\n");
    }

    $given = (string) ($_GET['token'] ?? '');
    if ($given === '' || !hash_equals($secret, $given)) {
        Logger::warn('setup.php: token invalid', ['ip' => $_SERVER['REMOTE_ADDR'] ?? '?']);
        http_response_code(403);
        exit("Token invalid.\n");
    }
}

/**
 * Imports every package waiting in `storage/import-inbox/`.
 *
 * Business data enters the system only through an import, so without this a
 * host with no Terminal could migrate and seed and then sit there with an empty
 * application. Upload the four JSON packages with File Manager and load this
 * once.
 *
 * The directory is fixed and no path ever comes from the query string. A `file=`
 * parameter would be a file-read primitive behind a single shared token, and the
 * convenience it buys is choosing which of four files to run.
 *
 * The order is derived, not given. Activations reference campaigns and
 * monitoring snapshots reference activation materials, so a wrong order fails on
 * a missing reference; each file is read for its `packageType` first and sorted
 * by that. Dropping four files in one folder is then the whole procedure, and
 * getting the order wrong is not something the operator can do.
 */
function runImport(): void
{
    /** Dependency order, lowest first. */
    $rank = [
        'OMD_CAMPAIGNS_PACKAGE' => 0,
        'OMD_ACTIVATIONS_PACKAGE' => 1,
        'OMD_ACTIVATION_MONITORING_PACKAGE' => 2,
        'OMD_REPUTATION_MONITORING_PACKAGE' => 3,
    ];

    $inbox = Env::repoRoot() . '/storage/import-inbox';
    echo "sursa: {$inbox}\n\n";

    if (!is_dir($inbox)) {
        http_response_code(400);
        echo "Directorul nu există. Creează-l și pune pachetele .json în el.\n";
        return;
    }

    $files = glob($inbox . '/*.json') ?: [];
    if ($files === []) {
        http_response_code(400);
        echo "Niciun fișier .json în director.\n";
        return;
    }

    // Read each header before importing anything: a package this release cannot
    // dispatch should stop the run now, not after three others are committed.
    $planned = [];
    foreach ($files as $file) {
        $decoded = json_decode((string) file_get_contents($file), true);
        $type = is_array($decoded) ? (string) ($decoded['packageType'] ?? '') : '';
        if (!isset($rank[$type])) {
            http_response_code(400);
            echo 'OPRIT: ', basename($file), " — packageType necunoscut sau JSON invalid.\n";
            return;
        }
        $planned[] = ['file' => $file, 'type' => $type, 'rank' => $rank[$type]];
    }

    usort($planned, static fn (array $a, array $b): int => $a['rank'] <=> $b['rank']);

    echo "ordinea de import:\n";
    foreach ($planned as $index => $item) {
        printf("  %d. %-38s %s\n", $index + 1, $item['type'], basename($item['file']));
    }
    echo "\n", str_repeat('-', 62), "\n";

    // Decoding a package full of base64 images takes far longer than a page
    // load, and the default limit on shared hosting is measured in seconds.
    set_time_limit(0);

    foreach ($planned as $item) {
        echo "\n", basename($item['file']), "\n";
        // Sent as it is produced: a run that hits the host's hard timeout still
        // shows which packages made it.
        flush();

        $report = ImportService::importFile($item['file']);

        if ($report['status'] !== 'SUCCESS') {
            http_response_code(500);
            echo "  ESUAT\n";
            foreach ($report['errors'] as $error) {
                echo '    ! ', $error, "\n";
            }
            echo "\nRularea s-a oprit aici. Baza a fost dată înapoi pentru acest pachet;\n";
            echo "pachetele importate înainte rămân. Repară fișierul și reia.\n";
            return;
        }

        echo '  ', $report['packageType'], '  ', $report['packageId'] ?? '', "\n";
        echo "  create / actualizate / neschimbate\n";
        foreach ($report['summary'] as $entity => $counts) {
            printf(
                "    %4d %4d %4d  %s\n",
                $counts['created'],
                $counts['updated'],
                $counts['unchanged'],
                $entity,
            );
        }
        foreach ($report['warnings'] as $warning) {
            echo '    ~ ', $warning, "\n";
        }
        flush();
    }

    echo "\n", str_repeat('-', 62), "\n";
    echo "Import complet. Șterge fișierele din import-inbox/ — nu mai sunt necesare.\n";
}

authorise();

$action = (string) ($_GET['action'] ?? 'check');
Logger::info('setup.php accesat', ['action' => $action, 'ip' => $_SERVER['REMOTE_ADDR'] ?? '?']);

echo "OMD Valea Jiului — instalare backend PHP\n";
echo str_repeat('=', 62), "\n\n";

try {
    if ($action === 'check') {
        $results = Preflight::run();
        foreach ($results as $result) {
            echo Preflight::format($result), PHP_EOL;
        }

        $worst = Preflight::worst($results);
        echo "\n", str_repeat('-', 62), "\n";
        echo match ($worst) {
            Preflight::FAIL => "REZULTAT: ceva blochează pornirea. Rezolvă rândurile FAIL de mai sus.\n",
            Preflight::WARN => "REZULTAT: pornește, dar citește avertismentele.\n",
            default => "REZULTAT: mediul e complet.\n",
        };
        echo "\nPași: ?action=migrate apoi ?action=seed apoi ?action=import (păstrează &token=).\n";
        exit(0);
    }

    if ($action === 'migrate') {
        // The runner prints its own progress; capturing it keeps this page as
        // the single source of output.
        $before = Db::count(
            'SELECT COUNT(*) FROM information_schema.TABLES
              WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
            [Env::string('DB_NAME'), 'schema_migrations'],
        );
        echo $before > 0 ? "schema_migrations există deja\n\n" : "prima migrare\n\n";

        require __DIR__ . '/../bin/migrate.php';
        exit(0);
    }

    if ($action === 'seed') {
        require __DIR__ . '/../bin/seed-technical.php';
        exit(0);
    }

    if ($action === 'import') {
        runImport();
        exit(0);
    }

    http_response_code(400);
    echo "Acțiune necunoscută: {$action}\nFolosește check, migrate, seed sau import.\n";
} catch (Throwable $error) {
    http_response_code(500);
    echo "\nEȘUAT:\n", $error->getMessage(), "\n";
    Logger::error('setup.php a eșuat', ['action' => $action, 'message' => $error->getMessage()]);
}
