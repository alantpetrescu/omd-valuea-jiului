/**
 * Full campaign DTO.
 *
 * Rebuilds the canonical shape the v13.3 prototype renders, from ~10 relational
 * tables (spec section 17). The UI never sees the raw relational structure and
 * never sees an internal UUID — `external_key` is the identity throughout.
 *
 * Creative content lives in JSON columns and is returned as-is; mysql2 parses
 * JSON columns into objects, so no manual parsing is needed.
 */
import { queryOne, queryRows } from '../database/db';
import { assetStorage } from '../assets/storage';

interface CampaignRow {
  id: string;
  external_key: string;
  campaign_family_external_key: string;
  parent_external_key: string | null;
  supersedes_external_key: string | null;
  title: string;
  accent: string;
  type: string;
  type_code: string;
  status: string;
  status_code: string;
  pillar: string;
  pillar_short: string;
  pillar_code: string;
  seasonality_label: string;
  seasonality_code: string;
  seasonality_months: number[];
  seasonality_note: string;
  version_label: string;
  responsible: string;
  marketing_objective: string;
  direct_result: string;
  strategic_contribution: string[];
  primary_audience_description: string;
  central_idea: string;
  promise: string;
  main_message: string;
  secondary_messages: string[];
  tone: string;
  insight: string;
  value_proposition: string;
  products: string[];
  products_intro: string;
  product_condition: string;
  channels: string[];
  pr_partnerships: string;
  storytelling_directions: string[];
  fixed_elements: string[];
  adaptable_elements: string[];
  adaptation_limits: string[];
  framework_deliverables: unknown[];
  deliverable_intro: string;
  posts: unknown[];
  headlines: unknown[];
  video_concepts: unknown[];
  application_examples: unknown[];
  kpi_definitions: unknown[];
  activation_examples: { directions?: unknown[]; simulatedRows?: unknown[] };
  no_visuals_note: string;
  source_file: string;
  strategy_version: string;
  strategy_version_label: string;
  version_number: number;
}

const DETAIL_SELECT = `
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
`;

/**
 * Returns both labels (for display) and codes (for editing).
 *
 * The editor must bind to codes: the code is the identity, the label is only
 * presentation and an Admin may rename it at any time.
 */
async function relatedLabels(
  table: 'campaign_programs' | 'campaign_objectives',
  joinTable: 'strategic_programs' | 'strategic_objectives',
  column: 'program_id' | 'objective_id',
  campaignId: string,
): Promise<{
  primary: string | null;
  secondary: string[];
  primaryCode: string | null;
  secondaryCodes: string[];
}> {
  const rows = await queryRows<{ label: string; code: string; relation_role: string }>(
    `SELECT s.label, s.code, r.relation_role
       FROM ${table} r JOIN ${joinTable} s ON s.id = r.${column}
      WHERE r.campaign_id = ?
      ORDER BY r.relation_role DESC, r.sort_order`,
    [campaignId],
  );
  const secondary = rows.filter((row) => row.relation_role === 'SECONDARY');
  const primary = rows.find((row) => row.relation_role === 'PRIMARY');
  return {
    primary: primary?.label ?? null,
    secondary: secondary.map((row) => row.label),
    primaryCode: primary?.code ?? null,
    secondaryCodes: secondary.map((row) => row.code),
  };
}

export async function loadCampaignDetail(externalKey: string) {
  const row = await queryOne<CampaignRow>(DETAIL_SELECT, [externalKey]);
  if (!row) return null;

  const programs = await relatedLabels('campaign_programs', 'strategic_programs', 'program_id', row.id);
  const objectives = await relatedLabels(
    'campaign_objectives',
    'strategic_objectives',
    'objective_id',
    row.id,
  );

  const audiences = await queryRows<{ label: string; code: string; relation_role: string }>(
    `SELECT a.label, a.code, ca.relation_role
       FROM campaign_audiences ca JOIN audience_segments a ON a.id = ca.audience_segment_id
      WHERE ca.campaign_id = ? ORDER BY ca.relation_role DESC, ca.sort_order`,
    [row.id],
  );

  const ctas = await queryRows<{ label: string; code: string }>(
    `SELECT t.label, t.code FROM campaign_ctas cc JOIN cta_types t ON t.id = cc.cta_type_id
      WHERE cc.campaign_id = ? ORDER BY cc.sort_order`,
    [row.id],
  );

  const templates = await queryRows<{
    id: string;
    external_key: string;
    name: string;
    formats_text: string;
    structure_text: string;
    is_generic: number;
    canva_url: string;
  }>(
    `SELECT id, external_key, name, formats_text, structure_text, is_generic, canva_url
       FROM campaign_templates
      WHERE campaign_id = ? AND deleted_at IS NULL ORDER BY sort_order`,
    [row.id],
  );

  const assets = await queryRows<{
    template_id: string;
    external_key: string;
    format_text: string;
    label: string;
    storage_path: string;
  }>(
    `SELECT cta.campaign_template_id AS template_id, cta.external_key, cta.format_text, cta.label,
            a.storage_path
       FROM campaign_template_assets cta
       JOIN assets a ON a.id = cta.asset_id
       JOIN campaign_templates t ON t.id = cta.campaign_template_id
      WHERE t.campaign_id = ? AND cta.deleted_at IS NULL
      ORDER BY cta.sort_order`,
    [row.id],
  );

  return {
    id: row.external_key,
    campaignFamilyExternalKey: row.campaign_family_external_key,
    parentCampaignId: row.parent_external_key,
    supersedesCampaignExternalKey: row.supersedes_external_key,
    title: row.title,
    accent: row.accent,
    type: row.type,
    typeCode: row.type_code,
    status: row.status,
    statusCode: row.status_code,
    pillar: row.pillar,
    pillarShort: row.pillar_short,
    pillarCode: row.pillar_code,
    seasonalityLabel: row.seasonality_label,
    seasonalityTypeCode: row.seasonality_code,
    seasonalityMonths: row.seasonality_months,
    seasonalityNote: row.seasonality_note,
    version: row.version_label,
    responsible: row.responsible,
    marketingObjective: row.marketing_objective,
    directResult: row.direct_result,
    strategicContribution: row.strategic_contribution,
    programPrimary: programs.primary,
    programSecondary: programs.secondary,
    programPrimaryCode: programs.primaryCode,
    programSecondaryCodes: programs.secondaryCodes,
    objectivePrimary: objectives.primary,
    objectiveSecondary: objectives.secondary,
    objectivePrimaryCode: objectives.primaryCode,
    objectiveSecondaryCodes: objectives.secondaryCodes,
    primaryAudienceSegment: audiences.find((a) => a.relation_role === 'PRIMARY')?.label ?? null,
    primaryAudienceDescription: row.primary_audience_description,
    secondaryAudienceSegments: audiences
      .filter((a) => a.relation_role === 'SECONDARY')
      .map((a) => a.label),
    primaryAudienceCode: audiences.find((a) => a.relation_role === 'PRIMARY')?.code ?? null,
    secondaryAudienceCodes: audiences
      .filter((a) => a.relation_role === 'SECONDARY')
      .map((a) => a.code),
    centralIdea: row.central_idea,
    promise: row.promise,
    mainMessage: row.main_message,
    secondaryMessages: row.secondary_messages,
    tone: row.tone,
    insight: row.insight,
    valueProposition: row.value_proposition,
    ctas: ctas.map((c) => c.label),
    ctaCodes: ctas.map((c) => c.code),
    products: row.products,
    productsIntro: row.products_intro,
    productCondition: row.product_condition,
    channels: row.channels,
    prPartnerships: row.pr_partnerships,
    storytellingDirections: row.storytelling_directions,
    fixedElements: row.fixed_elements,
    adaptableElements: row.adaptable_elements,
    adaptationLimits: row.adaptation_limits,
    applicationExamples: row.application_examples,
    frameworkDeliverables: row.framework_deliverables,
    deliverableIntro: row.deliverable_intro,
    posts: row.posts,
    headlines: row.headlines,
    videoConcepts: row.video_concepts,
    kpiDefinitions: row.kpi_definitions,
    activationExamples: row.activation_examples,
    noVisualsNote: row.no_visuals_note,
    sourceFile: row.source_file,
    strategyVersion: row.strategy_version,
    strategyVersionLabel: row.strategy_version_label,
    versionNumber: row.version_number,
    // `mockups` keeps the prototype's name so the detail view maps directly.
    mockups: templates.map((template) => ({
      id: template.external_key,
      name: template.name,
      formats: template.formats_text,
      structure: template.structure_text,
      generic: template.is_generic === 1,
      canvaUrl: template.canva_url,
      assets: assets
        .filter((asset) => asset.template_id === template.id)
        .map((asset) => ({
          id: asset.external_key,
          format: asset.format_text,
          label: asset.label,
          // A public URL, not the opaque storage key (spec 23.1).
          src: assetStorage.publicUrl(asset.storage_path),
        })),
    })),
  };
}

/** Activations created from this campaign, for section 7 of the detail view. */
export async function loadCampaignActivations(externalKey: string) {
  return queryRows(
    `SELECT a.external_key AS id, a.title, a.start_date AS startDate, a.end_date AS endDate,
            st.label AS status,
            EXISTS(SELECT 1 FROM annual_plan_activations apa WHERE apa.activation_id = a.id)
              AS includeAnnualPlan,
            EXISTS(SELECT 1 FROM material_performance_snapshots s WHERE s.activation_id = a.id)
              AS hasResults
       FROM activations a
       JOIN campaigns c ON c.id = a.campaign_id
       JOIN campaign_statuses st ON st.id = a.status_id
      WHERE c.external_key = ? AND a.deleted_at IS NULL
      ORDER BY a.start_date DESC`,
    [externalKey],
  );
}
