<?php

/**
 * AS-B-U01…U09 — the pure rules, with no database and no HTTP in the way.
 *
 * These are the two decisions the whole feature turns on: how codes sort, and
 * when a code may still be renamed. Both are one-line functions, and both would
 * be tedious to exercise through an endpoint.
 */

declare(strict_types=1);

use Omd\Http\ApiError;
use Omd\Strategy\StrategyService;

Harness::group('Unitare — reguli pure (fără bază de date)');

// --- AS-B-U01…U04: ordine naturală ---------------------------------------

Harness::check(
    'AS-B-U01',
    "naturalCompare('P5.2','P5.10') este negativ — P5.2 primul",
    StrategyService::naturalCompare('P5.2', 'P5.10') < 0,
);

Harness::check(
    'AS-B-U02',
    "naturalCompare('D6.10','D6.9') este pozitiv — D6.9 primul",
    StrategyService::naturalCompare('D6.10', 'D6.9') > 0,
);

Harness::check(
    'AS-B-U03',
    "naturalCompare('PILLAR_1','PILLAR_2') este negativ",
    StrategyService::naturalCompare('PILLAR_1', 'PILLAR_2') < 0,
);

Harness::check(
    'AS-B-U04',
    "naturalCompare('AB','AA') este pozitiv — coduri fără cifre",
    StrategyService::naturalCompare('AB', 'AA') > 0,
);

// A sort, not just pairs: the pairwise cases above can pass while the ordering
// they imply is still wrong, because a comparator has to be transitive.
$codes = ['P5.10', 'P5.1', 'P5.2', 'P5.20', 'P5.3'];
usort($codes, [StrategyService::class, 'naturalCompare']);
Harness::same(
    'AS-B-U01b',
    'sortarea completă a unei liste de coduri',
    ['P5.1', 'P5.2', 'P5.3', 'P5.10', 'P5.20'],
    $codes,
);

// --- AS-B-U05…U07: când e codul editabil ----------------------------------

Harness::same('AS-B-U05', 'codeEditable(0, false) → true', true, StrategyService::codeEditable(0, false));
Harness::same('AS-B-U06', 'codeEditable(1, false) → false', false, StrategyService::codeEditable(1, false));
Harness::same('AS-B-U07', 'codeEditable(0, true) → false', false, StrategyService::codeEditable(0, true));

// --- AS-B-A30: statusul unei versiuni noi ----------------------------------
//
// Listed in TASK-1 as an API case, asserted here instead. The rule only differs
// on a database with no strategy versions at all, and campaigns make emptying
// one impossible — so the decision was extracted into a function that takes the
// count, which is what "testabil fără HTTP" asks for.

Harness::same('AS-B-A30', 'prima versiune din bază este creată ACTIVE', 'ACTIVE', StrategyService::statusForNewVersion(0));
Harness::same('AS-B-A29c', 'o versiune nouă lângă altele este DRAFT', 'DRAFT', StrategyService::statusForNewVersion(1));

// --- AS-B-U08: coduri respinse ---------------------------------------------

$rejected = static function (mixed $value): bool {
    try {
        StrategyService::normalizeCode($value);
        return false;
    } catch (ApiError $error) {
        return $error->errorCode === 'VALIDATION_ERROR';
    }
};

Harness::check('AS-B-U08a', "codul '' este respins", $rejected(''));
Harness::check('AS-B-U08b', "codul '   ' este respins", $rejected('   '));
Harness::check('AS-B-U08c', 'codul de 65 de caractere este respins', $rejected(str_repeat('x', 65)));
Harness::check('AS-B-U08d', 'codul lipsă este respins', $rejected(null));
Harness::check('AS-B-U08e', 'codul de 64 de caractere este acceptat', !$rejected(str_repeat('x', 64)));

// --- AS-B-U09: validează, nu transforma ------------------------------------
//
// The test that guards SPEC §3.1. A `strtoupper()` slipped in here would pass
// every other test in the suite and silently rewrite codes the beneficiary
// chose — and, through the import matching rule, duplicate their repere.

foreach (['D6.1', 'p5.9', 'A-1', 'OS2', 'obiectiv 2', 'P5.1'] as $code) {
    Harness::same(
        'AS-B-U09',
        "codul „{$code}” trece neschimbat",
        $code,
        StrategyService::normalizeCode($code),
    );
}

Harness::same(
    'AS-B-U09b',
    'spațiile din jur sunt tăiate (coliziunea NO PAD)',
    'P5.1',
    StrategyService::normalizeCode('  P5.1  '),
);
