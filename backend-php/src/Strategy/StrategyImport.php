<?php

/**
 * Strategy bootstrap from an OMD_CAMPAIGNS_PACKAGE — port of
 * `strategy/strategy-import.ts`.
 *
 * Spec sections 33.4 / 33.4.1 and the Architecture Risk Review: strategic codes
 * are unique per `strategy_version_id`, not globally. `OS2` may legitimately
 * mean one thing in 2026-2028 and something else in 2029-2033, and a historical
 * campaign must keep pointing at the meaning it was written against.
 *
 * A new horizon therefore never rewrites the old one:
 *   first version ever  -> created ACTIVE
 *   a version is active -> the new one is created DRAFT until Admin activates it
 */

declare(strict_types=1);

namespace Omd\Strategy;

use Omd\Database\Db;
use Omd\Imports\ImportContext;
use Omd\Support\Ids;
use RuntimeException;

final class StrategyImport
{
    /** The three tables this importer may write, as a closed set. */
    private const SCOPED_TABLES = ['strategic_pillars', 'strategic_programs', 'strategic_objectives'];

    /**
     * Imports the strategic frame and returns the code -> id maps campaigns
     * resolve against.
     *
     * @param array<string,mixed> $data
     * @return array{
     *   strategyVersionId:string,
     *   strategyVersionExternalKey:string,
     *   pillars:array<string,string>,
     *   programs:array<string,string>,
     *   objectives:array<string,string>
     * }
     */
    public static function import(array $data, ImportContext $ctx): array
    {
        $version = $data['strategyVersion'] ?? [];
        $strategyVersionId = self::getOrCreateStrategyVersion($version, $ctx);

        $pillars = [];
        foreach (array_values($data['pillars'] ?? []) as $index => $pillar) {
            [$id] = self::upsertScoped(
                'strategic_pillars',
                $strategyVersionId,
                (string) $pillar['code'],
                [
                    'label' => $pillar['label'],
                    'display_label' => $pillar['displayLabel'] ?? $pillar['label'],
                    'hint' => $pillar['hint'] ?? '',
                    'sort_order' => $index,
                ],
                $ctx,
            );
            $pillars[(string) $pillar['code']] = $id;
        }

        $objectives = [];
        foreach (array_values($data['objectives'] ?? []) as $index => $objective) {
            [$id] = self::upsertScoped(
                'strategic_objectives',
                $strategyVersionId,
                (string) $objective['code'],
                [
                    'name' => $objective['name'],
                    'source' => $objective['source'],
                    'label' => $objective['label'],
                    'sort_order' => $index,
                ],
                $ctx,
            );
            $objectives[(string) $objective['code']] = $id;
        }

        $programs = [];
        foreach (array_values($data['programs'] ?? []) as $index => $program) {
            [$id, $created] = self::upsertScoped(
                'strategic_programs',
                $strategyVersionId,
                (string) $program['code'],
                [
                    'name' => $program['name'],
                    'result_text' => $program['result'],
                    'marketing_objective' => $program['marketingObjective'],
                    'approach' => $program['approach'],
                    // The contract keeps the 2028-era name; the column is
                    // horizon-neutral, because the next strategy will not be
                    // about 2028.
                    'horizon_result_text' => $program['result2028'],
                    'target_groups_text' => $program['targetGroupsText'],
                    'kpi_text' => $program['kpiText'],
                    'sources_text' => $program['sourcesText'],
                    'annual_actions' => $program['annualActions'],
                    'validation_status' => $program['validationStatus'],
                    'label' => $program['label'],
                    'sort_order' => $index,
                ],
                $ctx,
            );
            $programs[(string) $program['code']] = $id;

            if (!$created) {
                continue;
            }

            foreach (array_values($program['objectiveCodes'] ?? []) as $position => $objectiveCode) {
                $objectiveId = $objectives[(string) $objectiveCode] ?? null;
                if ($objectiveId === null) {
                    throw new RuntimeException(sprintf(
                        'strategicData.programs[%d].objectiveCodes: obiectiv inexistent în această '
                        . 'versiune strategică: %s',
                        $index,
                        (string) $objectiveCode,
                    ));
                }
                Db::execute(
                    'INSERT INTO strategic_program_objectives (program_id, objective_id, sort_order, created_by)
                     VALUES (?, ?, ?, ?)',
                    [$id, $objectiveId, $position, $ctx->userId],
                );
            }
        }

        return [
            'strategyVersionId' => $strategyVersionId,
            'strategyVersionExternalKey' => (string) ($version['externalKey'] ?? ''),
            'pillars' => $pillars,
            'programs' => $programs,
            'objectives' => $objectives,
        ];
    }

    /** @param array<string,mixed> $payload */
    private static function getOrCreateStrategyVersion(array $payload, ImportContext $ctx): string
    {
        $externalKey = (string) ($payload['externalKey'] ?? '');
        $label = (string) ($payload['label'] ?? '');

        $existing = Db::one(
            'SELECT id, label FROM strategy_versions WHERE external_key = ?',
            [$externalKey],
        );

        if ($existing !== null) {
            if ((string) $existing['label'] !== $label) {
                $ctx->warn(sprintf(
                    'Versiune strategică %s: denumire diferită (în aplicație „%s”, în pachet „%s”). '
                    . 'Nu a fost suprascrisă.',
                    $externalKey,
                    (string) $existing['label'],
                    $label,
                ));
            }
            $ctx->recordItem('strategy_versions', $externalKey, (string) $existing['id'], ImportContext::UNCHANGED);
            return (string) $existing['id'];
        }

        $active = Db::count("SELECT COUNT(*) FROM strategy_versions WHERE status = 'ACTIVE'");
        $status = $active === 0 ? 'ACTIVE' : 'DRAFT';

        $id = Ids::newId();
        Db::execute(
            'INSERT INTO strategy_versions
               (id, external_key, label, period_start_year, period_end_year, status, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)',
            [
                $id,
                $externalKey,
                $label,
                (int) ($payload['periodStartYear'] ?? 0),
                (int) ($payload['periodEndYear'] ?? 0),
                $status,
                $ctx->userId,
            ],
        );

        if ($status === 'DRAFT') {
            $ctx->warn(sprintf(
                'Versiunea strategică %s a fost creată ca DRAFT deoarece există deja o versiune ACTIVE. '
                . 'Activarea se face explicit de Admin.',
                $externalKey,
            ));
        }

        $ctx->recordItem('strategy_versions', $externalKey, $id, ImportContext::CREATE, "status={$status}");
        return $id;
    }

    /**
     * Upserts a strategic row scoped to one strategy version.
     *
     * The table name comes from the closed set above, never from input.
     *
     * @param array<string,string|int|null> $columns
     * @return array{0:string,1:bool} id and whether it was created
     */
    private static function upsertScoped(
        string $table,
        string $strategyVersionId,
        string $code,
        array $columns,
        ImportContext $ctx,
    ): array {
        if (!in_array($table, self::SCOPED_TABLES, true)) {
            throw new RuntimeException("Tabel strategic necunoscut: {$table}");
        }

        $existing = Db::one(
            "SELECT id FROM {$table} WHERE strategy_version_id = ? AND code = ?",
            [$strategyVersionId, $code],
        );

        if ($existing !== null) {
            $ctx->recordItem($table, $code, (string) $existing['id'], ImportContext::UNCHANGED);
            return [(string) $existing['id'], false];
        }

        $id = Ids::newId();
        $names = array_keys($columns);

        Db::execute(
            sprintf(
                'INSERT INTO %s (id, strategy_version_id, code, %s, created_by) VALUES (?, ?, ?, %s, ?)',
                $table,
                implode(', ', $names),
                implode(', ', array_fill(0, count($names), '?')),
            ),
            [$id, $strategyVersionId, $code, ...array_values($columns), $ctx->userId],
        );

        $ctx->recordItem($table, $code, $id, ImportContext::CREATE);
        return [$id, true];
    }
}
