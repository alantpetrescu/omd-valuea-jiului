<?php

/**
 * Campaign export — port of `campaigns/campaign-export.ts`.
 *
 * Produces a complete `OMD_CAMPAIGNS_PACKAGE` v1.0 for one campaign: the
 * metadata envelope, the strategy version with its pillars, programmes and
 * objectives, all ten master catalogues, and the campaign in contract shape.
 *
 * Why the whole package rather than one campaign object: a campaign references
 * its pillar, programmes, objectives, audiences and CTAs by *code*, and those
 * codes are unique only within a strategy version. A file carrying codes
 * without the tables that define them cannot be imported anywhere except back
 * into the database it came from.
 *
 * The package also carries the campaign's lineage — its parent chain and any
 * campaign it supersedes — because the importer rejects an external key it
 * cannot resolve.
 *
 * The result is validated against the frozen schema before it leaves the
 * process. That check is the point of the endpoint: an export nobody can
 * re-import is a backup that does not restore.
 */

declare(strict_types=1);

namespace Omd\Campaigns;

use Omd\Assets\Storage;
use Omd\Database\Db;
use Omd\Imports\Contract;
use Omd\Support\Logger;
use Throwable;

final class CampaignExport
{
    private const CAMPAIGN_SELECT = <<<'SQL'
        SELECT
          c.id, c.external_key, c.campaign_family_external_key, c.strategy_version_id,
          prev.external_key   AS supersedes_external_key,
          parent.external_key AS parent_external_key,
          c.title, c.accent,
          ct.code  AS type_code,        ct.label  AS type_label,
          stt.code AS status_code,      stt.label AS status_label,
          p.code   AS pillar_code,      p.label   AS pillar_label,
          sz.code  AS seasonality_code, sz.label  AS seasonality_label,
          c.seasonality_months, c.seasonality_note, c.version_label, c.responsible,
          c.marketing_objective, c.direct_result, c.strategic_contribution,
          c.primary_audience_description, c.central_idea, c.promise, c.main_message,
          c.secondary_messages, c.tone, c.insight, c.value_proposition,
          c.products, c.products_intro, c.product_condition, c.channels, c.pr_partnerships,
          c.storytelling_directions, c.fixed_elements, c.adaptable_elements, c.adaptation_limits,
          c.framework_deliverables, c.deliverable_intro, c.posts, c.headlines, c.video_concepts,
          c.application_examples, c.kpi_definitions, c.activation_examples, c.no_visuals_note,
          c.source_file, c.source_created_at_raw, c.source_updated_at_raw,
          c.created_at, c.updated_at
        FROM campaigns c
        JOIN campaign_types    ct  ON ct.id  = c.campaign_type_id
        JOIN campaign_statuses stt ON stt.id = c.status_id
        JOIN strategic_pillars p   ON p.id   = c.pillar_id
        JOIN seasonality_types sz  ON sz.id  = c.seasonality_type_id
        LEFT JOIN campaigns prev   ON prev.id   = c.supersedes_campaign_id
        LEFT JOIN campaigns parent ON parent.id = c.parent_campaign_id
        WHERE c.external_key = ? AND c.deleted_at IS NULL
        SQL;

    /** Contract key => table. The contract names them differently from the schema. */
    private const CATALOG_KEYS = [
        'campaignTypes' => 'campaign_types',
        'campaignStatuses' => 'campaign_statuses',
        'audiences' => 'audience_segments',
        'ctas' => 'cta_types',
        'products' => 'product_catalog',
        'channels' => 'channel_catalog',
        'seasonalityTypes' => 'seasonality_types',
        'activationChannels' => 'activation_channels',
        'implementationModes' => 'implementation_modes',
        'fundingTypes' => 'funding_types',
    ];

    /** `{ code, label }` — the contract's catalogRef, which never takes a bare string. */
    private static function ref(?string $code, ?string $label): array
    {
        return ['code' => $code ?? '', 'label' => $label ?? ''];
    }

    /** The contract wants ISO-8601; MySQL hands back 'Y-m-d H:i:s.u' in UTC. */
    private static function isoFromMysql(?string $value): string
    {
        if ($value === null || $value === '') {
            return '';
        }
        $iso = str_replace(' ', 'T', $value) . 'Z';
        return (string) preg_replace('/(\.\d{3})\d+Z$/', '$1Z', $iso);
    }

    /**
     * Walks parent / supersedes links to the root.
     *
     * Returns external keys with every referenced campaign *before* the one
     * that references it, so the importer resolves each key by the time it
     * needs it.
     *
     * @return list<string>
     */
    private static function lineageKeys(string $externalKey): array
    {
        $ordered = [];
        $seen = [];
        $queue = [$externalKey];

        while ($queue !== []) {
            $key = array_shift($queue);
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;

            $links = Db::one(
                'SELECT parent.external_key AS parent, prev.external_key AS supersedes
                   FROM campaigns c
                   LEFT JOIN campaigns parent ON parent.id = c.parent_campaign_id
                   LEFT JOIN campaigns prev   ON prev.id   = c.supersedes_campaign_id
                  WHERE c.external_key = ? AND c.deleted_at IS NULL',
                [$key],
            );
            if ($links === null) {
                continue;
            }

            array_unshift($ordered, $key);
            foreach ([$links['parent'], $links['supersedes']] as $referenced) {
                if (is_string($referenced) && $referenced !== '' && !isset($seen[$referenced])) {
                    $queue[] = $referenced;
                }
            }
        }

        return $ordered;
    }

    /** @return array{primary:string,secondary:list<string>} */
    private static function relationCodes(
        string $table,
        string $joinTable,
        string $column,
        string $campaignId,
    ): array {
        $rows = Db::rows(
            "SELECT s.code, r.relation_role
               FROM {$table} r JOIN {$joinTable} s ON s.id = r.{$column}
              WHERE r.campaign_id = ? ORDER BY r.sort_order",
            [$campaignId],
        );

        $primary = '';
        $secondary = [];
        foreach ($rows as $row) {
            if ($row['relation_role'] === 'PRIMARY' && $primary === '') {
                $primary = (string) $row['code'];
                continue;
            }
            if ($row['relation_role'] === 'SECONDARY') {
                $secondary[] = (string) $row['code'];
            }
        }
        return ['primary' => $primary, 'secondary' => $secondary];
    }

    /** @return array{mockups:list<array<string,mixed>>,missing:list<string>,assetCount:int} */
    private static function loadMockups(string $campaignId, string $visuals): array
    {
        $templates = Db::rows(
            'SELECT id, external_key, name, formats_text, structure_text, is_generic, canva_url
               FROM campaign_templates
              WHERE campaign_id = ? AND deleted_at IS NULL
              ORDER BY sort_order, name',
            [$campaignId],
        );

        $assets = Db::rows(
            'SELECT cta.campaign_template_id AS template_id, cta.external_key,
                    cta.format_text, cta.label, a.storage_path, a.mime_type
               FROM campaign_template_assets cta
               JOIN campaign_templates t ON t.id = cta.campaign_template_id
               JOIN assets a             ON a.id = cta.asset_id
              WHERE t.campaign_id = ? AND cta.deleted_at IS NULL AND a.deleted_at IS NULL
              ORDER BY cta.sort_order',
            [$campaignId],
        );

        // Re-encode each file as the data URI the importer expects. A missing
        // file is reported rather than silently exported as an empty src: an
        // asset that imports as nothing is worse than an export that says so.
        $sources = [];
        $missing = [];

        if ($visuals === 'embed') {
            foreach ($assets as $asset) {
                $uri = null;
                try {
                    $uri = Storage::toDataUri((string) $asset['storage_path'], (string) $asset['mime_type']);
                } catch (Throwable $error) {
                    Logger::warn('export: asset file could not be read', [
                        'storageKey' => $asset['storage_path'],
                        'asset' => $asset['external_key'],
                        'message' => $error->getMessage(),
                    ]);
                }
                if ($uri === null) {
                    $missing[] = (string) $asset['external_key'];
                    continue;
                }
                $sources[(string) $asset['external_key']] = $uri;
            }
        }

        $mockups = [];
        foreach ($templates as $template) {
            $templateAssets = [];
            foreach ($assets as $asset) {
                if ((string) $asset['template_id'] !== (string) $template['id']) {
                    continue;
                }
                $key = (string) $asset['external_key'];
                $templateAssets[] = [
                    'id' => $key,
                    'format' => $asset['format_text'],
                    'label' => $asset['label'],
                    'src' => $visuals === 'embed'
                        ? ($sources[$key] ?? '')
                        : Storage::publicUrl((string) $asset['storage_path']),
                ];
            }

            $mockups[] = [
                'id' => $template['external_key'],
                'name' => $template['name'],
                'formats' => $template['formats_text'],
                'structure' => $template['structure_text'],
                'generic' => (int) $template['is_generic'] === 1,
                'canvaUrl' => $template['canva_url'],
                'assets' => $templateAssets,
            ];
        }

        return ['mockups' => $mockups, 'missing' => $missing, 'assetCount' => count($assets)];
    }

    /** @return array<string,mixed> */
    private static function loadStrategicData(string $strategyVersionId): array
    {
        $version = Db::one(
            'SELECT external_key, label, period_start_year, period_end_year
               FROM strategy_versions WHERE id = ?',
            [$strategyVersionId],
        );

        $pillars = Db::rows(
            'SELECT code, label, display_label, hint FROM strategic_pillars
              WHERE strategy_version_id = ? ORDER BY sort_order, code',
            [$strategyVersionId],
        );

        $programRows = Db::rows(
            'SELECT id, code, name, result_text, marketing_objective, approach, horizon_result_text,
                    target_groups_text, kpi_text, sources_text, annual_actions, validation_status, label
               FROM strategic_programs
              WHERE strategy_version_id = ? ORDER BY sort_order, code',
            [$strategyVersionId],
        );

        $links = Db::rows(
            'SELECT po.program_id, o.code
               FROM strategic_program_objectives po
               JOIN strategic_objectives o ON o.id = po.objective_id
              WHERE o.strategy_version_id = ? ORDER BY o.sort_order',
            [$strategyVersionId],
        );

        $objectives = Db::rows(
            'SELECT code, name, source, label FROM strategic_objectives
              WHERE strategy_version_id = ? ORDER BY sort_order, code',
            [$strategyVersionId],
        );

        $programs = [];
        foreach ($programRows as $row) {
            $objectiveCodes = [];
            foreach ($links as $link) {
                if ((string) $link['program_id'] === (string) $row['id']) {
                    $objectiveCodes[] = (string) $link['code'];
                }
            }
            $programs[] = [
                'code' => $row['code'],
                'name' => $row['name'],
                'result' => $row['result_text'],
                'objectiveCodes' => $objectiveCodes,
                'marketingObjective' => $row['marketing_objective'],
                'approach' => $row['approach'],
                'result2028' => $row['horizon_result_text'],
                'targetGroupsText' => $row['target_groups_text'],
                'kpiText' => $row['kpi_text'],
                'sourcesText' => $row['sources_text'],
                'annualActions' => $row['annual_actions'],
                'validationStatus' => $row['validation_status'],
                'label' => $row['label'],
            ];
        }

        return [
            'strategyVersion' => [
                'externalKey' => $version['external_key'] ?? '',
                'label' => $version['label'] ?? '',
                'periodStartYear' => (int) ($version['period_start_year'] ?? 0),
                'periodEndYear' => (int) ($version['period_end_year'] ?? 0),
            ],
            'pillars' => array_map(static fn (array $row): array => [
                'code' => $row['code'],
                'label' => $row['label'],
                'displayLabel' => $row['display_label'],
                'hint' => $row['hint'],
            ], $pillars),
            'programs' => $programs,
            'objectives' => array_map(static fn (array $row): array => [
                'code' => $row['code'],
                'name' => $row['name'],
                'source' => $row['source'],
                'label' => $row['label'],
            ], $objectives),
        ];
    }

    /** @return array<string,list<array{code:string,label:string}>> */
    private static function loadCatalogs(): array
    {
        $catalogs = [];
        foreach (self::CATALOG_KEYS as $contractKey => $table) {
            // No is_active filter: a campaign may reference a retired value, and
            // the package has to define every code it uses.
            $catalogs[$contractKey] = Db::rows("SELECT code, label FROM {$table} ORDER BY sort_order, label");
        }
        return $catalogs;
    }

    /**
     * @param array<string,mixed> $row
     * @return array{campaign:array<string,mixed>,missing:list<string>,assetCount:int}
     */
    private static function buildCampaign(array $row, string $visuals): array
    {
        $id = (string) $row['id'];

        $programs = self::relationCodes('campaign_programs', 'strategic_programs', 'program_id', $id);
        $objectives = self::relationCodes('campaign_objectives', 'strategic_objectives', 'objective_id', $id);

        $audiences = Db::rows(
            'SELECT a.code, a.label, ca.relation_role
               FROM campaign_audiences ca JOIN audience_segments a ON a.id = ca.audience_segment_id
              WHERE ca.campaign_id = ? ORDER BY ca.sort_order',
            [$id],
        );
        $ctas = Db::rows(
            'SELECT t.code, t.label FROM campaign_ctas cc JOIN cta_types t ON t.id = cc.cta_type_id
              WHERE cc.campaign_id = ? ORDER BY cc.sort_order',
            [$id],
        );

        $mockupData = self::loadMockups($id, $visuals);

        $primaryAudience = null;
        $secondaryAudiences = [];
        foreach ($audiences as $audience) {
            if ($audience['relation_role'] === 'PRIMARY' && $primaryAudience === null) {
                $primaryAudience = $audience;
                continue;
            }
            if ($audience['relation_role'] === 'SECONDARY') {
                $secondaryAudiences[] = $audience;
            }
        }

        $activationExamples = Db::json($row['activation_examples']);

        $campaign = [
            'externalKey' => $row['external_key'],
            'campaignFamilyExternalKey' => $row['campaign_family_external_key'],
            'supersedesCampaignExternalKey' => $row['supersedes_external_key'] ?? '',
            'title' => $row['title'],
            'accent' => $row['accent'],
            'campaignType' => self::ref($row['type_code'], $row['type_label']),
            'parentCampaignExternalKey' => $row['parent_external_key'] ?? '',
            'pillar' => self::ref($row['pillar_code'], $row['pillar_label']),
            'seasonalityType' => self::ref($row['seasonality_code'], $row['seasonality_label']),
            'seasonalityMonths' => Db::json($row['seasonality_months']),
            'seasonalityNote' => $row['seasonality_note'],
            'status' => self::ref($row['status_code'], $row['status_label']),
            'version' => $row['version_label'],
            'responsible' => $row['responsible'],
            'programPrimaryCode' => $programs['primary'],
            'programSecondaryCodes' => $programs['secondary'],
            'objectivePrimaryCode' => $objectives['primary'],
            'objectiveSecondaryCodes' => $objectives['secondary'],
            'marketingObjective' => $row['marketing_objective'],
            'directResult' => $row['direct_result'],
            'strategicContribution' => Db::json($row['strategic_contribution']),
            'primaryAudienceSegment' => self::ref(
                $primaryAudience['code'] ?? '',
                $primaryAudience['label'] ?? '',
            ),
            'primaryAudienceDescription' => $row['primary_audience_description'],
            'secondaryAudienceSegments' => array_map(
                static fn (array $a): array => self::ref((string) $a['code'], (string) $a['label']),
                $secondaryAudiences,
            ),
            'centralIdea' => $row['central_idea'],
            'promise' => $row['promise'],
            'mainMessage' => $row['main_message'],
            'secondaryMessages' => Db::json($row['secondary_messages']),
            'tone' => $row['tone'],
            'insight' => $row['insight'],
            'valueProposition' => $row['value_proposition'],
            'products' => Db::json($row['products']),
            'productsIntro' => $row['products_intro'],
            'productCondition' => $row['product_condition'],
            'channels' => Db::json($row['channels']),
            'ctas' => array_map(
                static fn (array $c): array => self::ref((string) $c['code'], (string) $c['label']),
                $ctas,
            ),
            'prPartnerships' => $row['pr_partnerships'],
            'storytellingDirections' => Db::json($row['storytelling_directions']),
            'fixedElements' => Db::json($row['fixed_elements']),
            'adaptableElements' => Db::json($row['adaptable_elements']),
            'adaptationLimits' => Db::json($row['adaptation_limits']),
            'frameworkDeliverables' => Db::json($row['framework_deliverables']),
            'deliverableIntro' => $row['deliverable_intro'],
            'mockups' => $mockupData['mockups'],
            'posts' => Db::json($row['posts']),
            'headlines' => Db::json($row['headlines']),
            'videoConcepts' => Db::json($row['video_concepts']),
            'applicationExamples' => Db::json($row['application_examples']),
            'kpiDefinitions' => Db::json($row['kpi_definitions']),
            'activationExamples' => [
                'directions' => $activationExamples['directions'] ?? [],
                'simulatedRows' => $activationExamples['simulatedRows'] ?? [],
            ],
            'noVisualsNote' => $row['no_visuals_note'],
            'sourceFile' => $row['source_file'],
            // Source timestamps are preserved verbatim when the campaign came
            // from an import, so a round trip reproduces the original file. One
            // created in the app has none and falls back to its row timestamps.
            'createdAt' => ($row['source_created_at_raw'] ?? '') !== ''
                ? $row['source_created_at_raw']
                : self::isoFromMysql($row['created_at'] ?? null),
            'updatedAt' => ($row['source_updated_at_raw'] ?? '') !== ''
                ? $row['source_updated_at_raw']
                : self::isoFromMysql($row['updated_at'] ?? null),
        ];

        return [
            'campaign' => $campaign,
            'missing' => $mockupData['missing'],
            'assetCount' => $mockupData['assetCount'],
        ];
    }

    /**
     * @return array{package:array<string,mixed>,validationErrors:list<string>,missingAssets:list<string>,assetCount:int,campaignKeys:list<string>}|null
     */
    public static function build(string $externalKey, string $visuals = 'embed'): ?array
    {
        $keys = self::lineageKeys($externalKey);
        if ($keys === []) {
            return null;
        }

        $rows = [];
        foreach ($keys as $key) {
            $row = Db::one(self::CAMPAIGN_SELECT, [$key]);
            if ($row !== null) {
                $rows[] = $row;
            }
        }
        if ($rows === []) {
            return null;
        }

        // Every campaign in the package must belong to one strategy version,
        // since the package carries exactly one. Lineage crossing versions is
        // reported rather than silently half-exported.
        $strategyVersionId = (string) $rows[count($rows) - 1]['strategy_version_id'];
        $crossVersion = array_values(array_filter(
            $rows,
            static fn (array $row): bool => (string) $row['strategy_version_id'] !== $strategyVersionId,
        ));

        $strategicData = self::loadStrategicData($strategyVersionId);
        $catalogs = self::loadCatalogs();

        $built = [];
        foreach ($rows as $row) {
            $built[] = self::buildCampaign($row, $visuals);
        }

        $today = gmdate('Y-m-d');
        $package = [
            'packageType' => 'OMD_CAMPAIGNS_PACKAGE',
            'schemaVersion' => '1.0',
            'metadata' => [
                'packageId' => "export-{$externalKey}-{$today}",
                'generatedAt' => gmdate('Y-m-d\TH:i:s\Z'),
                'purpose' => 'AD_HOC',
                'source' => 'omd-vj-backend-php / campaign export',
                // A const in the contract, en dash included — not wording we get
                // to choose. The importer compares it exactly.
                'application' => 'OMD Valea Jiului – Sistem digital de marketing',
                'notes' => count($built) > 1
                    ? sprintf('Export al campaniei %s, cu %d campanii din linia sa.', $externalKey, count($built) - 1)
                    : sprintf('Export al campaniei %s.', $externalKey),
            ],
            'strategicData' => $strategicData,
            'catalogs' => $catalogs,
            'campaigns' => array_map(static fn (array $entry): array => $entry['campaign'], $built),
        ];

        // The guarantee: the same validator the importer runs, on the way out.
        $validationErrors = [];
        try {
            $validationErrors = Contract::validate($package)['errors'];
        } catch (Throwable $error) {
            $validationErrors = [$error->getMessage()];
        }

        foreach ($crossVersion as $row) {
            $validationErrors[] = sprintf(
                'campaigns[%s] apartine altei versiuni strategice si nu poate fi inclus.',
                $row['external_key'],
            );
        }

        $missing = [];
        $assetCount = 0;
        foreach ($built as $entry) {
            $missing = array_merge($missing, $entry['missing']);
            $assetCount += $entry['assetCount'];
        }

        return [
            'package' => $package,
            'validationErrors' => array_values($validationErrors),
            'missingAssets' => array_values($missing),
            'assetCount' => $assetCount,
            'campaignKeys' => $keys,
        ];
    }
}
