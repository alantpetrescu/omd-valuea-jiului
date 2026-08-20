<?php

/**
 * Full campaign DTO — port of `campaigns/campaign-detail.ts`.
 *
 * Rebuilds the canonical shape the prototype renders, out of roughly ten
 * relational tables. The UI never sees the relational structure and never sees
 * an internal UUID: `external_key` is the identity throughout.
 *
 * One difference from the Node original that had to be handled deliberately:
 * mysql2 parses JSON columns into objects before the DTO is built, while PDO
 * hands back the raw string. Every JSON column therefore goes through
 * `Db::json()`, and the few that are objects rather than arrays are rebuilt as
 * objects on the way out — otherwise `activationExamples` would serialise as
 * `[]` instead of `{}` and the client's `?.directions` would break.
 */

declare(strict_types=1);

namespace Omd\Campaigns;

use Omd\Assets\Storage;
use Omd\Database\Db;

final class CampaignDetail
{
    private const DETAIL_SELECT = <<<'SQL'
        SELECT
          c.id, c.external_key, c.campaign_family_external_key,
          parent.external_key      AS parent_external_key,
          prev.external_key        AS supersedes_external_key,
          c.title, c.accent,
          ct.label AS type, ct.code AS type_code,
          stt.label AS status, stt.code AS status_code,
          p.label AS pillar, p.display_label AS pillar_short, p.code AS pillar_code,
          sz.label AS seasonality_label, sz.code AS seasonality_code,
          c.seasonality_months, c.seasonality_note, c.version_label, c.responsible,
          c.marketing_objective, c.direct_result, c.strategic_contribution,
          c.primary_audience_description, c.central_idea, c.promise, c.main_message,
          c.secondary_messages, c.tone, c.insight, c.value_proposition,
          c.products, c.products_intro, c.product_condition, c.channels, c.pr_partnerships,
          c.storytelling_directions, c.fixed_elements, c.adaptable_elements, c.adaptation_limits,
          c.framework_deliverables, c.deliverable_intro, c.posts, c.headlines, c.video_concepts,
          c.application_examples, c.kpi_definitions, c.activation_examples,
          c.no_visuals_note, c.source_file, c.version_number,
          sv.external_key AS strategy_version, sv.label AS strategy_version_label
        FROM campaigns c
        JOIN campaign_types    ct  ON ct.id  = c.campaign_type_id
        JOIN campaign_statuses stt ON stt.id = c.status_id
        JOIN strategic_pillars p   ON p.id   = c.pillar_id
        JOIN seasonality_types sz  ON sz.id  = c.seasonality_type_id
        JOIN strategy_versions sv  ON sv.id  = c.strategy_version_id
        LEFT JOIN campaigns parent ON parent.id = c.parent_campaign_id
        LEFT JOIN campaigns prev   ON prev.id   = c.supersedes_campaign_id
        WHERE c.external_key = ? AND c.deleted_at IS NULL
        SQL;

    /**
     * Both labels (for display) and codes (for editing).
     *
     * The editor must bind to codes: the code is the identity, the label is
     * presentation and an Admin may rename it at any time.
     *
     * @return array{primary:?string,secondary:list<string>,primaryCode:?string,secondaryCodes:list<string>}
     */
    private static function related(
        string $table,
        string $joinTable,
        string $column,
        string $campaignId,
    ): array {
        // Table and column names come from this file's own call sites, never
        // from input.
        $rows = Db::rows(
            sprintf(
                'SELECT s.label, s.code, r.relation_role
                   FROM %s r JOIN %s s ON s.id = r.%s
                  WHERE r.campaign_id = ?
                  ORDER BY r.relation_role DESC, r.sort_order',
                $table,
                $joinTable,
                $column,
            ),
            [$campaignId],
        );

        $primary = null;
        $primaryCode = null;
        $secondary = [];
        $secondaryCodes = [];

        foreach ($rows as $row) {
            if ($row['relation_role'] === 'PRIMARY' && $primary === null) {
                $primary = (string) $row['label'];
                $primaryCode = (string) $row['code'];
                continue;
            }
            if ($row['relation_role'] === 'SECONDARY') {
                $secondary[] = (string) $row['label'];
                $secondaryCodes[] = (string) $row['code'];
            }
        }

        return [
            'primary' => $primary,
            'secondary' => $secondary,
            'primaryCode' => $primaryCode,
            'secondaryCodes' => $secondaryCodes,
        ];
    }

    /** @return array<string,mixed>|null */
    public static function load(string $externalKey): ?array
    {
        $row = Db::one(self::DETAIL_SELECT, [$externalKey]);
        if ($row === null) {
            return null;
        }

        $id = (string) $row['id'];

        $programs = self::related('campaign_programs', 'strategic_programs', 'program_id', $id);
        $objectives = self::related('campaign_objectives', 'strategic_objectives', 'objective_id', $id);

        $audiences = Db::rows(
            'SELECT a.label, a.code, ca.relation_role
               FROM campaign_audiences ca JOIN audience_segments a ON a.id = ca.audience_segment_id
              WHERE ca.campaign_id = ? ORDER BY ca.relation_role DESC, ca.sort_order',
            [$id],
        );

        $ctas = Db::rows(
            'SELECT t.label, t.code FROM campaign_ctas cc JOIN cta_types t ON t.id = cc.cta_type_id
              WHERE cc.campaign_id = ? ORDER BY cc.sort_order',
            [$id],
        );

        $templates = Db::rows(
            'SELECT id, external_key, name, formats_text, structure_text, is_generic, canva_url
               FROM campaign_templates
              WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY sort_order',
            [$id],
        );

        $assets = Db::rows(
            'SELECT cta.campaign_template_id AS template_id, cta.external_key, cta.format_text,
                    cta.label, a.storage_path
               FROM campaign_template_assets cta
               JOIN assets a ON a.id = cta.asset_id
               JOIN campaign_templates t ON t.id = cta.campaign_template_id
              WHERE t.campaign_id = ? AND cta.deleted_at IS NULL
              ORDER BY cta.sort_order',
            [$id],
        );

        $primaryAudience = null;
        $primaryAudienceCode = null;
        $secondaryAudiences = [];
        $secondaryAudienceCodes = [];
        foreach ($audiences as $audience) {
            if ($audience['relation_role'] === 'PRIMARY' && $primaryAudience === null) {
                $primaryAudience = (string) $audience['label'];
                $primaryAudienceCode = (string) $audience['code'];
                continue;
            }
            if ($audience['relation_role'] === 'SECONDARY') {
                $secondaryAudiences[] = (string) $audience['label'];
                $secondaryAudienceCodes[] = (string) $audience['code'];
            }
        }

        $mockups = [];
        foreach ($templates as $template) {
            $templateAssets = [];
            foreach ($assets as $asset) {
                if ((string) $asset['template_id'] !== (string) $template['id']) {
                    continue;
                }
                $templateAssets[] = [
                    'id' => $asset['external_key'],
                    'format' => $asset['format_text'],
                    'label' => $asset['label'],
                    // A public URL, never the opaque storage key.
                    'src' => Storage::publicUrl((string) $asset['storage_path']),
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

        return [
            'id' => $row['external_key'],
            'campaignFamilyExternalKey' => $row['campaign_family_external_key'],
            'parentCampaignId' => $row['parent_external_key'],
            'supersedesCampaignExternalKey' => $row['supersedes_external_key'],
            'title' => $row['title'],
            'accent' => $row['accent'],
            'type' => $row['type'],
            'typeCode' => $row['type_code'],
            'status' => $row['status'],
            'statusCode' => $row['status_code'],
            'pillar' => $row['pillar'],
            'pillarShort' => $row['pillar_short'],
            'pillarCode' => $row['pillar_code'],
            'seasonalityLabel' => $row['seasonality_label'],
            'seasonalityTypeCode' => $row['seasonality_code'],
            'seasonalityMonths' => Db::json($row['seasonality_months']),
            'seasonalityNote' => $row['seasonality_note'],
            'version' => $row['version_label'],
            'responsible' => $row['responsible'],
            'marketingObjective' => $row['marketing_objective'],
            'directResult' => $row['direct_result'],
            'strategicContribution' => Db::json($row['strategic_contribution']),
            'programPrimary' => $programs['primary'],
            'programSecondary' => $programs['secondary'],
            'programPrimaryCode' => $programs['primaryCode'],
            'programSecondaryCodes' => $programs['secondaryCodes'],
            'objectivePrimary' => $objectives['primary'],
            'objectiveSecondary' => $objectives['secondary'],
            'objectivePrimaryCode' => $objectives['primaryCode'],
            'objectiveSecondaryCodes' => $objectives['secondaryCodes'],
            'primaryAudienceSegment' => $primaryAudience,
            'primaryAudienceDescription' => $row['primary_audience_description'],
            'secondaryAudienceSegments' => $secondaryAudiences,
            'primaryAudienceCode' => $primaryAudienceCode,
            'secondaryAudienceCodes' => $secondaryAudienceCodes,
            'centralIdea' => $row['central_idea'],
            'promise' => $row['promise'],
            'mainMessage' => $row['main_message'],
            'secondaryMessages' => Db::json($row['secondary_messages']),
            'tone' => $row['tone'],
            'insight' => $row['insight'],
            'valueProposition' => $row['value_proposition'],
            'ctas' => array_map(static fn (array $c): string => (string) $c['label'], $ctas),
            'ctaCodes' => array_map(static fn (array $c): string => (string) $c['code'], $ctas),
            'products' => Db::json($row['products']),
            'productsIntro' => $row['products_intro'],
            'productCondition' => $row['product_condition'],
            'channels' => Db::json($row['channels']),
            'prPartnerships' => $row['pr_partnerships'],
            'storytellingDirections' => Db::json($row['storytelling_directions']),
            'fixedElements' => Db::json($row['fixed_elements']),
            'adaptableElements' => Db::json($row['adaptable_elements']),
            'adaptationLimits' => Db::json($row['adaptation_limits']),
            'applicationExamples' => Db::json($row['application_examples']),
            'frameworkDeliverables' => Db::json($row['framework_deliverables']),
            'deliverableIntro' => $row['deliverable_intro'],
            'posts' => Db::json($row['posts']),
            'headlines' => Db::json($row['headlines']),
            'videoConcepts' => Db::json($row['video_concepts']),
            'kpiDefinitions' => Db::json($row['kpi_definitions']),
            // An object, not a list: `{ directions, simulatedRows }`. Forced to
            // an object so json_encode never emits `[]` for an empty one.
            'activationExamples' => (object) Db::json($row['activation_examples']),
            'noVisualsNote' => $row['no_visuals_note'],
            'sourceFile' => $row['source_file'],
            'strategyVersion' => $row['strategy_version'],
            'strategyVersionLabel' => $row['strategy_version_label'],
            'versionNumber' => (int) $row['version_number'],
            // `mockups` keeps the prototype's name so the detail view maps directly.
            'mockups' => $mockups,
        ];
    }

    /**
     * Activations created from this campaign, for section 7 of the detail view.
     *
     * @return list<array<string,mixed>>
     */
    public static function activations(string $externalKey): array
    {
        $rows = Db::rows(
            'SELECT a.external_key AS id, a.title, a.start_date AS startDate, a.end_date AS endDate,
                    st.label AS status,
                    EXISTS(SELECT 1 FROM annual_plan_activations apa WHERE apa.activation_id = a.id)
                      AS includeAnnualPlan,
                    EXISTS(SELECT 1 FROM material_performance_snapshots s WHERE s.activation_id = a.id)
                      AS hasResults
               FROM activations a
               JOIN campaigns c ON c.id = a.campaign_id
               JOIN campaign_statuses st ON st.id = a.status_id
              WHERE c.external_key = ? AND a.deleted_at IS NULL
              ORDER BY a.start_date DESC',
            [$externalKey],
        );

        foreach ($rows as &$row) {
            $row['includeAnnualPlan'] = (int) $row['includeAnnualPlan'];
            $row['hasResults'] = (int) $row['hasResults'];
        }

        return $rows;
    }
}
