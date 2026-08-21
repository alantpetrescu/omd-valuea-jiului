<?php

/**
 * Cloning the repere of one strategy version into another (SPEC §4.3).
 *
 * A new strategic cycle almost always starts from the previous one: the same
 * pillars, the same programmes, a handful of texts rewritten. Retyping four
 * pillars, eight programmes and eighteen objectives by hand is where transcription
 * errors come from, and the codes are exactly the values that must not drift.
 *
 * What travels: codes, texts, `sort_order`, `is_active`, and the program ↔
 * objective matrix remapped onto the new UUIDs. What does not: campaigns,
 * activations, plans, monitoring. The result is the same state an import with a
 * new `strategyVersion` would produce (§33.4.1), which is the reason this is not
 * a deviation from the spec even though the spec does not mention it.
 *
 * New UUIDs throughout, and that is the point rather than an implementation
 * detail: campaigns of the old version keep pointing at the old rows, so the
 * clone cannot silently re-target history.
 */

declare(strict_types=1);

namespace Omd\Strategy;

use Omd\Database\Db;
use Omd\Support\Ids;

final class StrategyClone
{
    /**
     * Columns copied per kind, beyond the ones every table shares.
     *
     * @var array<string,list<string>>
     */
    private const COLUMNS = [
        'strategic_pillars' => ['label', 'display_label', 'hint'],
        'strategic_programs' => [
            'name', 'label', 'result_text', 'marketing_objective', 'approach',
            'horizon_result_text', 'target_groups_text', 'kpi_text', 'sources_text',
            'annual_actions', 'validation_status',
        ],
        'strategic_objectives' => ['name', 'label', 'source'],
    ];

    /**
     * Copies every reper of `$sourceVersionId` into `$targetVersionId`.
     *
     * Must be called inside a transaction: it writes three tables plus the
     * matrix, and a version holding half its programmes is worse than one
     * holding none.
     *
     * @return array{pillars:int,programs:int,objectives:int,relations:int}
     */
    public static function copy(string $sourceVersionId, string $targetVersionId, ?string $userId): array
    {
        $counts = ['pillars' => 0, 'programs' => 0, 'objectives' => 0, 'relations' => 0];

        // Old UUID → new UUID, so the matrix can be remapped after the rows exist.
        $programMap = [];
        $objectiveMap = [];

        foreach (self::COLUMNS as $table => $extraColumns) {
            $columns = array_merge(['code'], $extraColumns, ['is_active', 'sort_order']);
            $selectList = implode(', ', $columns);

            $rows = Db::rows(
                "SELECT id, {$selectList} FROM {$table} WHERE strategy_version_id = ? ORDER BY sort_order, code",
                [$sourceVersionId],
            );

            $placeholders = implode(', ', array_fill(0, count($columns) + 3, '?'));
            $insertList = implode(', ', array_merge(['id', 'strategy_version_id'], $columns, ['created_by']));

            foreach ($rows as $row) {
                $newId = Ids::newId();

                $values = [$newId, $targetVersionId];
                foreach ($columns as $column) {
                    $values[] = $row[$column];
                }
                $values[] = $userId;

                Db::execute("INSERT INTO {$table} ({$insertList}) VALUES ({$placeholders})", $values);

                if ($table === 'strategic_programs') {
                    $programMap[(string) $row['id']] = $newId;
                    $counts['programs']++;
                } elseif ($table === 'strategic_objectives') {
                    $objectiveMap[(string) $row['id']] = $newId;
                    $counts['objectives']++;
                } else {
                    $counts['pillars']++;
                }
            }
        }

        $relations = Db::rows(
            'SELECT spo.program_id, spo.objective_id, spo.sort_order
               FROM strategic_program_objectives spo
               JOIN strategic_programs p ON p.id = spo.program_id
              WHERE p.strategy_version_id = ?
              ORDER BY spo.sort_order',
            [$sourceVersionId],
        );

        foreach ($relations as $relation) {
            $programId = $programMap[(string) $relation['program_id']] ?? null;
            $objectiveId = $objectiveMap[(string) $relation['objective_id']] ?? null;

            // A relation whose ends are not both in this version cannot exist —
            // the FK is version-local. Skipping rather than failing keeps the
            // clone honest if the source is somehow inconsistent.
            if ($programId === null || $objectiveId === null) {
                continue;
            }

            Db::execute(
                'INSERT INTO strategic_program_objectives (program_id, objective_id, sort_order, created_by)
                 VALUES (?, ?, ?, ?)',
                [$programId, $objectiveId, (int) $relation['sort_order'], $userId],
            );
            $counts['relations']++;
        }

        return $counts;
    }

    /**
     * What a clone would produce, for the confirmation the UI shows first.
     *
     * @return array{pillars:int,programs:int,objectives:int,relations:int}
     */
    public static function preview(string $sourceVersionId): array
    {
        return [
            'pillars' => Db::count(
                'SELECT COUNT(*) FROM strategic_pillars WHERE strategy_version_id = ?',
                [$sourceVersionId],
            ),
            'programs' => Db::count(
                'SELECT COUNT(*) FROM strategic_programs WHERE strategy_version_id = ?',
                [$sourceVersionId],
            ),
            'objectives' => Db::count(
                'SELECT COUNT(*) FROM strategic_objectives WHERE strategy_version_id = ?',
                [$sourceVersionId],
            ),
            'relations' => Db::count(
                'SELECT COUNT(*) FROM strategic_program_objectives spo
                   JOIN strategic_programs p ON p.id = spo.program_id
                  WHERE p.strategy_version_id = ?',
                [$sourceVersionId],
            ),
        ];
    }
}
