<?php

/**
 * Import CLI — port of `imports/cli.ts`.
 *
 *   php bin/import.php <package.json> [more.json ...]
 *
 * Same service an HTTP route would call; this entry point exists so a database
 * can be populated before anything else is wired, and so the documented staging
 * seed procedure (spec section 43) is scriptable.
 *
 * Order matters. Campaigns must exist before activations reference them, and
 * activations before monitoring snapshots hang off their materials, so the run
 * stops at the first failure rather than importing the rest against a state that
 * is already wrong.
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Imports\ImportService;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo 'CLI only.';
    exit(1);
}

$files = array_values(array_filter(
    array_slice($argv, 1),
    static fn (string $argument): bool => !str_starts_with($argument, '--'),
));

if ($files === []) {
    fwrite(STDERR, "Usage: php bin/import.php <package.json> [...]" . PHP_EOL);
    exit(2);
}

$failed = false;

foreach ($files as $file) {
    $absolute = realpath($file);
    if ($absolute === false) {
        fwrite(STDERR, "Fișier inexistent: {$file}" . PHP_EOL);
        $failed = true;
        break;
    }

    echo PHP_EOL, basename($absolute), PHP_EOL;

    $report = ImportService::importFile($absolute);

    if ($report['status'] !== 'SUCCESS') {
        $failed = true;
        echo '  ESUAT (', $report['packageType'] ?? 'pachet necunoscut', ')', PHP_EOL;
        foreach ($report['errors'] as $error) {
            echo '    ! ', $error, PHP_EOL;
        }
        break;
    }

    echo '  ', $report['packageType'], '  ', $report['packageId'] ?? '', PHP_EOL;
    echo '  create / actualizate / neschimbate', PHP_EOL;

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
        echo '    ~ ', $warning, PHP_EOL;
    }
}

exit($failed ? 1 : 0);
