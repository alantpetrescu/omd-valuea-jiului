<?php

/**
 * AS-B-A01…A36 — the endpoints, over real HTTP against `omd_vj_test`.
 *
 * Everything destructive happens inside a scratch strategy version this file
 * creates by cloning the seeded one and deletes at the end. The seeded version
 * keeps its golden 4 pillars / 8 programmes / 18 objectives, which the
 * regression file then asserts — a suite that quietly consumed its own fixture
 * would pass once and fail forever after.
 */

declare(strict_types=1);

Harness::group('API — versiuni, clonare');

$SOURCE = 'strategy-2026-2028';
$SCRATCH = 'test-scratch-' . bin2hex(random_bytes(4));

$sourceId = (string) Harness::scalar('SELECT id FROM strategy_versions WHERE external_key = ?', [$SOURCE]);
$sourceCounts = [
    'pillars' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_pillars WHERE strategy_version_id = ?', [$sourceId]),
    'programs' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_programs WHERE strategy_version_id = ?', [$sourceId]),
    'objectives' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_objectives WHERE strategy_version_id = ?', [$sourceId]),
];
$sourceRelations = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_program_objectives spo
       JOIN strategic_programs p ON p.id = spo.program_id
      WHERE p.strategy_version_id = ?',
    [$sourceId],
);

// --- AS-B-A31: sursă inexistentă -------------------------------------------

$missing = Harness::request('POST', '/api/v1/strategy/versions', [
    'externalKey' => $SCRATCH . '-nope',
    'label' => 'Clonă dintr-o versiune inexistentă',
    'periodStartYear' => 2040,
    'periodEndYear' => 2042,
    'cloneFromExternalKey' => 'nu-exista-aceasta-versiune',
]);
Harness::same('AS-B-A31', 'POST versions cu cloneFromExternalKey inexistent → 404', 404, $missing['status']);

// --- AS-B-A29: clonare cu o versiune ACTIVE deja ---------------------------

$created = Harness::request('POST', '/api/v1/strategy/versions', [
    'externalKey' => $SCRATCH,
    'label' => 'Versiune de test (clonă)',
    'periodStartYear' => 2040,
    'periodEndYear' => 2042,
    'notes' => 'Creată de suita de teste.',
    'cloneFromExternalKey' => $SOURCE,
]);
Harness::same('AS-B-A29a', 'POST versions cu clonare → 201', 201, $created['status']);
Harness::same('AS-B-A29b', 'statusul noii versiuni este DRAFT', 'DRAFT', $created['body']['data']['status'] ?? null);

$scratchId = (string) Harness::scalar('SELECT id FROM strategy_versions WHERE external_key = ?', [$SCRATCH]);

// --- AS-B-D05…D09: ce a produs clonarea ------------------------------------

Harness::group('Clonare — AS-B-D05…D09');

$clonedCounts = [
    'pillars' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_pillars WHERE strategy_version_id = ?', [$scratchId]),
    'programs' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_programs WHERE strategy_version_id = ?', [$scratchId]),
    'objectives' => (int) Harness::scalar('SELECT COUNT(*) FROM strategic_objectives WHERE strategy_version_id = ?', [$scratchId]),
];
Harness::same('AS-B-D05', 'numărul de piloni/programe/obiective este identic', $sourceCounts, $clonedCounts);

$clonedRelations = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_program_objectives spo
       JOIN strategic_programs p ON p.id = spo.program_id
      WHERE p.strategy_version_id = ?',
    [$scratchId],
);
Harness::same('AS-B-D06', 'numărul de relații program↔obiectiv este identic', $sourceRelations, $clonedRelations);

$sharedIds = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_programs a
       JOIN strategic_programs b ON b.id = a.id
      WHERE a.strategy_version_id = ? AND b.strategy_version_id = ?',
    [$sourceId, $scratchId],
);
Harness::same('AS-B-D07', 'niciun UUID nu este împărțit cu sursa', 0, $sharedIds);

$sourceCodes = array_column(
    Harness::rows('SELECT code FROM strategic_programs WHERE strategy_version_id = ? ORDER BY code', [$sourceId]),
    'code',
);
$clonedCodes = array_column(
    Harness::rows('SELECT code FROM strategic_programs WHERE strategy_version_id = ? ORDER BY code', [$scratchId]),
    'code',
);
Harness::same('AS-B-D08', 'codurile clonate sunt identice cu ale sursei', $sourceCodes, $clonedCodes);

$campaignsStillOld = (int) Harness::scalar(
    'SELECT COUNT(*) FROM campaign_programs cp
       JOIN strategic_programs p ON p.id = cp.program_id
      WHERE p.strategy_version_id = ?',
    [$sourceId],
);
$campaignsMoved = (int) Harness::scalar(
    'SELECT COUNT(*) FROM campaign_programs cp
       JOIN strategic_programs p ON p.id = cp.program_id
      WHERE p.strategy_version_id = ?',
    [$scratchId],
);
Harness::check(
    'AS-B-D09',
    'campaniile vechi pointează în continuare la UUID-urile vechi',
    $campaignsMoved === 0 && $campaignsStillOld > 0,
    "vechi {$campaignsStillOld}, mutate {$campaignsMoved}",
);

// --- Creare ----------------------------------------------------------------

Harness::group('API — creare repere');

$path = static fn (string $kind, string $code = ''): string =>
    '/api/v1/strategy/' . rawurlencode($SCRATCH) . '/' . $kind . ($code === '' ? '' : '/' . rawurlencode($code));

$newPillar = Harness::request('POST', $path('pillars'), [
    'code' => 'TEST_PILLAR',
    'label' => 'Pilon creat de teste',
    'displayLabel' => 'Test',
    'hint' => 'Creat de suita AS-B.',
]);
Harness::same('AS-B-A01a', 'POST pilon nou valid → 201', 201, $newPillar['status']);

$listed = Harness::request('GET', '/api/v1/strategy?version=' . rawurlencode($SCRATCH));
$listedCodes = array_column($listed['body']['data']['pillars'] ?? [], 'code');
Harness::check('AS-B-A01b', 'pilonul nou apare în GET /strategy', in_array('TEST_PILLAR', $listedCodes, true));

$maxBefore = (int) Harness::scalar(
    'SELECT MAX(sort_order) FROM strategic_objectives WHERE strategy_version_id = ?',
    [$scratchId],
);
$newObjective = Harness::request('POST', $path('objectives'), [
    'code' => 'TEST_OBJ',
    'name' => 'Obiectiv creat de teste',
    'source' => 'suita AS-B',
]);
Harness::same('AS-B-A08a', 'POST obiectiv nou → 201', 201, $newObjective['status']);
$newSort = (int) Harness::scalar(
    'SELECT sort_order FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
    [$scratchId, 'TEST_OBJ'],
);
Harness::same('AS-B-A08b', 'sort_order la creare este maximul curent + 1', $maxBefore + 1, $newSort);

$existingObjectiveCodes = array_column(
    Harness::rows('SELECT code FROM strategic_objectives WHERE strategy_version_id = ? ORDER BY sort_order LIMIT 2', [$scratchId]),
    'code',
);

$newProgram = Harness::request('POST', $path('programs'), [
    'code' => 'TEST_PROG',
    'name' => 'Program creat de teste',
    'result' => 'rezultat',
    'marketingObjective' => 'obiectiv',
    'approach' => 'abordare',
    'horizonResult' => 'orizont',
    'targetGroups' => 'grupuri',
    'kpiText' => 'kpi',
    'sources' => 'surse',
    'annualActions' => 'acțiuni',
    'validationStatus' => 'în lucru',
    'objectiveCodes' => $existingObjectiveCodes,
]);
Harness::same('AS-B-A02a', 'POST program cu objectiveCodes → 201', 201, $newProgram['status']);

$programId = (string) Harness::scalar(
    'SELECT id FROM strategic_programs WHERE strategy_version_id = ? AND code = ?',
    [$scratchId, 'TEST_PROG'],
);
Harness::same(
    'AS-B-A02b',
    'relațiile program↔obiectiv au fost create',
    count($existingObjectiveCodes),
    (int) Harness::scalar('SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?', [$programId]),
);

$duplicate = Harness::request('POST', $path('pillars'), [
    'code' => 'TEST_PILLAR',
    'label' => 'Alt pilon cu același cod',
]);
Harness::same('AS-B-A03a', 'POST cu cod deja existent → 409', 409, $duplicate['status']);
Harness::same('AS-B-A03b', 'codul de eroare este CONFLICT', 'CONFLICT', Harness::errorCode($duplicate));

$emptyCode = Harness::request('POST', $path('pillars'), ['code' => '   ', 'label' => 'Fără cod']);
Harness::same('AS-B-A04', 'POST cu cod vid → 422', 422, $emptyCode['status']);

$longCode = Harness::request('POST', $path('pillars'), ['code' => str_repeat('x', 65), 'label' => 'Cod prea lung']);
Harness::same('AS-B-A05', 'POST cu cod de 65 de caractere → 422', 422, $longCode['status']);

$lowercase = Harness::request('POST', $path('objectives'), ['code' => 'p5.9', 'name' => 'Cod cu litere mici']);
Harness::same('AS-B-A06a', "POST cu code 'p5.9' → 201", 201, $lowercase['status']);
Harness::same(
    'AS-B-A06b',
    "codul este stocat exact 'p5.9' — validat, nu transformat",
    'p5.9',
    Harness::scalar('SELECT code FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?', [$scratchId, 'p5.9']),
);

$otherConvention = Harness::request('POST', $path('objectives'), ['code' => 'D6.1', 'name' => 'Altă convenție de cod']);
Harness::same('AS-B-A07', "POST cu 'D6.1' într-o versiune P5.x → 201, convenția nu se impune", 201, $otherConvention['status']);

// --- Editare ---------------------------------------------------------------

Harness::group('API — editare și redenumire');

$renamed = Harness::request('PUT', $path('objectives', 'TEST_OBJ'), [
    'newCode' => 'TEST_OBJ_RENAMED',
    'name' => 'Obiectiv creat de teste',
    'source' => 'suita AS-B',
]);
Harness::same('AS-B-A09a', 'PUT cu newCode pe un reper nefolosit și neimportat → 200', 200, $renamed['status']);
Harness::same(
    'AS-B-A09b',
    'codul a fost schimbat în baza de date',
    '1',
    (string) Harness::scalar(
        'SELECT COUNT(*) FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
        [$scratchId, 'TEST_OBJ_RENAMED'],
    ),
);

// A used reper: any pillar the seeded version's campaigns point at.
$usedPillarCode = (string) Harness::scalar(
    'SELECT p.code FROM strategic_pillars p JOIN campaigns c ON c.pillar_id = p.id
      WHERE p.strategy_version_id = ? LIMIT 1',
    [$sourceId],
);
$seedPath = static fn (string $kind, string $code): string =>
    '/api/v1/strategy/' . rawurlencode($SOURCE) . '/' . $kind . '/' . rawurlencode($code);

$lockedByUse = Harness::request('PUT', $seedPath('pillars', $usedPillarCode), [
    'newCode' => 'PILLAR_RENAMED',
    'label' => 'Nu ar trebui să se schimbe',
]);
Harness::same('AS-B-A10a', 'PUT cu newCode pe un pilon folosit de o campanie → 409', 409, $lockedByUse['status']);
Harness::same('AS-B-A10b', 'codul de eroare este CODE_LOCKED', 'CODE_LOCKED', Harness::errorCode($lockedByUse));

// An imported but unused reper: everything in the seeded version came through
// the demo import, so an unused programme is locked by `importTouched` alone.
$importedUnused = Harness::rows(
    'SELECT p.code FROM strategic_programs p
      WHERE p.strategy_version_id = ?
        AND EXISTS (SELECT 1 FROM import_batch_items i WHERE i.entity_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM campaign_programs cp WHERE cp.program_id = p.id)
      LIMIT 1',
    [$sourceId],
);
if ($importedUnused !== []) {
    $code = (string) $importedUnused[0]['code'];
    $lockedByImport = Harness::request('PUT', $seedPath('programs', $code), [
        'newCode' => $code . '_X',
        'name' => 'Nu ar trebui să se schimbe',
    ]);
    Harness::same('AS-B-A11a', 'PUT cu newCode pe un reper adus prin import → 409', 409, $lockedByImport['status']);
    Harness::same('AS-B-A11b', 'codul de eroare este CODE_LOCKED', 'CODE_LOCKED', Harness::errorCode($lockedByImport));
} else {
    Harness::check('AS-B-A11', 'PUT cu newCode pe un reper importat', false, 'nu există un reper importat și nefolosit');
}

$clash = Harness::request('PUT', $path('objectives', 'TEST_OBJ_RENAMED'), [
    'newCode' => 'p5.9',
    'name' => 'Obiectiv creat de teste',
]);
Harness::same('AS-B-A12a', 'PUT cu newCode deja existent în versiune → 409', 409, $clash['status']);
Harness::same('AS-B-A12b', 'codul de eroare este CONFLICT', 'CONFLICT', Harness::errorCode($clash));

$replaced = Harness::request('PUT', $path('programs', 'TEST_PROG'), [
    'name' => 'Program creat de teste',
    'result' => 'rezultat',
    'marketingObjective' => 'obiectiv',
    'approach' => 'abordare',
    'horizonResult' => 'orizont',
    'targetGroups' => 'grupuri',
    'kpiText' => 'kpi',
    'sources' => 'surse',
    'annualActions' => 'acțiuni',
    'validationStatus' => 'în lucru',
    'objectiveCodes' => ['p5.9'],
]);
Harness::same('AS-B-A13a', 'PUT program cu objectiveCodes schimbate → 200', 200, $replaced['status']);
Harness::same(
    'AS-B-A13b',
    'relațiile sunt înlocuite, nu adăugate',
    1,
    (int) Harness::scalar('SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?', [$programId]),
);

$relationsBefore = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?',
    [$programId],
);
$foreignObjective = (string) Harness::scalar(
    'SELECT code FROM strategic_objectives WHERE strategy_version_id = ? AND code NOT IN
       (SELECT code FROM strategic_objectives WHERE strategy_version_id = ?) LIMIT 1',
    [$sourceId, $scratchId],
);
$crossVersion = Harness::request('PUT', $path('programs', 'TEST_PROG'), [
    'name' => 'Program creat de teste',
    'result' => 'rezultat',
    'marketingObjective' => 'obiectiv',
    'approach' => 'abordare',
    'horizonResult' => 'orizont',
    'targetGroups' => 'grupuri',
    'kpiText' => 'kpi',
    'sources' => 'surse',
    'annualActions' => 'acțiuni',
    'validationStatus' => 'în lucru',
    'objectiveCodes' => ['p5.9', $foreignObjective !== '' ? $foreignObjective : 'cod-inexistent'],
]);
Harness::same('AS-B-A14a', 'PUT cu un objectiveCode din altă versiune → 422', 422, $crossVersion['status']);
Harness::same(
    'AS-B-A14b',
    'nicio scriere parțială — relațiile au rămas neatinse',
    $relationsBefore,
    (int) Harness::scalar('SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?', [$programId]),
);

$nameBefore = (string) Harness::scalar(
    'SELECT name FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
    [$scratchId, 'p5.9'],
);
$incomplete = Harness::request('PUT', $path('objectives', 'p5.9'), ['source' => 'fără name']);
Harness::same('AS-B-A15a', 'PUT fără un câmp obligatoriu → 422', 422, $incomplete['status']);
Harness::same(
    'AS-B-A15b',
    'valorile vechi au rămas neatinse',
    $nameBefore,
    (string) Harness::scalar(
        'SELECT name FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
        [$scratchId, 'p5.9'],
    ),
);

// --- Usage -----------------------------------------------------------------

Harness::group('API — usage și ștergere');

$usedUsage = Harness::request('GET', $seedPath('pillars', $usedPillarCode) . '/usage');
Harness::same('AS-B-A20a', 'GET usage pe un reper folosit → 200', 200, $usedUsage['status']);
Harness::same('AS-B-A20b', 'canDelete este false', false, $usedUsage['body']['data']['canDelete'] ?? null);
Harness::check('AS-B-A20c', 'business este populat', ($usedUsage['body']['data']['business'] ?? []) !== []);

if ($importedUnused !== []) {
    $importedUsage = Harness::request('GET', $seedPath('programs', (string) $importedUnused[0]['code']) . '/usage');
    Harness::same('AS-B-A21a', 'GET usage pe un reper importat: canEditCode false', false, $importedUsage['body']['data']['canEditCode'] ?? null);
    Harness::check('AS-B-A21b', 'importedAt este nenul', ($importedUsage['body']['data']['importedAt'] ?? null) !== null);
}

$deleted = Harness::request('DELETE', $path('objectives', 'D6.1'));
Harness::same('AS-B-A16a', 'DELETE reper cu 0 referințe → 204', 204, $deleted['status']);
Harness::same(
    'AS-B-A16b',
    'rândul a dispărut',
    '0',
    (string) Harness::scalar(
        'SELECT COUNT(*) FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
        [$scratchId, 'D6.1'],
    ),
);

$blockedDelete = Harness::request('DELETE', $seedPath('pillars', $usedPillarCode));
Harness::same('AS-B-A17a', 'DELETE reper folosit → 409', 409, $blockedDelete['status']);
Harness::same('AS-B-A17b', 'codul de eroare este ENTITY_IN_USE', 'ENTITY_IN_USE', Harness::errorCode($blockedDelete));
Harness::same(
    'AS-B-A17c',
    'details.allowedAction este DEACTIVATE',
    'DEACTIVATE',
    $blockedDelete['body']['error']['details']['allowedAction'] ?? null,
);

// An objective that sits in a programme's matrix but has no campaign behind it:
// the matrix is part of the reper, so it goes with it rather than blocking.
$matrixOnly = (string) Harness::scalar(
    'SELECT o.code FROM strategic_objectives o
       JOIN strategic_program_objectives spo ON spo.objective_id = o.id
      WHERE o.strategy_version_id = ?
        AND NOT EXISTS (SELECT 1 FROM campaign_objectives co WHERE co.objective_id = o.id)
      LIMIT 1',
    [$scratchId],
);
if ($matrixOnly !== '') {
    $matrixObjectiveId = (string) Harness::scalar(
        'SELECT id FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
        [$scratchId, $matrixOnly],
    );
    $matrixRows = (int) Harness::scalar(
        'SELECT COUNT(*) FROM strategic_program_objectives WHERE objective_id = ?',
        [$matrixObjectiveId],
    );
    $matrixDelete = Harness::request('DELETE', $path('objectives', $matrixOnly));
    Harness::same('AS-B-A18a', 'DELETE obiectiv prezent în matrice, fără campanii → 204', 204, $matrixDelete['status']);
    Harness::same(
        'AS-B-A18b',
        'relațiile lui din matrice au dispărut în aceeași tranzacție',
        '0',
        (string) Harness::scalar(
            'SELECT COUNT(*) FROM strategic_program_objectives WHERE objective_id = ?',
            [$matrixObjectiveId],
        ),
    );
    Harness::check('AS-B-D10', 'reperul avea relații de șters', $matrixRows > 0, "relații: {$matrixRows}");
}

// --- AS-B-A19: preview stale -----------------------------------------------
//
// The whole reason the dependency check is repeated inside the transaction. The
// campaign row is inserted between the preview and the delete, exactly as a
// second user would.

$staleCode = 'TEST_STALE';
Harness::request('POST', $path('objectives'), ['code' => $staleCode, 'name' => 'Obiectiv pentru testul de preview']);
$staleId = (string) Harness::scalar(
    'SELECT id FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
    [$scratchId, $staleCode],
);

$preview = Harness::request('GET', $path('objectives', $staleCode) . '/usage');
Harness::same('AS-B-A19a', 'usage spune că se poate șterge', true, $preview['body']['data']['canDelete'] ?? null);

$campaignId = (string) Harness::scalar('SELECT id FROM campaigns LIMIT 1');
Harness::exec(
    "INSERT INTO campaign_objectives (campaign_id, objective_id, relation_role) VALUES (?, ?, 'SECONDARY')",
    [$campaignId, $staleId],
);

$staleDelete = Harness::request('DELETE', $path('objectives', $staleCode));
Harness::same('AS-B-A19b', 'DELETE după ce a apărut o campanie → 409', 409, $staleDelete['status']);
Harness::same('AS-B-A19c', 'verificarea s-a repetat: ENTITY_IN_USE', 'ENTITY_IN_USE', Harness::errorCode($staleDelete));

Harness::exec('DELETE FROM campaign_objectives WHERE objective_id = ?', [$staleId]);

// --- Versiuni ---------------------------------------------------------------

Harness::group('API — metadate, arhivare, ștergere de versiune');

$updated = Harness::request('PUT', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH), [
    'label' => 'Versiune de test — redenumită',
    'periodStartYear' => 2041,
    'periodEndYear' => 2043,
    'notes' => 'Actualizată de teste.',
    'externalKey' => 'incercare-de-schimbare-a-cheii',
]);
Harness::same('AS-B-A22a', 'PUT metadate versiune → 200', 200, $updated['status']);
Harness::same(
    'AS-B-A22b',
    'label-ul s-a schimbat',
    'Versiune de test — redenumită',
    (string) Harness::scalar('SELECT label FROM strategy_versions WHERE id = ?', [$scratchId]),
);
Harness::same(
    'AS-B-A23',
    'externalKey trimis în body este ignorat, nu eroare',
    $SCRATCH,
    (string) Harness::scalar('SELECT external_key FROM strategy_versions WHERE id = ?', [$scratchId]),
);

$archived = Harness::request('POST', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH) . '/archive');
Harness::same('AS-B-A27a', 'POST archive pe o versiune DRAFT → 200', 200, $archived['status']);
Harness::same(
    'AS-B-A27b',
    'statusul este ARCHIVED',
    'ARCHIVED',
    (string) Harness::scalar('SELECT status FROM strategy_versions WHERE id = ?', [$scratchId]),
);

$archiveActive = Harness::request('POST', '/api/v1/strategy/versions/' . rawurlencode($SOURCE) . '/archive');
Harness::same('AS-B-A28a', 'POST archive pe versiunea ACTIVE → 409', 409, $archiveActive['status']);
Harness::same('AS-B-A28b', 'codul de eroare este VERSION_ACTIVE', 'VERSION_ACTIVE', Harness::errorCode($archiveActive));

$deleteActive = Harness::request('DELETE', '/api/v1/strategy/versions/' . rawurlencode($SOURCE));
Harness::same('AS-B-A25a', 'DELETE versiunea ACTIVE → 409', 409, $deleteActive['status']);
Harness::same('AS-B-A25b', 'codul de eroare este VERSION_ACTIVE', 'VERSION_ACTIVE', Harness::errorCode($deleteActive));

// AS-B-A26 needs a DRAFT version that campaigns point at. Built by hand: the API
// deliberately offers no way to attach a campaign to a draft version.
$withCampaigns = 'test-with-campaigns-' . bin2hex(random_bytes(3));
$withCampaignsId = Harness::uuid();
Harness::exec(
    "INSERT INTO strategy_versions (id, external_key, label, period_start_year, period_end_year, status)
     VALUES (?, ?, 'Versiune de test cu campanii', 2050, 2052, 'DRAFT')",
    [$withCampaignsId, $withCampaigns],
);
$movedCampaign = (string) Harness::scalar('SELECT id FROM campaigns LIMIT 1');
$originalVersionOfCampaign = (string) Harness::scalar(
    'SELECT strategy_version_id FROM campaigns WHERE id = ?',
    [$movedCampaign],
);
Harness::exec('UPDATE campaigns SET strategy_version_id = ? WHERE id = ?', [$withCampaignsId, $movedCampaign]);

$deleteUsedVersion = Harness::request('DELETE', '/api/v1/strategy/versions/' . rawurlencode($withCampaigns));
Harness::same('AS-B-A26a', 'DELETE versiune cu campanii → 409', 409, $deleteUsedVersion['status']);
Harness::same('AS-B-A26b', 'codul de eroare este ENTITY_IN_USE', 'ENTITY_IN_USE', Harness::errorCode($deleteUsedVersion));

Harness::exec('UPDATE campaigns SET strategy_version_id = ? WHERE id = ?', [$originalVersionOfCampaign, $movedCampaign]);
Harness::exec('DELETE FROM strategy_versions WHERE id = ?', [$withCampaignsId]);

// --- Permisiuni --------------------------------------------------------------

Harness::group('API — permisiuni și audit');

foreach (['EDITOR' => 'AS-B-A32', 'VIEWER' => 'AS-B-A33'] as $role => $id) {
    $writes = [
        ['POST', $path('pillars'), ['code' => 'NOPE', 'label' => 'x']],
        ['PUT', $path('objectives', 'p5.9'), ['name' => 'x']],
        ['DELETE', $path('objectives', 'p5.9'), null],
        ['POST', '/api/v1/strategy/versions', ['externalKey' => 'nope', 'label' => 'x', 'periodStartYear' => 2050, 'periodEndYear' => 2051]],
        ['DELETE', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH), null],
        ['POST', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH) . '/archive', null],
    ];

    $allForbidden = true;
    $seen = [];
    foreach ($writes as [$method, $url, $payload]) {
        $response = Harness::request($method, $url, $payload, $role);
        $seen[] = $method . ' ' . $response['status'];
        if ($response['status'] !== 403) {
            $allForbidden = false;
        }
    }
    Harness::check($id, "{$role} → orice scriere pe strategie este 403", $allForbidden, implode(', ', $seen));
}

$editorRead = Harness::request('GET', '/api/v1/strategy', null, 'EDITOR');
$editorUsage = Harness::request('GET', $seedPath('pillars', $usedPillarCode) . '/usage', null, 'EDITOR');
Harness::check(
    'AS-B-A34',
    'EDITOR poate citi GET /strategy și GET usage',
    $editorRead['status'] === 200 && $editorUsage['status'] === 200,
    "strategy {$editorRead['status']}, usage {$editorUsage['status']}",
);

// --- Audit -------------------------------------------------------------------

$auditCreate = (int) Harness::scalar(
    "SELECT COUNT(*) FROM audit_log
      WHERE action = 'STRATEGY_CHANGE' AND entity_external_key = ?",
    [$SCRATCH . ':TEST_PILLAR'],
);
Harness::check('AS-B-A35', 'fiecare scriere reușită lasă o linie STRATEGY_CHANGE în audit_log', $auditCreate > 0);

$renameAudit = Harness::rows(
    "SELECT old_values, new_values FROM audit_log
      WHERE action = 'STRATEGY_CHANGE' AND entity_external_key = ?
      ORDER BY created_at DESC LIMIT 1",
    [$SCRATCH . ':TEST_OBJ'],
);
$oldJson = (string) ($renameAudit[0]['old_values'] ?? '');
$newJson = (string) ($renameAudit[0]['new_values'] ?? '');
Harness::check(
    'AS-B-A36',
    'audit_log la redenumire conține codul vechi și pe cel nou',
    str_contains($oldJson, 'TEST_OBJ') && str_contains($newJson, 'TEST_OBJ_RENAMED'),
    "old={$oldJson} new={$newJson}",
);

// --- AS-B-A24: ștergerea versiunii de test ------------------------------------

Harness::group('API — curățenie');

$scratchRepere = (int) Harness::scalar(
    'SELECT COUNT(*) FROM strategic_programs WHERE strategy_version_id = ?',
    [$scratchId],
);
$dropped = Harness::request('DELETE', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH));

// Archived above, so the delete is refused by design — DRAFT only. Put it back
// and try again: that is also the assertion that ARCHIVED is protected.
Harness::same('AS-B-A24a', 'DELETE pe o versiune ARCHIVED → 409 (doar DRAFT se șterge)', 409, $dropped['status']);

Harness::exec("UPDATE strategy_versions SET status = 'DRAFT' WHERE id = ?", [$scratchId]);
$droppedDraft = Harness::request('DELETE', '/api/v1/strategy/versions/' . rawurlencode($SCRATCH));
Harness::same('AS-B-A24b', 'DELETE versiune DRAFT fără campanii → 204', 204, $droppedDraft['status']);
Harness::check('AS-B-A24c', 'versiunea avea repere de șters', $scratchRepere > 0, "repere: {$scratchRepere}");
Harness::same(
    'AS-B-A24d',
    'reperele versiunii au dispărut odată cu ea',
    '0',
    (string) Harness::scalar('SELECT COUNT(*) FROM strategic_programs WHERE strategy_version_id = ?', [$scratchId]),
);
