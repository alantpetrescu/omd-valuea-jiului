<?php

/**
 * Business rules for the strategic repere.
 *
 * Split out of `StrategyRoutes` on purpose (TASK-1 §1): the rules in
 * SPEC_ADMIN_STRATEGIE §4.1 and §4.2 decide whether a code may be renamed and
 * whether a record may be deleted, and both need to be exercised without an
 * HTTP request in front of them. The routes stay thin; everything here is a
 * plain function over plain values, or a single query.
 *
 * The one idea that runs through the whole file: a code is a label local to one
 * strategy version, never an identity. Campaigns point at UUIDs. That is why
 * every lookup here is scoped by `strategy_version_id`, and why the same `OS2`
 * can exist in two versions as two unrelated rows.
 */

declare(strict_types=1);

namespace Omd\Strategy;

use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Shared\CodeIdentity;

final class StrategyService
{
    /** @var array<string,string> Route segment → table. */
    public const KINDS = [
        'pillars' => 'strategic_pillars',
        'programs' => 'strategic_programs',
        'objectives' => 'strategic_objectives',
    ];

    /**
     * References that block deletion (SPEC §2).
     *
     * Deliberately counted without `deleted_at IS NULL`. A soft-deleted campaign
     * still holds its foreign key, so the database will refuse the delete
     * whatever this count says — filtering here would only produce a preview
     * that promises something InnoDB then denies.
     *
     * @var array<string,list<array{type:string,sql:string}>>
     */
    private const BUSINESS_REFS = [
        'pillars' => [
            ['type' => 'campanii', 'sql' => 'SELECT COUNT(*) FROM campaigns WHERE pillar_id = ?'],
            ['type' => 'activări', 'sql' => 'SELECT COUNT(*) FROM activations WHERE pillar_id = ?'],
        ],
        'programs' => [
            ['type' => 'campanii', 'sql' => 'SELECT COUNT(*) FROM campaign_programs WHERE program_id = ?'],
        ],
        'objectives' => [
            ['type' => 'campanii', 'sql' => 'SELECT COUNT(*) FROM campaign_objectives WHERE objective_id = ?'],
        ],
    ];

    /**
     * References that belong to the record itself and travel with it.
     *
     * The program ↔ objective matrix is part of the reper, not a use of it, so
     * it is reported for information and deleted in the same transaction. Only
     * the business references above turn into `409 ENTITY_IN_USE`.
     *
     * @var array<string,list<array{type:string,sql:string}>>
     */
    private const INTERNAL_REFS = [
        'pillars' => [],
        'programs' => [
            ['type' => 'matrice programe', 'sql' => 'SELECT COUNT(*) FROM strategic_program_objectives WHERE program_id = ?'],
        ],
        'objectives' => [
            ['type' => 'matrice programe', 'sql' => 'SELECT COUNT(*) FROM strategic_program_objectives WHERE objective_id = ?'],
        ],
    ];

    // ------------------------------------------------------------------ pure

    /**
     * Natural order over codes: `P5.2` before `P5.10` (SPEC §4.5).
     *
     * A plain string comparison puts `P5.10` between `P5.1` and `P5.2`, because
     * it reads "1" then "0" and never sees a number. Splitting on digit runs and
     * comparing those numerically is the whole fix, and it works for any prefix
     * convention — `D6.2` before `D6.10` just the same.
     *
     * Falls back to a byte comparison when every segment ties, so codes that
     * differ only in leading zeros (`P05` / `P5`) still get a stable, total
     * order instead of arbitrarily swapping between sorts.
     */
    public static function naturalCompare(string $a, string $b): int
    {
        $split = static function (string $value): array {
            $parts = preg_split('/(\d+)/', $value, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY);
            return $parts === false ? [$value] : $parts;
        };

        $left = $split($a);
        $right = $split($b);
        $count = max(count($left), count($right));

        for ($i = 0; $i < $count; $i++) {
            // The shorter code is a prefix of the longer one, so it sorts first.
            if (!isset($left[$i])) {
                return -1;
            }
            if (!isset($right[$i])) {
                return 1;
            }

            $l = $left[$i];
            $r = $right[$i];

            $comparison = ctype_digit($l) && ctype_digit($r)
                ? (int) $l <=> (int) $r
                : strcmp($l, $r);

            if ($comparison !== 0) {
                return $comparison < 0 ? -1 : 1;
            }
        }

        return strcmp($a, $b) <=> 0;
    }

/*
     * The two rules below are shared with Administrare → Nomenclatoare and live
     * in `CodeIdentity`. They stay reachable under their old names here so the
     * strategy code and its tests read the way the specification does.
     */

    /** Validates a code without rewriting it (SPEC §3.1). */
    public static function normalizeCode(mixed $raw): string
    {
        return CodeIdentity::normalize($raw);
    }

    /** Whether a code may still be renamed (SPEC §4.1). */
    public static function codeEditable(int $businessRefs, bool $importTouched): bool
    {
        return CodeIdentity::editable($businessRefs, $importTouched);
    }

    // ----------------------------------------------------------------- lookup

    public static function tableFor(string $kind): string
    {
        $table = self::KINDS[$kind] ?? null;
        if ($table === null) {
            throw ApiError::notFound('Tip de reper necunoscut.');
        }
        return $table;
    }

    public static function versionIdFor(string $externalKey): string
    {
        $row = Db::one('SELECT id FROM strategy_versions WHERE external_key = ?', [$externalKey]);
        if ($row === null) {
            throw ApiError::notFound('Versiunea strategică nu a fost găsită.');
        }
        return (string) $row['id'];
    }

    /**
     * The record's UUID, or 404.
     *
     * @return array{id:string,code:string}
     */
    public static function recordFor(string $kind, string $versionId, string $code): array
    {
        $table = self::tableFor($kind);
        $row = Db::one(
            "SELECT id, code FROM {$table} WHERE strategy_version_id = ? AND code = ?",
            [$versionId, $code],
        );
        if ($row === null) {
            throw ApiError::notFound("Reperul {$code} nu a fost găsit.");
        }
        return ['id' => (string) $row['id'], 'code' => (string) $row['code']];
    }

    /**
     * Everything that points at one reper, split by whether it blocks deletion.
     *
     * @return array{
     *   canDelete:bool, canEditCode:bool,
     *   business:list<array{type:string,count:int}>,
     *   internal:list<array{type:string,count:int}>,
     *   importedAt:?string
     * }
     */
    public static function usage(string $kind, string $recordId): array
    {
        self::tableFor($kind);

        $collect = static function (array $definitions) use ($recordId): array {
            $out = [];
            foreach ($definitions as $definition) {
                $count = Db::count($definition['sql'], [$recordId]);
                if ($count > 0) {
                    $out[] = ['type' => $definition['type'], 'count' => $count];
                }
            }
            return $out;
        };

        $business = $collect(self::BUSINESS_REFS[$kind]);
        $internal = $collect(self::INTERNAL_REFS[$kind]);

        $businessTotal = array_sum(array_column($business, 'count'));
        $importedAt = self::importedAt($recordId);

        return [
            'canDelete' => $businessTotal === 0,
            'canEditCode' => self::codeEditable($businessTotal, $importedAt !== null),
            'business' => $business,
            'internal' => $internal,
            'importedAt' => $importedAt,
        ];
    }

    /** Total number of business references, the number that blocks deletion. */
    public static function businessRefCount(string $kind, string $recordId): int
    {
        $total = 0;
        foreach (self::BUSINESS_REFS[$kind] as $definition) {
            $total += Db::count($definition['sql'], [$recordId]);
        }
        return $total;
    }

    /**
     * When an import first wrote this record, or null.
     *
     * Matched on `entity_id`, never on the code: the same code exists in several
     * versions, and asking by code would lock a brand-new reper because a
     * different version's namesake once came through an import.
     */
    public static function importedAt(string $recordId): ?string
    {
        return CodeIdentity::importedAt($recordId);
    }

    /**
     * The `409` a blocked deletion produces, in the §35.1.2 shape.
     *
     * @param list<array{type:string,count:int}> $business
     */
    public static function inUseError(string $kind, string $code, array $business): ApiError
    {
        return new ApiError(
            'ENTITY_IN_USE',
            'Reperul este utilizat și nu poate fi șters. Îl poți dezactiva.',
            [
                'entityType' => strtoupper(self::tableFor($kind)),
                'externalKey' => $code,
                'dependencies' => $business,
                'allowedAction' => 'DEACTIVATE',
            ],
        );
    }

    /**
     * Replaces a program's objective matrix (SPEC §4.4).
     *
     * Resolves the codes inside the program's own version, so a code from
     * another strategy version is a `422` rather than a cross-version link — the
     * one thing §15.3 forbids. Runs inside the caller's transaction, which is
     * what makes "no partial writes" true: the resolve happens before the first
     * delete, so a bad code aborts before anything is touched.
     *
     * @param list<string> $objectiveCodes
     */
    public static function replaceProgramObjectives(
        string $programId,
        string $versionId,
        array $objectiveCodes,
        ?string $userId,
    ): void {
        $resolved = [];
        foreach ($objectiveCodes as $index => $rawCode) {
            $code = trim((string) $rawCode);
            if ($code === '') {
                continue;
            }

            $row = Db::one(
                'SELECT id FROM strategic_objectives WHERE strategy_version_id = ? AND code = ?',
                [$versionId, $code],
            );
            if ($row === null) {
                throw ApiError::validation(
                    "Obiectivul {$code} nu există în această versiune strategică.",
                    ['fields' => [['path' => "objectiveCodes[{$index}]", 'message' => 'Cod inexistent în versiune.']]],
                );
            }

            // Same code twice keeps its first position rather than erroring: the
            // matrix is a set, and the UI can produce a duplicate by clicking.
            $resolved[(string) $row['id']] = true;
        }

        Db::execute('DELETE FROM strategic_program_objectives WHERE program_id = ?', [$programId]);

        $sortOrder = 0;
        foreach (array_keys($resolved) as $objectiveId) {
            Db::execute(
                'INSERT INTO strategic_program_objectives (program_id, objective_id, sort_order, created_by)
                 VALUES (?, ?, ?, ?)',
                [$programId, $objectiveId, $sortOrder, $userId],
            );
            $sortOrder++;
        }
    }

    /**
     * The status a new strategy version starts in (SPEC §4.3).
     *
     * DRAFT while something else is already ACTIVE — activation stays a separate
     * decision. ACTIVE when this is the first version in the database, because a
     * DRAFT-only strategy leaves `GET /strategy` with nothing to answer and the
     * operational screen with nothing to show. Same rule the importer applies.
     *
     * A parameter rather than a query so the rule can be exercised without
     * emptying a database of every version, which campaigns make impossible.
     */
    public static function statusForNewVersion(int $existingVersions): string
    {
        return $existingVersions === 0 ? 'ACTIVE' : 'DRAFT';
    }

    /** Next `sort_order` for a new record: appended, never inserted mid-list. */
    public static function nextSortOrder(string $table, string $versionId): int
    {
        $max = Db::scalar(
            "SELECT MAX(sort_order) FROM {$table} WHERE strategy_version_id = ?",
            [$versionId],
        );
        return $max === null ? 0 : ((int) $max) + 1;
    }
}
