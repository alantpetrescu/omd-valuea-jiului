<?php

/**
 * Activation create and update — port of `activations/activation-write.ts`.
 *
 * Rules this enforces:
 *   - manual create requires an ACTIVE campaign; the importer is the only path
 *     allowed to attach to a CLOSED one;
 *   - the strategy version is INHERITED from the campaign and never re-chosen;
 *     an independent activation resolves it from its own key or the ACTIVE one;
 *   - `pillar` is only meaningful for an independent activation;
 *   - an audience carries either a catalogue code or a custom label, never both
 *     — a custom audience never creates a global catalogue entry;
 *   - `includeAnnualPlan` has no column: it materialises into
 *     `annual_plan_activations`, creating `annual_plans(year)` on demand, and
 *     relations for years no longer covered are removed;
 *   - materials and KPIs are upserted and soft-deleted, never hard-deleted,
 *     because monitoring snapshots reference them.
 */

declare(strict_types=1);

namespace Omd\Activations;

use Omd\Audit\Audit;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Support\Ids;
use Omd\Support\Validate;

final class ActivationWrite
{
    private const WRITE_COLUMNS = [
        'strategy_version_id', 'campaign_id', 'pillar_id', 'title', 'start_date', 'end_date',
        'status_id', 'responsible', 'planned_budget', 'actual_spend', 'implementation_mode_id',
        'implementation_partners', 'objective', 'products', 'zone', 'message', 'landing_url',
        'result_summary', 'what_worked', 'recommendation', 'source_created_at_raw',
        'source_updated_at_raw',
    ];

    /**
     * @param array<string,mixed> $body
     * @return array<string,mixed>
     */
    public static function parseInput(array $body): array
    {
        $v = new Validate($body);

        $input = [
            'title' => $v->string('title', required: true, max: 500),
            'campaignExternalKey' => $v->nullableString('campaignExternalKey'),
            'strategyVersionExternalKey' => $v->nullableString('strategyVersionExternalKey'),
            'pillarCode' => $v->nullableString('pillarCode'),
            'startDate' => $v->date('startDate'),
            'endDate' => $v->date('endDate'),
            'statusCode' => $v->string('statusCode') ?: 'DRAFT',
            'responsible' => $v->string('responsible', max: 255),
            'plannedBudget' => $v->decimal('plannedBudget'),
            'actualSpend' => $v->decimal('actualSpend'),
            'implementationModeCode' => $v->nullableString('implementationModeCode'),
            'implementationPartners' => $v->string('implementationPartners'),
            'objective' => $v->string('objective'),
            'products' => $v->stringList('products'),
            'zone' => $v->string('zone', max: 500),
            'message' => $v->string('message'),
            'landingUrl' => $v->string('landingUrl', max: 1000),
            'resultSummary' => $v->string('resultSummary'),
            'whatWorked' => $v->string('whatWorked'),
            'recommendation' => $v->string('recommendation', max: 255),
            'includeAnnualPlan' => $v->bool('includeAnnualPlan'),
        ];

        // Exactly one of code / customLabel, mirroring the DB CHECK constraint.
        $audiences = [];
        foreach (is_array($body['audiences'] ?? null) ? $body['audiences'] : [] as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $code = trim((string) ($entry['code'] ?? ''));
            $custom = trim((string) ($entry['customLabel'] ?? ''));
            if (($code !== '') === ($custom !== '')) {
                $v->fail(
                    "audiences.{$index}",
                    'Un public trebuie să aibă fie un cod din nomenclator, fie o denumire personalizată.',
                );
                continue;
            }
            $audiences[] = ['code' => $code === '' ? null : $code, 'customLabel' => $custom === '' ? null : $custom];
        }
        $input['audiences'] = $audiences;

        $fundingSources = [];
        foreach (is_array($body['fundingSources'] ?? null) ? $body['fundingSources'] : [] as $index => $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $typeCode = trim((string) ($entry['typeCode'] ?? ''));
            if ($typeCode === '') {
                $v->fail("fundingSources.{$index}.typeCode", 'Tipul de finanțare este obligatoriu.');
                continue;
            }
            $fundingSources[] = [
                'typeCode' => $typeCode,
                'label' => trim((string) ($entry['label'] ?? '')),
                'amount' => (float) ($entry['amount'] ?? 0),
            ];
        }
        $input['fundingSources'] = $fundingSources;

        $materials = [];
        foreach (is_array($body['materials'] ?? null) ? $body['materials'] : [] as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $row = new Validate($entry);
            $materials[] = [
                'id' => $row->nullableString('id'),
                'title' => $row->string('title', max: 500),
                'channel' => $row->string('channel'),
                'otherChannel' => $row->string('otherChannel'),
                'format' => $row->string('format'),
                'budgetAllocated' => $row->decimal('budgetAllocated'),
                'runStartDate' => $row->date('runStartDate'),
                'runEndDate' => $row->date('runEndDate'),
                'copy' => $row->string('copy'),
                'publicUrl' => $row->string('publicUrl', max: 1000),
                'visualName' => $row->string('visualName', max: 500),
                'visualCanvaUrl' => $row->string('visualCanvaUrl', max: 1000),
                'platformExternalId' => $row->string('platformExternalId', max: 255),
            ];
        }
        $input['materials'] = $materials;

        $kpis = [];
        foreach (is_array($body['kpis'] ?? null) ? $body['kpis'] : [] as $entry) {
            if (!is_array($entry)) {
                continue;
            }
            $row = new Validate($entry);
            $kpis[] = [
                'id' => $row->nullableString('id'),
                'enabled' => $row->bool('enabled', true),
                'name' => $row->string('name', max: 500),
                'target' => $row->string('target'),
                'result' => $row->string('result'),
                'source' => $row->string('source'),
                'collection' => $row->string('collection'),
            ];
        }
        $input['kpis'] = $kpis;

        $v->check('Datele activării nu sunt valide.');

        return $input;
    }

    /** @param array<string,mixed> $input */
    private static function endsBeforeStart(array $input): bool
    {
        return $input['startDate'] !== null
            && $input['endDate'] !== null
            && $input['endDate'] < $input['startDate'];
    }

    /**
     * Every calendar year touched by the period.
     *
     * @return list<int>
     */
    public static function overlappedYears(?string $startDate, ?string $endDate): array
    {
        if ($startDate === null || $endDate === null) {
            return [];
        }
        $first = (int) substr($startDate, 0, 4);
        $last = (int) substr($endDate, 0, 4);
        if ($first === 0 || $last === 0 || $last < $first) {
            return [];
        }
        return range($first, $last);
    }

    private static function idByColumn(string $table, string $column, string $value): ?string
    {
        $row = Db::one("SELECT id FROM {$table} WHERE {$column} = ?", [$value]);
        return $row === null ? null : (string) $row['id'];
    }

    /**
     * @param array<string,mixed> $input
     * @return array{campaignId:?string,strategyVersionId:string,statusId:string,implementationModeId:?string,pillarId:?string}
     */
    private static function resolveContext(array $input, bool $requireActiveCampaign): array
    {
        $campaignId = null;
        $strategyVersionId = null;

        if (($input['campaignExternalKey'] ?? null) !== null) {
            $campaign = Db::one(
                'SELECT c.id, c.strategy_version_id, s.code AS status_code
                   FROM campaigns c JOIN campaign_statuses s ON s.id = c.status_id
                  WHERE c.external_key = ? AND c.deleted_at IS NULL',
                [$input['campaignExternalKey']],
            );
            if ($campaign === null) {
                throw ApiError::validation('Campania selectată nu a fost găsită.');
            }

            // Only an ACTIVE campaign can spawn a new activation by hand.
            if ($requireActiveCampaign && $campaign['status_code'] !== 'ACTIVE') {
                throw ApiError::validation(
                    'O activare nouă poate fi creată doar dintr-o campanie cu stadiul Activă.'
                );
            }

            $campaignId = (string) $campaign['id'];
            $strategyVersionId = (string) $campaign['strategy_version_id'];

            if (($input['strategyVersionExternalKey'] ?? null) !== null) {
                $declared = self::idByColumn(
                    'strategy_versions',
                    'external_key',
                    $input['strategyVersionExternalKey'],
                );
                if ($declared !== null && $declared !== $strategyVersionId) {
                    throw ApiError::validation(
                        'Versiunea strategică trimisă intră în conflict cu cea a campaniei.'
                    );
                }
            }
        } elseif (($input['strategyVersionExternalKey'] ?? null) !== null) {
            $strategyVersionId = self::idByColumn(
                'strategy_versions',
                'external_key',
                $input['strategyVersionExternalKey'],
            );
            if ($strategyVersionId === null) {
                throw ApiError::validation('Versiunea strategică nu a fost găsită.');
            }
        } else {
            $active = Db::one(
                "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1"
            );
            if ($active === null) {
                throw ApiError::validation('Nu există o versiune strategică activă.');
            }
            $strategyVersionId = (string) $active['id'];
        }

        $statusId = self::idByColumn('campaign_statuses', 'code', $input['statusCode']);
        if ($statusId === null) {
            throw ApiError::validation("Stadiul „{$input['statusCode']}” nu există.");
        }

        $implementationModeId = ($input['implementationModeCode'] ?? null) !== null
            ? self::idByColumn('implementation_modes', 'code', $input['implementationModeCode'])
            : null;

        // A pillar only applies when there is no campaign to inherit the frame from.
        $pillarId = null;
        if ($campaignId === null && ($input['pillarCode'] ?? null) !== null) {
            $row = Db::one(
                'SELECT id FROM strategic_pillars WHERE strategy_version_id = ? AND code = ?',
                [$strategyVersionId, $input['pillarCode']],
            );
            $pillarId = $row === null ? null : (string) $row['id'];
        }

        return [
            'campaignId' => $campaignId,
            'strategyVersionId' => $strategyVersionId,
            'statusId' => $statusId,
            'implementationModeId' => $implementationModeId,
            'pillarId' => $pillarId,
        ];
    }

    /**
     * @param array<string,mixed> $input
     * @param array<string,mixed> $ctx
     * @return list<mixed>
     */
    private static function writeValues(array $input, array $ctx, string $timestamp): array
    {
        return [
            $ctx['strategyVersionId'],
            $ctx['campaignId'],
            $ctx['pillarId'],
            $input['title'],
            $input['startDate'],
            $input['endDate'],
            $ctx['statusId'],
            $input['responsible'],
            $input['plannedBudget'],
            $input['actualSpend'],
            $ctx['implementationModeId'],
            $input['implementationPartners'],
            $input['objective'],
            json_encode($input['products'] ?? [], JSON_UNESCAPED_UNICODE) ?: '[]',
            $input['zone'],
            $input['message'],
            $input['landingUrl'],
            $input['resultSummary'],
            $input['whatWorked'],
            $input['recommendation'],
            $timestamp,
            $timestamp,
        ];
    }

    /** @param array<string,mixed> $input */
    private static function replaceChildren(string $activationId, array $input, ?string $userId): void
    {
        // Audiences and funding have no stable external ids, so they are
        // replaced for this activation only — never globally.
        Db::execute('DELETE FROM activation_audiences WHERE activation_id = ?', [$activationId]);
        foreach (array_values($input['audiences']) as $index => $audience) {
            $segmentId = null;
            if ($audience['code'] !== null) {
                $segmentId = self::idByColumn('audience_segments', 'code', $audience['code']);
                if ($segmentId === null) {
                    throw ApiError::validation("Publicul „{$audience['code']}” nu există.");
                }
            }
            Db::execute(
                'INSERT INTO activation_audiences
                   (id, activation_id, audience_segment_id, custom_label, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [
                    Ids::newId(),
                    $activationId,
                    $segmentId,
                    $segmentId !== null ? null : $audience['customLabel'],
                    $index,
                    $userId,
                ],
            );
        }

        Db::execute('DELETE FROM activation_funding_sources WHERE activation_id = ?', [$activationId]);
        foreach (array_values($input['fundingSources']) as $index => $source) {
            $typeId = self::idByColumn('funding_types', 'code', $source['typeCode']);
            if ($typeId === null) {
                throw ApiError::validation("Tipul de finanțare „{$source['typeCode']}” nu există.");
            }
            Db::execute(
                'INSERT INTO activation_funding_sources
                   (id, activation_id, funding_type_id, custom_label, amount, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [Ids::newId(), $activationId, $typeId, $source['label'], $source['amount'], $index, $userId],
            );
        }

        // KPIs are upserted by their scoped external key.
        $keptKpis = [];
        foreach (array_values($input['kpis']) as $index => $kpi) {
            if ($kpi['name'] === '') {
                continue;
            }
            $externalKey = $kpi['id'] ?? ($activationId . '::kpi-' . Ids::newId());
            $keptKpis[] = $externalKey;

            $existing = self::idByColumn('activation_kpis', 'external_key', $externalKey);
            $values = [
                $kpi['enabled'] ? 1 : 0, $kpi['name'], $kpi['target'], $kpi['result'],
                $kpi['source'], $kpi['collection'], $index,
            ];

            if ($existing !== null) {
                Db::execute(
                    'UPDATE activation_kpis SET enabled = ?, name = ?, target_text = ?, result_text = ?,
                            source_text = ?, collection_text = ?, sort_order = ?, updated_by = ?
                      WHERE id = ?',
                    array_merge($values, [$userId, $existing]),
                );
            } else {
                Db::execute(
                    'INSERT INTO activation_kpis
                       (id, external_key, activation_id, enabled, name, target_text, result_text,
                        source_text, collection_text, sort_order, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    array_merge([Ids::newId(), $externalKey, $activationId], $values, [$userId]),
                );
            }
        }
        // KPIs removed in the editor are soft-deleted, keeping history intact.
        Db::execute(
            'UPDATE activation_kpis SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
              WHERE activation_id = ? AND deleted_at IS NULL'
            . ($keptKpis === [] ? '' : ' AND external_key NOT IN (' . Db::placeholders($keptKpis) . ')'),
            array_merge([$userId, $activationId], $keptKpis),
        );

        // Materials are upserted and never hard-deleted: performance snapshots
        // reference them and the history must survive.
        $keptMaterials = [];
        foreach ($input['materials'] as $material) {
            if ($material['title'] === '') {
                continue;
            }
            $externalKey = $material['id'] ?? Ids::newExternalKey('material');
            $keptMaterials[] = $externalKey;

            $channelId = null;
            if ($material['channel'] !== '') {
                $row = Db::one(
                    'SELECT id FROM activation_channels WHERE label = ? OR code = ?',
                    [$material['channel'], $material['channel']],
                );
                $channelId = $row === null ? null : (string) $row['id'];
            }

            $values = [
                $material['title'], $channelId, $material['channel'], $material['otherChannel'],
                $material['format'], $material['budgetAllocated'], $material['runStartDate'],
                $material['runEndDate'], $material['visualName'], $material['copy'],
                $material['publicUrl'], $material['visualCanvaUrl'], $material['platformExternalId'],
            ];

            $existing = self::idByColumn('activation_materials', 'external_key', $externalKey);
            if ($existing !== null) {
                Db::execute(
                    'UPDATE activation_materials
                        SET title = ?, channel_id = ?, channel_raw = ?, other_channel = ?, format_text = ?,
                            budget_allocated = ?, run_start_date = ?, run_end_date = ?, visual_name = ?,
                            copy_text = ?, public_url = ?, visual_canva_url = ?, platform_external_id = ?,
                            deleted_at = NULL, updated_by = ?
                      WHERE id = ?',
                    array_merge($values, [$userId, $existing]),
                );
            } else {
                Db::execute(
                    'INSERT INTO activation_materials
                       (id, external_key, activation_id, title, channel_id, channel_raw, other_channel,
                        format_text, budget_allocated, run_start_date, run_end_date, visual_name,
                        copy_text, public_url, visual_canva_url, platform_external_id, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    array_merge([Ids::newId(), $externalKey, $activationId], $values, [$userId]),
                );
            }
        }
        Db::execute(
            'UPDATE activation_materials SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
              WHERE activation_id = ? AND deleted_at IS NULL'
            . ($keptMaterials === [] ? '' : ' AND external_key NOT IN (' . Db::placeholders($keptMaterials) . ')'),
            array_merge([$userId, $activationId], $keptMaterials),
        );
    }

    /**
     * Turns `includeAnnualPlan` into plan relations, creating plans on demand.
     *
     * @param array<string,mixed> $input
     */
    private static function materialiseAnnualPlan(string $activationId, array $input, ?string $userId): void
    {
        $years = $input['includeAnnualPlan']
            ? self::overlappedYears($input['startDate'], $input['endDate'])
            : [];

        $planIds = [];
        foreach ($years as $year) {
            $plan = Db::one('SELECT id, deleted_at FROM annual_plans WHERE year = ?', [$year]);

            if ($plan !== null && $plan['deleted_at'] !== null) {
                Db::execute('UPDATE annual_plans SET deleted_at = NULL WHERE id = ?', [$plan['id']]);
            }
            if ($plan === null) {
                $id = Ids::newId();
                Db::execute(
                    'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
                    [$id, (string) $year, $year, $userId],
                );
                $plan = ['id' => $id];
            }

            $planIds[] = (string) $plan['id'];
            Db::execute(
                'INSERT INTO annual_plan_activations (annual_plan_id, activation_id, created_by)
                 VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE annual_plan_id = annual_plan_id',
                [$plan['id'], $activationId, $userId],
            );
        }

        // Years no longer covered lose their relation; the plan itself stays.
        Db::execute(
            'DELETE FROM annual_plan_activations WHERE activation_id = ?'
            . ($planIds === [] ? '' : ' AND annual_plan_id NOT IN (' . Db::placeholders($planIds) . ')'),
            array_merge([$activationId], $planIds),
        );
    }

    /**
     * @param array<string,mixed> $input
     * @return array{externalKey:string}
     */
    public static function create(array $input, ?string $userId): array
    {
        if (self::endsBeforeStart($input)) {
            throw ApiError::validation('Data de final trebuie să fie după data de început.');
        }

        return Db::transaction(static function () use ($input, $userId): array {
            $ctx = self::resolveContext($input, requireActiveCampaign: true);

            $id = Ids::newId();
            $externalKey = Ids::newExternalKey('activation');
            $timestamp = gmdate('c');

            $columns = implode(', ', self::WRITE_COLUMNS);
            $marks = implode(', ', array_fill(0, count(self::WRITE_COLUMNS), '?'));

            Db::execute(
                "INSERT INTO activations (id, external_key, {$columns}, created_by)
                 VALUES (?, ?, {$marks}, ?)",
                array_merge([$id, $externalKey], self::writeValues($input, $ctx, $timestamp), [$userId]),
            );

            self::replaceChildren($id, $input, $userId);
            self::materialiseAnnualPlan($id, $input, $userId);

            Audit::write(
                userId: $userId,
                action: 'CREATE',
                entityType: 'ACTIVATION',
                entityId: $id,
                entityExternalKey: $externalKey,
                newValues: ['title' => $input['title'], 'status' => $input['statusCode']],
            );

            return ['externalKey' => $externalKey];
        });
    }

    /** @param array<string,mixed> $input */
    public static function update(
        string $externalKey,
        array $input,
        ?int $expectedVersion,
        ?string $userId,
    ): void {
        if (self::endsBeforeStart($input)) {
            throw ApiError::validation('Data de final trebuie să fie după data de început.');
        }

        Db::transaction(static function () use ($externalKey, $input, $expectedVersion, $userId): void {
            $existing = Db::one(
                'SELECT id, version_number, title FROM activations
                  WHERE external_key = ? AND deleted_at IS NULL',
                [$externalKey],
            );
            if ($existing === null) {
                throw ApiError::notFound('Activarea nu a fost găsită.');
            }

            // Editing does not re-check campaign status: a historical activation
            // may legitimately belong to a CLOSED campaign.
            $ctx = self::resolveContext($input, requireActiveCampaign: false);
            $timestamp = gmdate('c');

            $assignments = implode(', ', array_map(
                static fn (string $c): string => $c . ' = ?',
                self::WRITE_COLUMNS,
            ));
            $guard = $expectedVersion === null ? '' : ' AND version_number = ?';

            $affected = Db::execute(
                "UPDATE activations SET {$assignments},
                        version_number = version_number + 1, updated_by = ?
                  WHERE id = ?{$guard}",
                array_merge(
                    self::writeValues($input, $ctx, $timestamp),
                    [$userId, (string) $existing['id']],
                    $expectedVersion === null ? [] : [$expectedVersion],
                ),
            );

            if ($affected === 0) {
                throw new ApiError(
                    'STALE_VERSION',
                    'Activarea a fost modificată de alt utilizator. Reîncarcă datele înainte de salvare.',
                );
            }

            self::replaceChildren((string) $existing['id'], $input, $userId);
            self::materialiseAnnualPlan((string) $existing['id'], $input, $userId);

            Audit::write(
                userId: $userId,
                action: 'UPDATE',
                entityType: 'ACTIVATION',
                entityId: (string) $existing['id'],
                entityExternalKey: $externalKey,
                oldValues: ['title' => $existing['title']],
                newValues: ['title' => $input['title'], 'status' => $input['statusCode']],
            );
        });
    }
}
