<?php

/**
 * AS-B-D01…D11 — what the database itself guarantees.
 *
 * These do not go through the API. The point is the schema: if `UNIQUE
 * (strategy_version_id, code)` or an `ON DELETE RESTRICT` were ever relaxed in a
 * migration, every rule above it would quietly become advisory, and the
 * application-level checks would be the only thing standing between a rename
 * and a duplicated reper.
 */

declare(strict_types=1);

Harness::group('Bază de date — constrângeri și tranzacții');

$seedVersionId = (string) Harness::scalar(
    "SELECT id FROM strategy_versions WHERE external_key = 'strategy-2026-2028'"
);

// --- AS-B-D01: cod duplicat în aceeași versiune ---------------------------

$duplicateRejected = false;
try {
    Harness::exec(
        "INSERT INTO strategic_objectives (id, strategy_version_id, code, name, source, label)
         VALUES (?, ?, (SELECT code FROM (SELECT code FROM strategic_objectives WHERE strategy_version_id = ? LIMIT 1) x), 'dublură', '', 'dublură')",
        [Harness::uuid(), $seedVersionId, $seedVersionId],
    );
} catch (PDOException $error) {
    $duplicateRejected = str_contains($error->getMessage(), '1062') || $error->getCode() === '23000';
}
Harness::check('AS-B-D01', 'două repere cu același cod în aceeași versiune — respins de UNIQUE', $duplicateRejected);

// --- AS-B-D02: același cod în două versiuni --------------------------------
//
// The other half of the same rule, and the reason the first half is safe: a code
// is a label local to a version, so `OS2` may mean two different things in two
// strategic cycles without either campaign losing its meaning.

$scratchId = Harness::uuid();
Harness::exec(
    "INSERT INTO strategy_versions (id, external_key, label, period_start_year, period_end_year, status)
     VALUES (?, 'test-db-scratch', 'Versiune de test (D02)', 2040, 2042, 'DRAFT')",
    [$scratchId],
);

$borrowedCode = (string) Harness::scalar(
    'SELECT code FROM strategic_objectives WHERE strategy_version_id = ? ORDER BY sort_order LIMIT 1',
    [$seedVersionId],
);

$twinAccepted = true;
$twinId = Harness::uuid();
try {
    Harness::exec(
        "INSERT INTO strategic_objectives (id, strategy_version_id, code, name, source, label)
         VALUES (?, ?, ?, 'geamăn într-o altă versiune', '', 'geamăn')",
        [$twinId, $scratchId, $borrowedCode],
    );
} catch (PDOException) {
    $twinAccepted = false;
}
Harness::check('AS-B-D02', "codul „{$borrowedCode}” acceptat și în a doua versiune", $twinAccepted);

// --- AS-B-D03: FK RESTRICT pe un reper folosit -----------------------------

$usedPillarId = Harness::scalar(
    'SELECT p.id FROM strategic_pillars p JOIN campaigns c ON c.pillar_id = p.id LIMIT 1'
);
$pillarBlocked = false;
if ($usedPillarId !== false) {
    try {
        Harness::pdo()->beginTransaction();
        Harness::exec('DELETE FROM strategic_pillars WHERE id = ?', [$usedPillarId]);
        Harness::pdo()->rollBack();
    } catch (PDOException $error) {
        Harness::pdo()->rollBack();
        $pillarBlocked = str_contains($error->getMessage(), '1451');
    }
}
Harness::check('AS-B-D03', 'DELETE pe un pilon referit de o campanie — blocat de FK RESTRICT', $pillarBlocked);

// --- AS-B-D04: FK RESTRICT pe o versiune cu campanii -----------------------

$versionBlocked = false;
try {
    Harness::pdo()->beginTransaction();
    Harness::exec('DELETE FROM strategy_versions WHERE id = ?', [$seedVersionId]);
    Harness::pdo()->rollBack();
} catch (PDOException $error) {
    Harness::pdo()->rollBack();
    $versionBlocked = str_contains($error->getMessage(), '1451');
}
Harness::check('AS-B-D04', 'DELETE pe o versiune cu campanii — blocat de FK RESTRICT', $versionBlocked);

// --- AS-B-D11: o ștergere eșuată la mijloc nu lasă scrieri parțiale --------
//
// Reached at SQL level rather than through `DELETE /:kind/:code`, and
// deliberately so: the endpoint re-checks its dependencies inside the
// transaction, so it never gets as far as a half-written delete. What is worth
// asserting is the property underneath — that the matrix rows deleted first come
// back when the row delete is refused.

$matrixProgramId = Harness::scalar(
    'SELECT spo.program_id FROM strategic_program_objectives spo
       JOIN strategic_programs p ON p.id = spo.program_id
      WHERE p.strategy_version_id = ? LIMIT 1',
    [$seedVersionId],
);
$before = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?',
    [$matrixProgramId],
);

$rolledBack = false;
try {
    Harness::pdo()->beginTransaction();
    Harness::exec('DELETE FROM strategic_program_objectives WHERE program_id = ?', [$matrixProgramId]);
    // Fails: the version still has campaigns pointing into it.
    Harness::exec('DELETE FROM strategy_versions WHERE id = ?', [$seedVersionId]);
    Harness::pdo()->rollBack();
} catch (PDOException) {
    Harness::pdo()->rollBack();
    $rolledBack = true;
}

$after = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?',
    [$matrixProgramId],
);
Harness::check('AS-B-D11', 'ștergere eșuată la mijloc — rollback complet', $rolledBack && $before === $after,
    $before === $after ? '' : "relații înainte {$before}, după {$after}");

// Clean up the D02 fixture; the clone tests build their own.
Harness::exec('DELETE FROM strategic_objectives WHERE id = ?', [$twinId]);
Harness::exec('DELETE FROM strategy_versions WHERE id = ?', [$scratchId]);
