<?php

/**
 * Environment self-check, from the command line.
 *
 * Same report as `/setup.php?action=check`, for hosts that do have a shell.
 * Exit code 1 when something is FAIL, so it can gate a deploy script.
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Support\Preflight;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo 'This script runs from the command line. Use setup.php from a browser.';
    exit(1);
}

$results = Preflight::run();

echo 'OMD Valea Jiului - verificare mediu (backend PHP)', PHP_EOL;
echo str_repeat('=', 62), PHP_EOL, PHP_EOL;

foreach ($results as $result) {
    echo Preflight::format($result), PHP_EOL;
}

$worst = Preflight::worst($results);

echo PHP_EOL, str_repeat('-', 62), PHP_EOL;
echo match ($worst) {
    Preflight::FAIL => 'REZULTAT: ceva blocheaza pornirea. Rezolva randurile FAIL.',
    Preflight::WARN => 'REZULTAT: porneste, dar citeste avertismentele.',
    default => 'REZULTAT: mediul e complet.',
}, PHP_EOL;

exit($worst === Preflight::FAIL ? 1 : 0);
