<?php

/**
 * Campaign import — OMD_CAMPAIGNS_PACKAGE. Port of `campaigns/campaign-import.ts`.
 *
 * Notes that matter (DB spec section F1):
 *   - `mockups[]` in the contract become `campaign_templates` rows;
 *   - `mockups[].assets[].id` becomes BOTH `assets.external_key` and
 *     `campaign_template_assets.external_key`;
 *   - `src` is a base64 data URI: it is decoded to a file, never stored in MySQL;
 *   - creative content (posts, headlines, mockup copy, KPI definitions...) stays
 *     as JSON columns rather than being over-normalised;
 *   - `createdAt`/`updatedAt` from the contract are preserved raw, separate from
 *     the operational DB timestamps.
 *
 * Campaign self-references (parent, supersedes) are resolved in a second pass so
 * that packages may list a child before its parent.
 */

declare(strict_types=1);

namespace Omd\Campaigns;

use Omd\Assets\Storage;
use Omd\Catalogs\CatalogImport;
use Omd\Database\Db;
use Omd\Imports\ImportContext;
use Omd\Support\Ids;
use RuntimeException;
use Throwable;

final class CampaignImport
{
    /** Column list is explicit so a contract change surfaces as an SQL error. */
    private const CAMPAIGN_COLUMNS = [
        'title', 'accent', 'campaign_type_id', 'status_id', 'pillar_id', 'seasonality_type_id',
        'seasonality_months', 'seasonality_note', 'version_label', 'responsible',
        'marketing_objective', 'direct_result', 'strategic_contribution',
        'primary_audience_description', 'central_idea', 'promise', 'main_message',
        'secondary_messages', 'tone', 'insight', 'value_proposition',
        'products', 'products_intro', 'product_condition', 'channels', 'pr_partnerships',
        'storytelling_directions', 'fixed_elements', 'adaptable_elements', 'adaptation_limits',
        'framework_deliverables', 'deliverable_intro', 'posts', 'headlines', 'video_concepts',
        'application_examples', 'kpi_definitions', 'activation_examples',
        'no_visuals_note', 'source_file', 'source_created_at_raw', 'source_updated_at_raw',
    ];

    private const RELATION_TABLES = [
        'campaign_programs',
        'campaign_objectives',
        'campaign_audiences',
        'campaign_ctas',
    ];

    /**
     * Decodes every base64 asset in the package into the import temp directory.
     *
     * Runs before the transaction opens: decoding is CPU and IO bound, and
     * holding row locks through it would be paying for the slow part twice.
     *
     * @param list<array<string,mixed>> $campaigns
     * @return array<string,array<string,mixed>> staged file, keyed by asset id
     */
    public static function stageAssets(array $campaigns): array
    {
        $staged = [];

        foreach ($campaigns as $campaign) {
            foreach ($campaign['mockups'] ?? [] as $mockup) {
                foreach ($mockup['assets'] ?? [] as $asset) {
                    $src = (string) ($asset['src'] ?? '');
                    if ($src === '') {
                        continue;
                    }
                    try {
                        $staged[(string) $asset['id']] = Storage::stageDataUri($src);
                    } catch (Throwable $error) {
                        throw new RuntimeException(sprintf(
                            'Asset %s din campania %s: %s',
                            (string) ($asset['id'] ?? '—'),
                            (string) ($campaign['externalKey'] ?? '—'),
                            $error->getMessage(),
                        ));
                    }
                }
            }
        }

        return $staged;
    }

    /**
     * Imports every campaign in the package.
     *
     * @param list<array<string,mixed>>              $campaigns
     * @param array<string,array<string,string>>     $catalogs
     * @param array<string,mixed>                    $strategy
     * @param array<string,array<string,mixed>>      $staged
     * @return list<string> storage keys written, for cleanup if the transaction fails
     */
    public static function import(
        array $campaigns,
        array $catalogs,
        array $strategy,
        array $staged,
        ImportContext $ctx,
    ): array {
        $published = [];
        $idByExternalKey = [];

        // Pass 1: the campaigns themselves, self-references left NULL.
        foreach ($campaigns as $campaign) {
            $externalKey = (string) $campaign['externalKey'];
            $values = self::campaignValues($campaign, $catalogs, $strategy);

            $existing = Db::one('SELECT id FROM campaigns WHERE external_key = ?', [$externalKey]);

            if ($existing !== null) {
                $assignments = implode(', ', array_map(
                    static fn (string $column): string => "{$column} = ?",
                    self::CAMPAIGN_COLUMNS,
                ));
                Db::execute(
                    "UPDATE campaigns SET {$assignments}, version_number = version_number + 1, updated_by = ?
                      WHERE id = ?",
                    [...$values, $ctx->userId, $existing['id']],
                );
                $idByExternalKey[$externalKey] = (string) $existing['id'];
                $ctx->recordItem('campaigns', $externalKey, (string) $existing['id'], ImportContext::UPDATE);
            } else {
                $id = Ids::newId();
                Db::execute(
                    sprintf(
                        'INSERT INTO campaigns
                           (id, external_key, campaign_family_external_key, strategy_version_id, %s, created_by)
                         VALUES (?, ?, ?, ?, %s, ?)',
                        implode(', ', self::CAMPAIGN_COLUMNS),
                        implode(', ', array_fill(0, count(self::CAMPAIGN_COLUMNS), '?')),
                    ),
                    [
                        $id,
                        $externalKey,
                        (string) $campaign['campaignFamilyExternalKey'],
                        $strategy['strategyVersionId'],
                        ...$values,
                        $ctx->userId,
                    ],
                );
                $idByExternalKey[$externalKey] = $id;
                $ctx->recordItem('campaigns', $externalKey, $id, ImportContext::CREATE);
            }
        }

        // Pass 2: parent and lineage links, now that every campaign row exists.
        foreach ($campaigns as $campaign) {
            $externalKey = (string) $campaign['externalKey'];
            $id = $idByExternalKey[$externalKey];

            $parentId = self::resolveSibling(
                $campaign['parentCampaignExternalKey'] ?? null,
                'parentCampaignExternalKey',
                $externalKey,
                $idByExternalKey,
            );
            $supersedesId = self::resolveSibling(
                $campaign['supersedesCampaignExternalKey'] ?? null,
                'supersedesCampaignExternalKey',
                $externalKey,
                $idByExternalKey,
            );

            if ($supersedesId !== null) {
                $predecessor = Db::one(
                    'SELECT campaign_family_external_key FROM campaigns WHERE id = ?',
                    [$supersedesId],
                );
                $family = $predecessor['campaign_family_external_key'] ?? null;
                if ($family !== (string) $campaign['campaignFamilyExternalKey']) {
                    throw new RuntimeException(sprintf(
                        'campaigns[%s].supersedesCampaignExternalKey: predecesorul trebuie să aparțină '
                        . 'aceleiași familii de campanie.',
                        $externalKey,
                    ));
                }
            }

            if ($parentId !== null || $supersedesId !== null) {
                Db::execute(
                    'UPDATE campaigns SET parent_campaign_id = ?, supersedes_campaign_id = ? WHERE id = ?',
                    [$parentId, $supersedesId, $id],
                );
            }

            self::replaceRelations($id, $campaign, $catalogs, $strategy, $ctx);
            self::importTemplates($id, $campaign, $staged, $published, $ctx);
        }

        return $published;
    }

    /**
     * @param array<string,string> $idByExternalKey
     */
    private static function resolveSibling(
        mixed $externalKey,
        string $field,
        string $owner,
        array $idByExternalKey,
    ): ?string {
        if (!is_string($externalKey) || $externalKey === '') {
            return null;
        }

        if (isset($idByExternalKey[$externalKey])) {
            return $idByExternalKey[$externalKey];
        }

        $row = Db::one('SELECT id FROM campaigns WHERE external_key = ?', [$externalKey]);
        if ($row === null) {
            throw new RuntimeException(
                "campaigns[{$owner}].{$field}: campanie inexistentă ({$externalKey})"
            );
        }
        return (string) $row['id'];
    }

    /**
     * @param array<string,mixed>                $campaign
     * @param array<string,array<string,string>> $catalogs
     * @param array<string,mixed>                $strategy
     * @return list<mixed>
     */
    private static function campaignValues(array $campaign, array $catalogs, array $strategy): array
    {
        $where = 'campaigns[' . (string) $campaign['externalKey'] . ']';

        $pillarCode = (string) ($campaign['pillar']['code'] ?? '');
        $pillarId = $strategy['pillars'][$pillarCode] ?? null;
        if ($pillarId === null) {
            throw new RuntimeException(
                "{$where}.pillar: pilon inexistent în versiunea strategică: {$pillarCode}"
            );
        }

        $text = static fn (mixed $value): string => is_string($value) ? $value : '';
        $json = static fn (mixed $value): string
            => json_encode($value ?? [], JSON_UNESCAPED_UNICODE) ?: '[]';

        return [
            $campaign['title'],
            $campaign['accent'],
            CatalogImport::resolveCode(
                $catalogs,
                'campaign_types',
                $campaign['campaignType']['code'] ?? null,
                "{$where}.campaignType",
            ),
            CatalogImport::resolveCode(
                $catalogs,
                'campaign_statuses',
                $campaign['status']['code'] ?? null,
                "{$where}.status",
            ),
            $pillarId,
            CatalogImport::resolveCode(
                $catalogs,
                'seasonality_types',
                $campaign['seasonalityType']['code'] ?? null,
                "{$where}.seasonalityType",
            ),
            $json($campaign['seasonalityMonths'] ?? null),
            $text($campaign['seasonalityNote'] ?? null),
            $text($campaign['version'] ?? null),
            $text($campaign['responsible'] ?? null),
            $text($campaign['marketingObjective'] ?? null),
            $text($campaign['directResult'] ?? null),
            $json($campaign['strategicContribution'] ?? null),
            $text($campaign['primaryAudienceDescription'] ?? null),
            $text($campaign['centralIdea'] ?? null),
            $text($campaign['promise'] ?? null),
            $text($campaign['mainMessage'] ?? null),
            $json($campaign['secondaryMessages'] ?? null),
            $text($campaign['tone'] ?? null),
            $text($campaign['insight'] ?? null),
            $text($campaign['valueProposition'] ?? null),
            $json($campaign['products'] ?? null),
            $text($campaign['productsIntro'] ?? null),
            $text($campaign['productCondition'] ?? null),
            $json($campaign['channels'] ?? null),
            $text($campaign['prPartnerships'] ?? null),
            $json($campaign['storytellingDirections'] ?? null),
            $json($campaign['fixedElements'] ?? null),
            $json($campaign['adaptableElements'] ?? null),
            $json($campaign['adaptationLimits'] ?? null),
            $json($campaign['frameworkDeliverables'] ?? null),
            $text($campaign['deliverableIntro'] ?? null),
            $json($campaign['posts'] ?? null),
            $json($campaign['headlines'] ?? null),
            $json($campaign['videoConcepts'] ?? null),
            $json($campaign['applicationExamples'] ?? null),
            $json($campaign['kpiDefinitions'] ?? null),
            // `{ directions, simulatedRows }` — an object, not a list. The cast
            // is what stops an empty one from being written as `[]`, which is
            // what PHP would otherwise emit and which the detail view does not
            // accept.
            json_encode((object) ($campaign['activationExamples'] ?? []), JSON_UNESCAPED_UNICODE) ?: '{}',
            $text($campaign['noVisualsNote'] ?? null),
            $text($campaign['sourceFile'] ?? null),
            $text($campaign['createdAt'] ?? null),
            $text($campaign['updatedAt'] ?? null),
        ];
    }

    /**
     * @param array<string,mixed>                $campaign
     * @param array<string,array<string,string>> $catalogs
     * @param array<string,mixed>                $strategy
     */
    private static function replaceRelations(
        string $campaignId,
        array $campaign,
        array $catalogs,
        array $strategy,
        ImportContext $ctx,
    ): void {
        $where = 'campaigns[' . (string) $campaign['externalKey'] . ']';

        foreach (self::RELATION_TABLES as $table) {
            Db::execute("DELETE FROM {$table} WHERE campaign_id = ?", [$campaignId]);
        }

        $linkStrategic = static function (
            string $table,
            string $column,
            array $map,
            string $code,
            string $role,
            int $order,
        ) use ($campaignId, $where, $ctx): void {
            $id = $map[$code] ?? null;
            if ($id === null) {
                throw new RuntimeException("{$where}: cod strategic inexistent în versiunea curentă: {$code}");
            }
            Db::execute(
                "INSERT INTO {$table} (campaign_id, {$column}, relation_role, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?)",
                [$campaignId, $id, $role, $order, $ctx->userId],
            );
        };

        if (!empty($campaign['programPrimaryCode'])) {
            $linkStrategic(
                'campaign_programs',
                'program_id',
                $strategy['programs'],
                (string) $campaign['programPrimaryCode'],
                'PRIMARY',
                0,
            );
        }
        foreach (array_values($campaign['programSecondaryCodes'] ?? []) as $index => $code) {
            $linkStrategic(
                'campaign_programs',
                'program_id',
                $strategy['programs'],
                (string) $code,
                'SECONDARY',
                $index + 1,
            );
        }
        if (!empty($campaign['objectivePrimaryCode'])) {
            $linkStrategic(
                'campaign_objectives',
                'objective_id',
                $strategy['objectives'],
                (string) $campaign['objectivePrimaryCode'],
                'PRIMARY',
                0,
            );
        }
        foreach (array_values($campaign['objectiveSecondaryCodes'] ?? []) as $index => $code) {
            $linkStrategic(
                'campaign_objectives',
                'objective_id',
                $strategy['objectives'],
                (string) $code,
                'SECONDARY',
                $index + 1,
            );
        }

        // A campaign-level audience without a catalog code is not valid: only
        // Activations may carry a free-text custom audience (spec section 21).
        $linkAudience = static function (mixed $code, string $role, int $order) use (
            $campaignId,
            $catalogs,
            $where,
            $ctx,
        ): void {
            if (!is_string($code) || $code === '') {
                return;
            }
            $id = CatalogImport::resolveCode($catalogs, 'audience_segments', $code, "{$where}.audience");
            Db::execute(
                'INSERT INTO campaign_audiences
                   (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?)',
                [$campaignId, $id, $role, $order, $ctx->userId],
            );
        };

        $linkAudience($campaign['primaryAudienceSegment']['code'] ?? null, 'PRIMARY', 0);
        foreach (array_values($campaign['secondaryAudienceSegments'] ?? []) as $index => $segment) {
            $linkAudience($segment['code'] ?? null, 'SECONDARY', $index + 1);
        }

        foreach (array_values($campaign['ctas'] ?? []) as $index => $cta) {
            $code = $cta['code'] ?? null;
            if (!is_string($code) || $code === '') {
                continue;
            }
            $id = CatalogImport::resolveCode($catalogs, 'cta_types', $code, "{$where}.ctas[{$index}]");
            Db::execute(
                'INSERT INTO campaign_ctas (campaign_id, cta_type_id, sort_order, created_by) VALUES (?, ?, ?, ?)',
                [$campaignId, $id, $index, $ctx->userId],
            );
        }
    }

    /**
     * @param array<string,mixed>               $campaign
     * @param array<string,array<string,mixed>> $staged
     * @param list<string>                      $published
     */
    private static function importTemplates(
        string $campaignId,
        array $campaign,
        array $staged,
        array &$published,
        ImportContext $ctx,
    ): void {
        foreach (array_values($campaign['mockups'] ?? []) as $index => $mockup) {
            $mockupKey = (string) $mockup['id'];
            $existingTemplate = Db::one(
                'SELECT id FROM campaign_templates WHERE external_key = ?',
                [$mockupKey],
            );

            if ($existingTemplate !== null) {
                $templateId = (string) $existingTemplate['id'];
                Db::execute(
                    'UPDATE campaign_templates
                        SET campaign_id = ?, name = ?, formats_text = ?, structure_text = ?,
                            is_generic = ?, canva_url = ?, sort_order = ?, updated_by = ?
                      WHERE id = ?',
                    [
                        $campaignId,
                        $mockup['name'] ?? '',
                        $mockup['formats'] ?? '',
                        $mockup['structure'] ?? '',
                        !empty($mockup['generic']) ? 1 : 0,
                        $mockup['canvaUrl'] ?? '',
                        $index,
                        $ctx->userId,
                        $templateId,
                    ],
                );
                $ctx->recordItem('campaign_templates', $mockupKey, $templateId, ImportContext::UPDATE);
            } else {
                $templateId = Ids::newId();
                Db::execute(
                    'INSERT INTO campaign_templates
                       (id, external_key, campaign_id, name, formats_text, structure_text,
                        is_generic, canva_url, sort_order, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [
                        $templateId,
                        $mockupKey,
                        $campaignId,
                        $mockup['name'] ?? '',
                        $mockup['formats'] ?? '',
                        $mockup['structure'] ?? '',
                        !empty($mockup['generic']) ? 1 : 0,
                        $mockup['canvaUrl'] ?? '',
                        $index,
                        $ctx->userId,
                    ],
                );
                $ctx->recordItem('campaign_templates', $mockupKey, $templateId, ImportContext::CREATE);
            }

            foreach (array_values($mockup['assets'] ?? []) as $assetIndex => $asset) {
                $assetKey = (string) $asset['id'];
                $file = $staged[$assetKey] ?? null;
                if ($file === null) {
                    continue;
                }

                $existingAsset = Db::one(
                    'SELECT id, storage_path FROM assets WHERE external_key = ?',
                    [$assetKey],
                );

                if ($existingAsset !== null) {
                    $assetId = (string) $existingAsset['id'];
                    $existingKey = (string) ($existingAsset['storage_path'] ?? '');

                    /*
                     * The row exists — but the file it points at may not.
                     *
                     * An import that ran with the wrong `UPLOAD_DIR` writes every
                     * row and loses every byte. This branch used to record
                     * UNCHANGED and move on, so the picture could never come
                     * back: the database promised a path, the disk had nothing,
                     * and no later import would look. Re-publishing when the file
                     * is missing is what makes a repeated import the repair it is
                     * supposed to be.
                     *
                     * Published under the *existing* storage key, not the freshly
                     * staged one: `buildStorageKey()` invents a new name each run,
                     * so writing there would leave a file nobody references and
                     * the row still dangling.
                     */
                    if ($existingKey !== '' && !Storage::exists($existingKey)) {
                        Storage::publish($file['temporaryPath'], $existingKey);
                        $published[] = $existingKey;
                        $ctx->recordItem('assets', $assetKey, $assetId, ImportContext::UPDATE);
                    } else {
                        $ctx->recordItem('assets', $assetKey, $assetId, ImportContext::UNCHANGED);
                    }
                } else {
                    $assetId = Ids::newId();
                    Db::execute(
                        'INSERT INTO assets
                           (id, external_key, filename, original_filename, mime_type, file_size,
                            storage_path, checksum_sha256, created_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $assetId,
                            $assetKey,
                            $file['filename'],
                            $assetKey . self::extension($file['filename']),
                            $file['mimeType'],
                            $file['fileSize'],
                            $file['storageKey'],
                            $file['checksumSha256'],
                            $ctx->userId,
                        ],
                    );
                    // Published inside the transaction; `$published` drives the
                    // cleanup if it rolls back.
                    Storage::publish($file['temporaryPath'], $file['storageKey']);
                    $published[] = $file['storageKey'];
                    $ctx->recordItem('assets', $assetKey, $assetId, ImportContext::CREATE);
                }

                $existingLink = Db::one(
                    'SELECT id FROM campaign_template_assets WHERE external_key = ?',
                    [$assetKey],
                );

                if ($existingLink !== null) {
                    Db::execute(
                        'UPDATE campaign_template_assets
                            SET campaign_template_id = ?, asset_id = ?, format_text = ?, label = ?,
                                sort_order = ?, updated_by = ?
                          WHERE id = ?',
                        [
                            $templateId,
                            $assetId,
                            $asset['format'] ?? '',
                            $asset['label'] ?? '',
                            $assetIndex,
                            $ctx->userId,
                            $existingLink['id'],
                        ],
                    );
                    $ctx->recordItem(
                        'campaign_template_assets',
                        $assetKey,
                        (string) $existingLink['id'],
                        ImportContext::UPDATE,
                    );
                } else {
                    $linkId = Ids::newId();
                    Db::execute(
                        'INSERT INTO campaign_template_assets
                           (id, external_key, campaign_template_id, asset_id, format_text, label,
                            sort_order, created_by)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                        [
                            $linkId,
                            $assetKey,
                            $templateId,
                            $assetId,
                            $asset['format'] ?? '',
                            $asset['label'] ?? '',
                            $assetIndex,
                            $ctx->userId,
                        ],
                    );
                    $ctx->recordItem('campaign_template_assets', $assetKey, $linkId, ImportContext::CREATE);
                }
            }
        }
    }

    /** The extension of a stored filename, empty when it somehow has none. */
    private static function extension(string $filename): string
    {
        $dot = strrpos($filename, '.');
        return $dot === false ? '' : substr($filename, $dot);
    }
}
