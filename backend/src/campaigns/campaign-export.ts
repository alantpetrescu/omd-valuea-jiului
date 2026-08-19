/**
 * Campaign export — the inverse of the import pipeline.
 *
 * Produces a complete `OMD_CAMPAIGNS_PACKAGE` v1.0 for one campaign: the
 * metadata envelope, the strategy version it belongs to with that version's
 * pillars, programmes and objectives, all ten master catalogues, and the
 * campaign itself in contract shape.
 *
 * Why the whole package rather than one campaign object: the contract requires
 * it, and for a good reason. A campaign references its pillar, programmes,
 * objectives, audiences and CTAs by *code*, and those codes are only unique
 * within a strategy version (see strategic_programs' unique key). A file
 * carrying codes without the tables that define them cannot be imported
 * anywhere except back into the database it came from.
 *
 * The package also carries the campaign's *lineage* — its parent chain and any
 * campaign it supersedes. Those are referenced by external key, and the
 * importer rejects a key it cannot resolve ("campanie inexistentă"), so a
 * package holding only the requested campaign imports into the database it came
 * from and nowhere else. Found by actually importing an export into an empty
 * database, which is the only way this class of gap shows up.
 *
 * The result is validated against the frozen JSON Schema before it leaves the
 * process. That check is the point of the endpoint: an export nobody can
 * re-import is a backup that does not restore, and the only way to know is to
 * run the same validator the importer runs.
 */
import { queryOne, queryRows } from '../database/db';
import { assetStorage } from '../assets/storage';
import { validateAgainstContract } from '../imports/contract-registry';
import { MASTER_CATALOGS } from '../catalogs/system-master-registry';
import { logger } from '../shared/logger';

/** How template visuals travel. */
export type VisualMode = 'embed' | 'link';

interface CampaignRow {
  id: string;
  external_key: string;
  campaign_family_external_key: string;
  supersedes_external_key: string | null;
  parent_external_key: string | null;
  strategy_version_id: string;
  title: string;
  accent: string;
  type_code: string;
  type_label: string;
  status_code: string;
  status_label: string;
  pillar_code: string;
  pillar_label: string;
  seasonality_code: string;
  seasonality_label: string;
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
  activation_examples: { directions?: unknown[]; simulatedRows?: unknown[] } | null;
  no_visuals_note: string;
  source_file: string;
  source_created_at_raw: string;
  source_updated_at_raw: string;
  created_at: string;
  updated_at: string;
}

const CAMPAIGN_SELECT = `
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
`;

/** `{ code, label }` — the contract's catalogRef, which never takes a bare string. */
function ref(code: string | null, label: string | null) {
  return { code: code ?? '', label: label ?? '' };
}

/** The contract wants ISO-8601; mysql2 hands us 'YYYY-MM-DD HH:MM:SS.ffffff' (UTC). */
function isoFromMysql(value: string | null): string {
  if (!value) return '';
  return `${value.replace(' ', 'T')}Z`.replace(/(\.\d{3})\d+Z$/, '$1Z');
}

async function relationCodes(
  table: 'campaign_programs' | 'campaign_objectives',
  joinTable: 'strategic_programs' | 'strategic_objectives',
  column: 'program_id' | 'objective_id',
  campaignId: string,
): Promise<{ primary: string; secondary: string[] }> {
  const rows = await queryRows<{ code: string; relation_role: string }>(
    `SELECT s.code, r.relation_role
       FROM ${table} r JOIN ${joinTable} s ON s.id = r.${column}
      WHERE r.campaign_id = ? ORDER BY r.sort_order`,
    [campaignId],
  );
  return {
    primary: rows.find((row) => row.relation_role === 'PRIMARY')?.code ?? '',
    secondary: rows.filter((row) => row.relation_role === 'SECONDARY').map((row) => row.code),
  };
}

/** Templates + their assets, as the contract's `mockups`. */
async function loadMockups(campaignId: string, visuals: VisualMode) {
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
      WHERE campaign_id = ? AND deleted_at IS NULL
      ORDER BY sort_order, name`,
    [campaignId],
  );

  const assets = await queryRows<{
    template_id: string;
    external_key: string;
    format_text: string;
    label: string;
    storage_path: string;
    mime_type: string;
  }>(
    `SELECT cta.campaign_template_id AS template_id, cta.external_key,
            cta.format_text, cta.label, a.storage_path, a.mime_type
       FROM campaign_template_assets cta
       JOIN campaign_templates t ON t.id = cta.campaign_template_id
       JOIN assets a             ON a.id = cta.asset_id
      WHERE t.campaign_id = ? AND cta.deleted_at IS NULL AND a.deleted_at IS NULL
      ORDER BY cta.sort_order`,
    [campaignId],
  );

  // Re-encode each file as the data URI the importer expects. A missing file is
  // reported rather than silently exported as an empty src, because an asset
  // that imports as nothing is worse than an export that says it failed.
  const sources = new Map<string, string>();
  const missing: string[] = [];

  if (visuals === 'embed') {
    for (const asset of assets) {
      try {
        const bytes = await assetStorage.read(asset.storage_path);
        sources.set(asset.external_key, `data:${asset.mime_type};base64,${bytes.toString('base64')}`);
      } catch (error) {
        logger.warn(
          { err: error, storageKey: asset.storage_path, asset: asset.external_key },
          'export: asset file could not be read',
        );
        missing.push(asset.external_key);
      }
    }
  }

  const mockups = templates.map((template) => ({
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
        src:
          visuals === 'embed'
            ? sources.get(asset.external_key) ?? ''
            : assetStorage.publicUrl(asset.storage_path),
      })),
  }));

  return { mockups, missing, assetCount: assets.length };
}

async function loadStrategicData(strategyVersionId: string) {
  const version = await queryOne<{
    external_key: string;
    label: string;
    period_start_year: number;
    period_end_year: number;
  }>(
    `SELECT external_key, label, period_start_year, period_end_year
       FROM strategy_versions WHERE id = ?`,
    [strategyVersionId],
  );

  const pillars = await queryRows<{
    code: string;
    label: string;
    display_label: string;
    hint: string;
  }>(
    `SELECT code, label, display_label, hint FROM strategic_pillars
      WHERE strategy_version_id = ? ORDER BY sort_order, code`,
    [strategyVersionId],
  );

  const programRows = await queryRows<Record<string, string>>(
    `SELECT id, code, name, result_text, marketing_objective, approach, horizon_result_text,
            target_groups_text, kpi_text, sources_text, annual_actions, validation_status, label
       FROM strategic_programs
      WHERE strategy_version_id = ? ORDER BY sort_order, code`,
    [strategyVersionId],
  );

  const links = await queryRows<{ program_id: string; code: string }>(
    `SELECT po.program_id, o.code
       FROM strategic_program_objectives po
       JOIN strategic_objectives o ON o.id = po.objective_id
      WHERE o.strategy_version_id = ? ORDER BY o.sort_order`,
    [strategyVersionId],
  );

  const objectives = await queryRows<{ code: string; name: string; source: string; label: string }>(
    `SELECT code, name, source, label FROM strategic_objectives
      WHERE strategy_version_id = ? ORDER BY sort_order, code`,
    [strategyVersionId],
  );

  return {
    strategyVersion: {
      externalKey: version?.external_key ?? '',
      label: version?.label ?? '',
      periodStartYear: version?.period_start_year ?? 0,
      periodEndYear: version?.period_end_year ?? 0,
    },
    pillars: pillars.map((row) => ({
      code: row.code,
      label: row.label,
      displayLabel: row.display_label,
      hint: row.hint,
    })),
    programs: programRows.map((row) => ({
      code: row.code,
      name: row.name,
      result: row.result_text,
      objectiveCodes: links.filter((l) => l.program_id === row.id).map((l) => l.code),
      marketingObjective: row.marketing_objective,
      approach: row.approach,
      result2028: row.horizon_result_text,
      targetGroupsText: row.target_groups_text,
      kpiText: row.kpi_text,
      sourcesText: row.sources_text,
      annualActions: row.annual_actions,
      validationStatus: row.validation_status,
      label: row.label,
    })),
    objectives: objectives.map((row) => ({
      code: row.code,
      name: row.name,
      source: row.source,
      label: row.label,
    })),
  };
}

/** Contract key -> table. The contract names them differently from the schema. */
const CATALOG_KEYS: Array<[string, (typeof MASTER_CATALOGS)[number]]> = [
  ['campaignTypes', 'campaign_types'],
  ['campaignStatuses', 'campaign_statuses'],
  ['audiences', 'audience_segments'],
  ['ctas', 'cta_types'],
  ['products', 'product_catalog'],
  ['channels', 'channel_catalog'],
  ['seasonalityTypes', 'seasonality_types'],
  ['activationChannels', 'activation_channels'],
  ['implementationModes', 'implementation_modes'],
  ['fundingTypes', 'funding_types'],
];

async function loadCatalogs(): Promise<Record<string, Array<{ code: string; label: string }>>> {
  const catalogs: Record<string, Array<{ code: string; label: string }>> = {};
  for (const [contractKey, table] of CATALOG_KEYS) {
    // No is_active filter: a campaign may reference a retired value, and the
    // package has to define every code it uses.
    catalogs[contractKey] = await queryRows<{ code: string; label: string }>(
      `SELECT code, label FROM ${table} ORDER BY sort_order, label`,
    );
  }
  return catalogs;
}

export interface CampaignExport {
  package: Record<string, unknown>;
  /** Schema errors, empty when the package is contract-valid. */
  validationErrors: string[];
  /** Assets whose file could not be read; their src is empty. */
  missingAssets: string[];
  assetCount: number;
  /** Every campaign in the package: the requested one plus its lineage. */
  campaignKeys: string[];
}

/**
 * Walks parent / supersedes links to the root, returning external keys with
 * every referenced campaign *before* the one that references it, so the
 * importer resolves each key by the time it needs it.
 */
async function lineageKeys(externalKey: string): Promise<string[]> {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const queue = [externalKey];

  while (queue.length > 0) {
    const key = queue.shift() as string;
    if (seen.has(key)) continue;
    seen.add(key);

    const links = await queryOne<{ parent: string | null; supersedes: string | null }>(
      `SELECT parent.external_key AS parent, prev.external_key AS supersedes
         FROM campaigns c
         LEFT JOIN campaigns parent ON parent.id = c.parent_campaign_id
         LEFT JOIN campaigns prev   ON prev.id   = c.supersedes_campaign_id
        WHERE c.external_key = ? AND c.deleted_at IS NULL`,
      [key],
    );
    if (!links) continue;

    ordered.unshift(key);
    for (const referenced of [links.parent, links.supersedes]) {
      if (referenced && !seen.has(referenced)) queue.push(referenced);
    }
  }

  // Referenced campaigns were unshifted after their referrer, so reverse-depth
  // ordering already puts ancestors first.
  return ordered;
}

async function buildCampaign(row: CampaignRow, visuals: VisualMode) {

  const [programs, objectives, audiences, ctas, mockupData] =
    await Promise.all([
      relationCodes('campaign_programs', 'strategic_programs', 'program_id', row.id),
      relationCodes('campaign_objectives', 'strategic_objectives', 'objective_id', row.id),
      queryRows<{ code: string; label: string; relation_role: string }>(
        `SELECT a.code, a.label, ca.relation_role
           FROM campaign_audiences ca JOIN audience_segments a ON a.id = ca.audience_segment_id
          WHERE ca.campaign_id = ? ORDER BY ca.sort_order`,
        [row.id],
      ),
      queryRows<{ code: string; label: string }>(
        `SELECT t.code, t.label FROM campaign_ctas cc JOIN cta_types t ON t.id = cc.cta_type_id
          WHERE cc.campaign_id = ? ORDER BY cc.sort_order`,
        [row.id],
      ),
      loadMockups(row.id, visuals),
    ]);

  const primaryAudience = audiences.find((a) => a.relation_role === 'PRIMARY');
  const secondaryAudiences = audiences.filter((a) => a.relation_role === 'SECONDARY');

  const campaign = {
    externalKey: row.external_key,
    campaignFamilyExternalKey: row.campaign_family_external_key,
    supersedesCampaignExternalKey: row.supersedes_external_key ?? '',
    title: row.title,
    accent: row.accent,
    campaignType: ref(row.type_code, row.type_label),
    parentCampaignExternalKey: row.parent_external_key ?? '',
    pillar: ref(row.pillar_code, row.pillar_label),
    seasonalityType: ref(row.seasonality_code, row.seasonality_label),
    seasonalityMonths: row.seasonality_months ?? [],
    seasonalityNote: row.seasonality_note,
    status: ref(row.status_code, row.status_label),
    version: row.version_label,
    responsible: row.responsible,
    programPrimaryCode: programs.primary,
    programSecondaryCodes: programs.secondary,
    objectivePrimaryCode: objectives.primary,
    objectiveSecondaryCodes: objectives.secondary,
    marketingObjective: row.marketing_objective,
    directResult: row.direct_result,
    strategicContribution: row.strategic_contribution ?? [],
    primaryAudienceSegment: ref(primaryAudience?.code ?? '', primaryAudience?.label ?? ''),
    primaryAudienceDescription: row.primary_audience_description,
    secondaryAudienceSegments: secondaryAudiences.map((a) => ref(a.code, a.label)),
    centralIdea: row.central_idea,
    promise: row.promise,
    mainMessage: row.main_message,
    secondaryMessages: row.secondary_messages ?? [],
    tone: row.tone,
    insight: row.insight,
    valueProposition: row.value_proposition,
    products: row.products ?? [],
    productsIntro: row.products_intro,
    productCondition: row.product_condition,
    channels: row.channels ?? [],
    ctas: ctas.map((c) => ref(c.code, c.label)),
    prPartnerships: row.pr_partnerships,
    storytellingDirections: row.storytelling_directions ?? [],
    fixedElements: row.fixed_elements ?? [],
    adaptableElements: row.adaptable_elements ?? [],
    adaptationLimits: row.adaptation_limits ?? [],
    frameworkDeliverables: row.framework_deliverables ?? [],
    deliverableIntro: row.deliverable_intro,
    mockups: mockupData.mockups,
    posts: row.posts ?? [],
    headlines: row.headlines ?? [],
    videoConcepts: row.video_concepts ?? [],
    applicationExamples: row.application_examples ?? [],
    kpiDefinitions: row.kpi_definitions ?? [],
    activationExamples: {
      directions: row.activation_examples?.directions ?? [],
      simulatedRows: row.activation_examples?.simulatedRows ?? [],
    },
    noVisualsNote: row.no_visuals_note,
    sourceFile: row.source_file,
    // The source timestamps are preserved verbatim when the campaign came from
    // an import, so a round trip reproduces the original file. A campaign
    // created in the app has none, and falls back to its own row timestamps.
    createdAt: row.source_created_at_raw || isoFromMysql(row.created_at),
    updatedAt: row.source_updated_at_raw || isoFromMysql(row.updated_at),
  };

  return { campaign, missing: mockupData.missing, assetCount: mockupData.assetCount };
}

export async function exportCampaign(
  externalKey: string,
  visuals: VisualMode = 'embed',
  now = new Date(),
): Promise<CampaignExport | null> {
  const keys = await lineageKeys(externalKey);
  if (keys.length === 0) return null;

  const rows: CampaignRow[] = [];
  for (const key of keys) {
    const row = await queryOne<CampaignRow>(CAMPAIGN_SELECT, [key]);
    if (row) rows.push(row);
  }
  if (rows.length === 0) return null;

  // Every campaign in the package must belong to one strategy version, since the
  // package carries exactly one. Lineage crossing versions would need a
  // different shape, so it is reported rather than silently half-exported.
  const strategyVersionId = rows[rows.length - 1]!.strategy_version_id;
  const crossVersion = rows.filter((row) => row.strategy_version_id !== strategyVersionId);

  const [strategicData, catalogs] = await Promise.all([
    loadStrategicData(strategyVersionId),
    loadCatalogs(),
  ]);

  const built = [];
  for (const row of rows) built.push(await buildCampaign(row, visuals));

  const packageDocument = {
    packageType: 'OMD_CAMPAIGNS_PACKAGE',
    schemaVersion: '1.0',
    metadata: {
      packageId: `export-${externalKey}-${now.toISOString().slice(0, 10)}`,
      generatedAt: now.toISOString(),
      purpose: 'AD_HOC',
      source: 'omd-vj-backend / campaign export',
      // A const in the contract, en dash included - not wording we get to
      // choose. The importer compares it exactly.
      application: "OMD Valea Jiului – Sistem digital de marketing",
      notes:
        built.length > 1
          ? `Export al campaniei ${externalKey}, cu ${built.length - 1} campanii din linia sa.`
          : `Export al campaniei ${externalKey}.`,
    },
    strategicData,
    catalogs,
    campaigns: built.map((entry) => entry.campaign),
  };

  // The guarantee: the same validator the importer runs, on the way out.
  let validationErrors: string[] = [];
  try {
    const result = validateAgainstContract(packageDocument);
    validationErrors = result.errors;
  } catch (error) {
    validationErrors = [(error as Error).message];
  }

  return {
    package: packageDocument,
    validationErrors: [
      ...validationErrors,
      ...crossVersion.map(
        (row) =>
          `campaigns[${row.external_key}] apartine altei versiuni strategice si nu poate fi inclus.`,
      ),
    ],
    missingAssets: built.flatMap((entry) => entry.missing),
    assetCount: built.reduce((total, entry) => total + entry.assetCount, 0),
    campaignKeys: keys,
  };
}
