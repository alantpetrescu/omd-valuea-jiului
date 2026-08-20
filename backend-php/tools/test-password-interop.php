<?php

/**
 * Argon2 cross-verification between the two backends.
 *
 * `node argon2` and PHP's libargon2 encode the same hash with the parameters in
 * a different order, and libargon2 reads them positionally — so without
 * normalisation every password set through the Node backend fails to verify
 * here, silently, as a wrong password.
 *
 * Run after any change to Password::verify:
 *
 *   php tools\test-password-interop.php
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Support\Password;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo 'CLI only.';
    exit(1);
}

$plaintext = 'test-parola-123';

/** The exact shape `node argon2` writes: m, p, t. */
$nodeStyle = '$argon2id$v=19$m=19456,p=1,t=2'
    . '$2AnILSHdo5mrUVAqL0/aJQ$k5tSCUxDBBUJCZpQJx0pQmNXVfKdFPu7ZQRPFxJcXfE';

$cases = [];

// 1. PHP's own hash must verify — the baseline.
$phpHash = Password::hash($plaintext);
$cases[] = [
    'PHP verifica propriul hash',
    Password::verify($phpHash, $plaintext),
    true,
];

// 2. A wrong password must still fail. A normaliser that made everything
//    verify would pass test 3 and be a catastrophe.
$cases[] = [
    'PHP respinge parola gresita',
    Password::verify($phpHash, 'alta-parola'),
    false,
];

// 3. The encoded form PHP produces must be canonical, so the Node backend can
//    read hashes written here.
$cases[] = [
    'PHP scrie in ordinea canonica m,t,p',
    (bool) preg_match('/^\$argon2id\$v=\d+\$m=\d+,t=\d+,p=\d+\$/', $phpHash),
    true,
];

// 4. A malformed hash must be false, never an exception.
$cases[] = [
    'hash corupt da false, nu eroare',
    Password::verify('$argon2id$nu-este-un-hash', $plaintext),
    false,
];

// 5. The shape from the Node backend must be accepted. This is the one that
//    failed before the fix and locked every existing account out.
$cases[] = [
    'ordinea Node m,p,t este acceptata de parser',
    // The digest above is not a real hash of $plaintext, so verification is
    // expected to be false — what matters is that the string is *parsed*
    // rather than rejected outright. A parse failure and a wrong password are
    // indistinguishable from password_verify, so the parse is checked directly.
    parsesAsArgon2($nodeStyle),
    true,
];

/** True when libargon2 can decode the encoded form at all. */
function parsesAsArgon2(string $hash): bool
{
    $info = password_get_info($hash);
    if (($info['algoName'] ?? 'unknown') === 'unknown') {
        return false;
    }
    // password_verify returns false both for "wrong password" and for "cannot
    // parse". Feeding it a hash we know the password for is the only way to
    // tell the two apart, so the real proof is case 6 below.
    return true;
}

// 6. The decisive one: hash with the Node ordering, verify through our code.
$real = Password::hash($plaintext);
if (preg_match('/^(\$argon2id\$v=\d+\$)m=(\d+),t=(\d+),p=(\d+)(\$.*)$/', $real, $m) === 1) {
    $nodeOrdered = $m[1] . 'm=' . $m[2] . ',p=' . $m[4] . ',t=' . $m[3] . $m[5];
    $cases[] = [
        'un hash real rescris in ordinea Node se verifica',
        Password::verify($nodeOrdered, $plaintext),
        true,
    ];
    $cases[] = [
        'acelasi hash respinge parola gresita',
        Password::verify($nodeOrdered, 'alta-parola'),
        false,
    ];
}

$failed = 0;
echo 'Interoperabilitate Argon2 (algoritm activ: ', Password::algorithm(), ')', PHP_EOL;
echo str_repeat('=', 62), PHP_EOL;

foreach ($cases as [$name, $actual, $expected]) {
    $ok = $actual === $expected;
    if (!$ok) {
        $failed++;
    }
    printf("  [%s] %s\n", $ok ? 'OK  ' : 'ESEC', $name);
}

echo PHP_EOL;
echo $failed === 0
    ? 'Toate verificarile trec.' . PHP_EOL
    : $failed . ' verificari au esuat.' . PHP_EOL;

exit($failed === 0 ? 0 : 1);
