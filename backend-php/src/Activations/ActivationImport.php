<?php

/**
 * Activation import — OMD_ACTIVATIONS_PACKAGE. Port of
 * `activations/activation-import.ts`.
 *
 * Points where this contract differs from the DB and is easy to get wrong
 * (DB spec sections F2, G2, J):
 *
 *   - `budgetAllocated` arrives as a STRING; blank means NULL, not 0;
 *   - material `channel` is a LABEL ("Instagram"), not a code; the raw label is
 *     kept alongside the resolved FK;
 *   - an audience carries either a catalog code or a free-text custom label,
 *     never both — the DB enforces that with a CHECK;
 *   - `includeAnnualPlan` has NO column. It is materialised into
 *     `annual_plan_activations`, creating `annual_plans(year)` on demand;
 *   - campaigns reached through an activation are NEVER copied into
 *     `annual_plan_campaigns`, which holds manual selections only.
 *
 * Child collections without external ids (audiences, funding) are replaced for
 * the imported activation only. Materials and KPIs have stable keys and are
 * upserted — materials are never deleted, because monitoring snapshots hang off
 * them.
 */

declare(strict_types=1);

namespace Omd\Activations;

use Omd\Assets\Storage;
use Omd\Database\Db;
use Omd\Imports\ImportContext;
use Omd\Support\Ids;
use RuntimeException;

final class ActivationImport
{
    /**
     * KPI external keys are scoped to their activation.
     *
     * DEVIATION, forced by the handoff package itself. DB spec F2 maps
     * `kpis[].id` straight onto `activation_kpis.external_key`, which carries a
     * global UNIQUE. The DEMO_SEED breaks that: 78 KPI entries share only 33
     * distinct ids, because a campaign's KPI definitions are copied into every
     * activation of that campaign (`demo-kpi-camp-004-1` appears in both
     * `activation-demo-industrial-object` and `activation-demo-heritage-weekend`).
     *
     * Taking the mapping literally would collapse 78 KPIs into 33 and reassign
     * them to whichever activation was imported last — silent data loss. Scoping
     * the key keeps every row, respects the existing UNIQUE constraint and needs
     * no schema change.
     *
     * See KNOWN_DEVIATIONS.md.
     */
    public const KPI_KEY_SEPARATOR = '::';

    public static function scopedKpiKey(string $activationExternalKey, string $kpiId): string
    {
        return $activationExternalKey . self::KPI_KEY_SEPARATOR . $kpiId;
    }

    /**
     * The contract id inside a scoped key.
     *
     * The reverse of `scopedKpiKey`, for an exporter that needs to reproduce the
     * id the package carried. Nothing calls it yet — the Node original exports
     * the same function and equally has no caller, and its docblock claims the
     * exporter uses it, which is not true of either backend today. Kept so the
     * pair stays together and the deviation remains reversible.
     */
    public static function contractKpiId(string $externalKey): string
    {
        $position = strpos($externalKey, self::KPI_KEY_SEPARATOR);
        return $position === false
            ? $externalKey
            : substr($externalKey, $position + strlen(self::KPI_KEY_SEPARATOR));
    }

    /**
     * Imports activations and the manual annual-plan selections beside them.
     *
     * @param list<array<string,mixed>> $activations
     * @param list<array<string,mixed>> $annualPlans
     * @return list<string> storage keys written, for cleanup if the transaction fails
     */
    public static function import(array $activations, array $annualPlans, ImportContext $ctx): array
    {
        $published = [];

        foreach ($activations as $activation) {
            $externalKey = (string) $activation['externalKey'];
            $campaignKey = $activation['campaignExternalKey'] ?? null;

            $campaignId = (is_string($campaignKey) && $campaignKey !== '')
                ? self::idByColumn('campaigns', 'external_key', $campaignKey)
                : null;

            if (is_string($campaignKey) && $campaignKey !== '' && $campaignId === null) {
                throw new RuntimeException(
                    "activations[{$externalKey}].campaignExternalKey: campanie inexistentă ({$campaignKey})."
                );
            }

            $strategyVersionId = self::resolveStrategyVersion($activation, $campaignId);

            $statusCode = (string) ($activation['status']['code'] ?? '');
            $statusId = self::idByColumn('campaign_statuses', 'code', $statusCode);
            if ($statusId === null) {
                throw new RuntimeException(sprintf(
                    'activations[%s].status: stadiu inexistent (%s).',
                    $externalKey,
                    $statusCode === '' ? '—' : $statusCode,
                ));
            }

            $modeCode = $activation['implementationMode']['code'] ?? null;
            $implementationModeId = (is_string($modeCode) && $modeCode !== '')
                ? self::idByColumn('implementation_modes', 'code', $modeCode)
                : null;

            // Pillar is only meaningful for an independent activation; a linked
            // one inherits its strategic frame from the campaign.
            $pillarId = null;
            $pillarCode = $activation['pillar']['code'] ?? null;
            if ($campaignId === null && is_string($pillarCode) && $pillarCode !== '') {
                $row = Db::one(
                    'SELECT id FROM strategic_pillars WHERE strategy_version_id = ? AND code = ?',
                    [$strategyVersionId, $pillarCode],
                );
                $pillarId = $row === null ? null : (string) $row['id'];
            }

            $values = [
                $strategyVersionId,
                $campaignId,
                $pillarId,
                $activation['title'] ?? '',
                self::dateOrNull($activation['startDate'] ?? null),
                self::dateOrNull($activation['endDate'] ?? null),
                $statusId,
                $activation['responsible'] ?? '',
                self::decimalOrNull($activation['plannedBudget'] ?? null, "activations[{$externalKey}].plannedBudget"),
                self::decimalOrNull($activation['actualSpend'] ?? null, "activations[{$externalKey}].actualSpend"),
                $implementationModeId,
                $activation['implementationPartners'] ?? '',
                $activation['objective'] ?? '',
                json_encode($activation['products'] ?? [], JSON_UNESCAPED_UNICODE) ?: '[]',
                $activation['zone'] ?? '',
                $activation['message'] ?? '',
                $activation['landingUrl'] ?? '',
                $activation['resultSummary'] ?? '',
                $activation['whatWorked'] ?? '',
                $activation['recommendation'] ?? '',
                $activation['createdAt'] ?? '',
                $activation['updatedAt'] ?? '',
            ];

            $existing = self::idByColumn('activations', 'external_key', $externalKey);

            if ($existing !== null) {
                $activationId = $existing;
                Db::execute(
                    'UPDATE activations
                        SET strategy_version_id = ?, campaign_id = ?, pillar_id = ?, title = ?, start_date = ?,
                            end_date = ?, status_id = ?, responsible = ?, planned_budget = ?, actual_spend = ?,
                            implementation_mode_id = ?, implementation_partners = ?, objective = ?, products = ?,
                            zone = ?, message = ?, landing_url = ?, result_summary = ?, what_worked = ?,
                            recommendation = ?, source_created_at_raw = ?, source_updated_at_raw = ?,
                            version_number = version_number + 1, updated_by = ?
                      WHERE id = ?',
                    [...$values, $ctx->userId, $activationId],
                );
                $ctx->recordItem('activations', $externalKey, $activationId, ImportContext::UPDATE);
            } else {
                $activationId = Ids::newId();
                Db::execute(
                    sprintf(
                        'INSERT INTO activations
                           (id, external_key, strategy_version_id, campaign_id, pillar_id, title,
                            start_date, end_date, status_id, responsible, planned_budget, actual_spend,
                            implementation_mode_id, implementation_partners, objective, products, zone,
                            message, landing_url, result_summary, what_worked, recommendation,
                            source_created_at_raw, source_updated_at_raw, created_by)
                         VALUES (?, ?, %s, ?)',
                        implode(', ', array_fill(0, count($values), '?')),
                    ),
                    [$activationId, $externalKey, ...$values, $ctx->userId],
                );
                $ctx->recordItem('activations', $externalKey, $activationId, ImportContext::CREATE);
            }

            self::replaceAudiences($activationId, $activation, $ctx);
            self::replaceFundingSources($activationId, $activation, $ctx);
            self::upsertKpis($activationId, $activation, $ctx);
            self::upsertMaterials($activationId, $activation, $published, $ctx);
            self::materialiseAnnualPlan($activationId, $activation, $ctx);
        }

        self::importManualPlanSelections($annualPlans, $ctx);

        return $published;
    }

    /**
     * Contract money fields are strings. Blank stays NULL — "not supplied" is
     * not the same as zero (spec section 28 / rule 67.7).
     *
     * `is_numeric` is narrower than JavaScript's `Number()`: it rejects the hex
     * and whitespace-padded forms `Number()` accepts. For money fields that is
     * the safer side to err on — a value that is not plainly a number is far
     * more likely a typo than an intentional `0x1F` budget.
     */
    private static function decimalOrNull(mixed $value, string $where): ?float
    {
        if ($value === null) {
            return null;
        }
        if (is_int($value) || is_float($value)) {
            return is_finite((float) $value) ? (float) $value : null;
        }

        $trimmed = trim((string) $value);
        if ($trimmed === '') {
            return null;
        }
        if (!is_numeric($trimmed)) {
            throw new RuntimeException("{$where}: valoare numerică invalidă „{$trimmed}”.");
        }
        return (float) $trimmed;
    }

    private static function dateOrNull(mixed $value): ?string
    {
        return (is_string($value) && trim($value) !== '') ? $value : null;
    }

    /**
     * A single-column id lookup.
     *
     * Table and column are interpolated because an identifier cannot be a bound
     * parameter. Every call site passes a literal, and the pattern check makes
     * that a guarantee rather than a convention someone breaks later.
     */
    private static function idByColumn(string $table, string $column, string $value): ?string
    {
        if (preg_match('/^[a-z_]+$/', $table) !== 1 || preg_match('/^[a-z_]+$/', $column) !== 1) {
            throw new RuntimeException('Identificator SQL invalid în căutarea de id.');
        }

        $row = Db::one("SELECT id FROM {$table} WHERE {$column} = ?", [$value]);
        return $row === null ? null : (string) $row['id'];
    }

    /** @param array<string,mixed> $activation */
    private static function resolveStrategyVersion(array $activation, ?string $campaignId): string
    {
        $externalKey = (string) $activation['externalKey'];
        $declaredKey = $activation['strategyVersionExternalKey'] ?? null;
        $hasDeclared = is_string($declaredKey) && $declaredKey !== '';

        // Linked to a campaign: the version is inherited, never re-chosen (spec 20).
        if ($campaignId !== null) {
            $row = Db::one('SELECT strategy_version_id FROM campaigns WHERE id = ?', [$campaignId]);
            if ($row === null) {
                throw new RuntimeException("activations[{$externalKey}]: campania asociată nu a fost găsită.");
            }

            if ($hasDeclared) {
                $declared = self::idByColumn('strategy_versions', 'external_key', $declaredKey);
                if ($declared !== null && $declared !== (string) $row['strategy_version_id']) {
                    throw new RuntimeException(
                        "activations[{$externalKey}].strategyVersionExternalKey intră în conflict "
                        . 'cu versiunea strategică a campaniei.'
                    );
                }
            }

            return (string) $row['strategy_version_id'];
        }

        if ($hasDeclared) {
            $id = self::idByColumn('strategy_versions', 'external_key', $declaredKey);
            if ($id === null) {
                throw new RuntimeException(
                    "activations[{$externalKey}].strategyVersionExternalKey: versiune inexistentă "
                    . "({$declaredKey})."
                );
            }
            return $id;
        }

        $active = Db::one(
            "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1"
        );
        if ($active === null) {
            throw new RuntimeException(
                "activations[{$externalKey}]: activare independentă fără versiune strategică "
                . 'și nu există nicio versiune ACTIVE.'
            );
        }
        return (string) $active['id'];
    }

    /** @param array<string,mixed> $activation */
    private static function replaceAudiences(string $activationId, array $activation, ImportContext $ctx): void
    {
        $externalKey = (string) $activation['externalKey'];
        Db::execute('DELETE FROM activation_audiences WHERE activation_id = ?', [$activationId]);

        foreach (array_values($activation['audiences'] ?? []) as $index => $audience) {
            $segmentId = null;
            $customLabel = null;

            $code = $audience['code'] ?? null;
            $label = $audience['label'] ?? null;

            if (is_string($code) && $code !== '') {
                $segmentId = self::idByColumn('audience_segments', 'code', $code);
                if ($segmentId === null) {
                    throw new RuntimeException(
                        "activations[{$externalKey}].audiences[{$index}]: public inexistent ({$code})."
                    );
                }
            } elseif (is_string($label) && $label !== '') {
                // Valid and deliberate: spec section 21 requires custom audiences
                // to stay custom, without silently creating a global catalog entry.
                $customLabel = $label;
            } else {
                throw new RuntimeException(
                    "activations[{$externalKey}].audiences[{$index}]: fără cod și fără denumire."
                );
            }

            Db::execute(
                'INSERT INTO activation_audiences
                   (id, activation_id, audience_segment_id, custom_label, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?, ?)',
                [Ids::newId(), $activationId, $segmentId, $customLabel, $index, $ctx->userId],
            );
        }
    }

    /** @param array<string,mixed> $activation */
    private static function replaceFundingSources(
        string $activationId,
        array $activation,
        ImportContext $ctx,
    ): void {
        $externalKey = (string) $activation['externalKey'];
        Db::execute('DELETE FROM activation_funding_sources WHERE activation_id = ?', [$activationId]);

        foreach (array_values($activation['fundingSources'] ?? []) as $index => $source) {
            $typeCode = (string) ($source['type']['code'] ?? '');
            $typeId = self::idByColumn('funding_types', 'code', $typeCode);
            if ($typeId === null) {
                throw new RuntimeException(sprintf(
                    'activations[%s].fundingSources[%d]: tip de finanțare inexistent (%s).',
                    $externalKey,
                    $index,
                    $typeCode === '' ? '—' : $typeCode,
                ));
            }

            Db::execute(
                'INSERT INTO activation_funding_sources
                   (id, activation_id, funding_type_id, custom_label, amount, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    Ids::newId(),
                    $activationId,
                    $typeId,
                    $source['label'] ?? '',
                    self::decimalOrNull($source['amount'] ?? null, "fundingSources[{$index}].amount") ?? 0,
                    $index,
                    $ctx->userId,
                ],
            );
        }
    }

    /** @param array<string,mixed> $activation */
    private static function upsertKpis(string $activationId, array $activation, ImportContext $ctx): void
    {
        $activationKey = (string) $activation['externalKey'];

        foreach (array_values($activation['kpis'] ?? []) as $index => $kpi) {
            $externalKey = self::scopedKpiKey($activationKey, (string) $kpi['id']);
            $existing = self::idByColumn('activation_kpis', 'external_key', $externalKey);

            $columns = [
                !empty($kpi['enabled']) ? 1 : 0,
                $kpi['name'] ?? '',
                $kpi['target'] ?? '',
                $kpi['result'] ?? '',
                $kpi['source'] ?? '',
                $kpi['collection'] ?? '',
                $index,
            ];

            if ($existing !== null) {
                Db::execute(
                    'UPDATE activation_kpis
                        SET activation_id = ?, enabled = ?, name = ?, target_text = ?, result_text = ?,
                            source_text = ?, collection_text = ?, sort_order = ?, updated_by = ?
                      WHERE id = ?',
                    [$activationId, ...$columns, $ctx->userId, $existing],
                );
                $ctx->recordItem('activation_kpis', $externalKey, $existing, ImportContext::UPDATE);
            } else {
                $id = Ids::newId();
                Db::execute(
                    'INSERT INTO activation_kpis
                       (id, external_key, activation_id, enabled, name, target_text, result_text,
                        source_text, collection_text, sort_order, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$id, $externalKey, $activationId, ...$columns, $ctx->userId],
                );
                $ctx->recordItem('activation_kpis', $externalKey, $id, ImportContext::CREATE);
            }
        }
    }

    /**
     * @param array<string,mixed> $activation
     * @param list<string>        $published
     */
    private static function upsertMaterials(
        string $activationId,
        array $activation,
        array &$published,
        ImportContext $ctx,
    ): void {
        $activationKey = (string) $activation['externalKey'];

        foreach ($activation['materials'] ?? [] as $material) {
            $materialKey = (string) $material['id'];
            $where = "activations[{$activationKey}].materials[{$materialKey}]";

            // Channel arrives as a display label; the code lives in the catalog.
            $channelId = null;
            $channelLabel = (string) ($material['channel'] ?? '');
            if ($channelLabel !== '') {
                $channelId = self::idByColumn('activation_channels', 'label', $channelLabel);
                if ($channelId === null) {
                    $ctx->warn("{$where}: canal necunoscut în nomenclator „{$channelLabel}”.");
                }
            }

            $templateCampaignKey = (string) ($material['templateCampaignId'] ?? '');
            $templateKey = (string) ($material['templateId'] ?? '');
            $templateAssetKey = (string) ($material['templateAssetId'] ?? '');

            $templateCampaignId = $templateCampaignKey !== ''
                ? self::idByColumn('campaigns', 'external_key', $templateCampaignKey)
                : null;
            $templateId = $templateKey !== ''
                ? self::idByColumn('campaign_templates', 'external_key', $templateKey)
                : null;
            $templateAssetId = $templateAssetKey !== ''
                ? self::idByColumn('campaign_template_assets', 'external_key', $templateAssetKey)
                : null;

            if ($templateKey !== '' && $templateId === null) {
                throw new RuntimeException("{$where}.templateId: template inexistent.");
            }
            if ($templateAssetKey !== '' && $templateAssetId === null) {
                throw new RuntimeException("{$where}.templateAssetId: vizual de template inexistent.");
            }

            // A material may carry its own image instead of reusing a template asset.
            $ownAssetId = null;
            $src = (string) ($material['visual']['src'] ?? '');
            if (str_starts_with($src, 'data:')) {
                $file = Storage::stageDataUri($src);
                $assetKey = "asset-{$materialKey}";

                /*
                 * The same reconciliation the campaign import does, and for two
                 * reasons.
                 *
                 * The insert used to be unconditional, so a second import of the
                 * same package would violate `uq_assets_external_key` and stop the
                 * whole run. The demo seed never reaches here — its materials
                 * reuse template visuals rather than carrying their own — which is
                 * the only reason it has not been hit.
                 *
                 * And, as there, a row whose file is missing has to be repairable:
                 * re-publish under the key the row already holds.
                 */
                $existingAsset = Db::one(
                    'SELECT id, storage_path FROM assets WHERE external_key = ?',
                    [$assetKey],
                );

                if ($existingAsset !== null) {
                    $ownAssetId = (string) $existingAsset['id'];
                    $existingKey = (string) ($existingAsset['storage_path'] ?? '');

                    if ($existingKey !== '' && !Storage::exists($existingKey)) {
                        Storage::publish($file['temporaryPath'], $existingKey);
                        $published[] = $existingKey;
                        $ctx->recordItem('assets', $assetKey, $ownAssetId, ImportContext::UPDATE);
                    } else {
                        $ctx->recordItem('assets', $assetKey, $ownAssetId, ImportContext::UNCHANGED);
                    }
                } else {
                    $ownAssetId = Ids::newId();
                    Db::execute(
                        'INSERT INTO assets
                           (id, external_key, filename, original_filename, mime_type, file_size,
                            storage_path, checksum_sha256, created_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $ownAssetId,
                            $assetKey,
                            $file['filename'],
                            $file['filename'],
                            $file['mimeType'],
                            $file['fileSize'],
                            $file['storageKey'],
                            $file['checksumSha256'],
                            $ctx->userId,
                        ],
                    );
                    Storage::publish($file['temporaryPath'], $file['storageKey']);
                    $published[] = $file['storageKey'];
                    $ctx->recordItem('assets', $assetKey, $ownAssetId, ImportContext::CREATE);
                }
            }

            $values = [
                $activationId,
                $material['title'] ?? '',
                $channelId,
                $channelLabel,
                $material['otherChannel'] ?? '',
                $material['format'] ?? '',
                self::decimalOrNull($material['budgetAllocated'] ?? null, "{$where}.budgetAllocated"),
                self::dateOrNull($material['runStartDate'] ?? null),
                self::dateOrNull($material['runEndDate'] ?? null),
                $material['visual']['name'] ?? '',
                $material['visual']['canvaUrl'] ?? '',
                $ownAssetId,
                $material['copy'] ?? '',
                $material['publicUrl'] ?? '',
                $material['externalId'] ?? '',
                $templateCampaignId,
                $templateId,
                $templateAssetId,
            ];

            $existing = self::idByColumn('activation_materials', 'external_key', $materialKey);

            if ($existing !== null) {
                Db::execute(
                    'UPDATE activation_materials
                        SET activation_id = ?, title = ?, channel_id = ?, channel_raw = ?, other_channel = ?,
                            format_text = ?, budget_allocated = ?, run_start_date = ?, run_end_date = ?,
                            visual_name = ?, visual_canva_url = ?, own_asset_id = COALESCE(?, own_asset_id),
                            copy_text = ?, public_url = ?, platform_external_id = ?,
                            template_campaign_id = ?, campaign_template_id = ?, campaign_template_asset_id = ?,
                            updated_by = ?
                      WHERE id = ?',
                    [...$values, $ctx->userId, $existing],
                );
                $ctx->recordItem('activation_materials', $materialKey, $existing, ImportContext::UPDATE);
            } else {
                $id = Ids::newId();
                Db::execute(
                    sprintf(
                        'INSERT INTO activation_materials
                           (id, external_key, activation_id, title, channel_id, channel_raw, other_channel,
                            format_text, budget_allocated, run_start_date, run_end_date, visual_name,
                            visual_canva_url, own_asset_id, copy_text, public_url, platform_external_id,
                            template_campaign_id, campaign_template_id, campaign_template_asset_id, created_by)
                         VALUES (?, ?, %s, ?)',
                        implode(', ', array_fill(0, count($values), '?')),
                    ),
                    [$id, $materialKey, ...$values, $ctx->userId],
                );
                $ctx->recordItem('activation_materials', $materialKey, $id, ImportContext::CREATE);
            }
        }
    }

    /**
     * Every calendar year touched by the activation period.
     *
     * @return list<int>
     */
    public static function overlappedYears(?string $startDate, ?string $endDate): array
    {
        if ($startDate === null || $endDate === null) {
            return [];
        }

        $first = substr($startDate, 0, 4);
        $last = substr($endDate, 0, 4);
        if (!ctype_digit($first) || !ctype_digit($last)) {
            return [];
        }

        $from = (int) $first;
        $to = (int) $last;
        if ($to < $from) {
            return [];
        }

        return range($from, $to);
    }

    private static function getOrCreateAnnualPlan(int $year, ImportContext $ctx): string
    {
        $existing = Db::one('SELECT id, deleted_at FROM annual_plans WHERE year = ?', [$year]);

        if ($existing !== null) {
            // A soft-deleted plan for the same year is reactivated, never duplicated.
            if ($existing['deleted_at'] !== null) {
                Db::execute(
                    'UPDATE annual_plans SET deleted_at = NULL, deleted_by = NULL WHERE id = ?',
                    [$existing['id']],
                );
            }
            return (string) $existing['id'];
        }

        $id = Ids::newId();
        Db::execute(
            'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
            [$id, (string) $year, $year, $ctx->userId],
        );
        $ctx->recordItem(
            'annual_plans',
            (string) $year,
            $id,
            ImportContext::CREATE,
            'materialised from activation dates',
        );
        return $id;
    }

    /**
     * Materialises `includeAnnualPlan` into relations.
     *
     * @param array<string,mixed> $activation
     */
    private static function materialiseAnnualPlan(
        string $activationId,
        array $activation,
        ImportContext $ctx,
    ): void {
        $externalKey = (string) $activation['externalKey'];

        $years = !empty($activation['includeAnnualPlan'])
            ? self::overlappedYears(
                self::dateOrNull($activation['startDate'] ?? null),
                self::dateOrNull($activation['endDate'] ?? null),
            )
            : [];

        $planIds = [];
        foreach ($years as $year) {
            $planId = self::getOrCreateAnnualPlan($year, $ctx);
            $planIds[$planId] = true;
            Db::execute(
                'INSERT INTO annual_plan_activations (annual_plan_id, activation_id, created_by)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE annual_plan_id = annual_plan_id',
                [$planId, $activationId, $ctx->userId],
            );
            $ctx->recordItem(
                'annual_plan_activations',
                "{$year}:{$externalKey}",
                null,
                ImportContext::CREATE,
            );
        }

        // Drop relations for years the activation no longer covers after a date change.
        $stale = Db::count(
            'SELECT COUNT(*) FROM annual_plan_activations WHERE activation_id = ?',
            [$activationId],
        );

        if ($stale > count($planIds)) {
            $keep = array_keys($planIds);
            Db::execute(
                'DELETE FROM annual_plan_activations WHERE activation_id = ?'
                . ($keep === [] ? '' : ' AND annual_plan_id NOT IN (' . Db::placeholders($keep) . ')'),
                [$activationId, ...$keep],
            );
        }
    }

    /**
     * Explicit `annualPlans[]` carry MANUAL campaign selections only.
     *
     * @param list<array<string,mixed>> $plans
     */
    private static function importManualPlanSelections(array $plans, ImportContext $ctx): void
    {
        foreach ($plans as $plan) {
            $year = (int) $plan['year'];
            if ((string) $plan['externalKey'] !== (string) $year) {
                throw new RuntimeException(sprintf(
                    'annualPlans[%s]: externalKey trebuie să coincidă cu anul.',
                    (string) $plan['externalKey'],
                ));
            }

            $planId = self::getOrCreateAnnualPlan($year, $ctx);
            Db::execute('DELETE FROM annual_plan_campaigns WHERE annual_plan_id = ?', [$planId]);

            foreach (array_values($plan['selectedCampaignExternalKeys'] ?? []) as $index => $campaignKey) {
                $campaignId = self::idByColumn('campaigns', 'external_key', (string) $campaignKey);
                if ($campaignId === null) {
                    throw new RuntimeException(sprintf(
                        'annualPlans[%d].selectedCampaignExternalKeys: campanie inexistentă (%s).',
                        $year,
                        (string) $campaignKey,
                    ));
                }
                Db::execute(
                    'INSERT INTO annual_plan_campaigns (annual_plan_id, campaign_id, sort_order, created_by)
                     VALUES (?, ?, ?, ?)',
                    [$planId, $campaignId, $index, $ctx->userId],
                );
            }

            $ctx->recordItem('annual_plan_campaigns', (string) $year, $planId, ImportContext::UPDATE);
        }
    }
}
