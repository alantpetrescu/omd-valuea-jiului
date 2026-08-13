/**
 * Campaign import — OMD_CAMPAIGNS_PACKAGE.
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
import { execute, queryOne } from '../database/db';
import { newId } from '../shared/ids';
import { assetStorage, stageDataUri, type StoredAsset } from '../assets/storage';
import type { ImportContext } from '../imports/import-context';
import { resolveCode, type CatalogMaps } from '../catalogs/master-data-import';
import type { StrategyMaps } from '../strategy/strategy-import';

type Json = unknown;

export interface CampaignAssetPayload {
  id: string;
  format: string;
  label: string;
  src: string;
}

export interface CampaignMockupPayload {
  id: string;
  name: string;
  formats: string;
  structure: string;
  generic: boolean;
  canvaUrl: string;
  assets?: CampaignAssetPayload[];
}

export interface CampaignPayload {
  externalKey: string;
  campaignFamilyExternalKey: string;
  supersedesCampaignExternalKey?: string | null;
  parentCampaignExternalKey?: string | null;
  title: string;
  accent: string;
  campaignType: { code: string; label: string };
  pillar: { code: string; label: string };
  seasonalityType: { code: string; label: string };
  status: { code: string; label: string };
  seasonalityMonths: number[];
  seasonalityNote: string;
  version: string;
  responsible: string;
  programPrimaryCode: string;
  programSecondaryCodes: string[];
  objectivePrimaryCode: string;
  objectiveSecondaryCodes: string[];
  primaryAudienceSegment: { code?: string | null; label?: string | null };
  secondaryAudienceSegments: Array<{ code?: string | null; label?: string | null }>;
  ctas: Array<{ code?: string | null; label?: string | null }>;
  mockups?: CampaignMockupPayload[];
  [key: string]: Json;
}

/** Files decoded to the temp directory before the transaction opens. */
export type StagedAssets = Map<string, StoredAsset & { temporaryPath: string }>;

/** Decodes every base64 asset in the package into the import temp directory. */
export async function stageCampaignAssets(campaigns: CampaignPayload[]): Promise<StagedAssets> {
  const staged: StagedAssets = new Map();

  for (const campaign of campaigns) {
    for (const mockup of campaign.mockups ?? []) {
      for (const asset of mockup.assets ?? []) {
        if (!asset.src) continue;
        try {
          staged.set(asset.id, await stageDataUri(asset.src));
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          throw new Error(`Asset ${asset.id} din campania ${campaign.externalKey}: ${reason}`);
        }
      }
    }
  }

  return staged;
}

const text = (value: Json): string => (typeof value === 'string' ? value : '');
const json = (value: Json, fallback: Json = []): string => JSON.stringify(value ?? fallback);

/** Column list is explicit so a contract change surfaces as a compile/SQL error. */
const CAMPAIGN_COLUMNS = [
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
] as const;

function campaignValues(
  campaign: CampaignPayload,
  catalogs: CatalogMaps,
  strategy: StrategyMaps,
): Array<string | number | null> {
  const where = `campaigns[${campaign.externalKey}]`;

  const pillarId = strategy.pillars.get(campaign.pillar?.code ?? '');
  if (!pillarId) {
    throw new Error(`${where}.pillar: pilon inexistent în versiunea strategică: ${campaign.pillar?.code}`);
  }

  return [
    campaign.title,
    campaign.accent,
    resolveCode(catalogs, 'campaign_types', campaign.campaignType?.code, `${where}.campaignType`),
    resolveCode(catalogs, 'campaign_statuses', campaign.status?.code, `${where}.status`),
    pillarId,
    resolveCode(catalogs, 'seasonality_types', campaign.seasonalityType?.code, `${where}.seasonalityType`),
    json(campaign.seasonalityMonths),
    text(campaign.seasonalityNote),
    text(campaign.version),
    text(campaign.responsible),
    text(campaign.marketingObjective),
    text(campaign.directResult),
    json(campaign.strategicContribution),
    text(campaign.primaryAudienceDescription),
    text(campaign.centralIdea),
    text(campaign.promise),
    text(campaign.mainMessage),
    json(campaign.secondaryMessages),
    text(campaign.tone),
    text(campaign.insight),
    text(campaign.valueProposition),
    json(campaign.products),
    text(campaign.productsIntro),
    text(campaign.productCondition),
    json(campaign.channels),
    text(campaign.prPartnerships),
    json(campaign.storytellingDirections),
    json(campaign.fixedElements),
    json(campaign.adaptableElements),
    json(campaign.adaptationLimits),
    json(campaign.frameworkDeliverables),
    text(campaign.deliverableIntro),
    json(campaign.posts),
    json(campaign.headlines),
    json(campaign.videoConcepts),
    json(campaign.applicationExamples),
    json(campaign.kpiDefinitions),
    json(campaign.activationExamples, {}),
    text(campaign.noVisualsNote),
    text(campaign.sourceFile),
    text(campaign.createdAt),
    text(campaign.updatedAt),
  ];
}

async function replaceRelations(
  campaignId: string,
  campaign: CampaignPayload,
  catalogs: CatalogMaps,
  strategy: StrategyMaps,
  ctx: ImportContext,
): Promise<void> {
  const where = `campaigns[${campaign.externalKey}]`;

  for (const table of ['campaign_programs', 'campaign_objectives', 'campaign_audiences', 'campaign_ctas']) {
    await execute(`DELETE FROM ${table} WHERE campaign_id = ?`, [campaignId], ctx.connection);
  }

  const linkStrategic = async (
    table: 'campaign_programs' | 'campaign_objectives',
    column: 'program_id' | 'objective_id',
    map: Map<string, string>,
    code: string,
    role: 'PRIMARY' | 'SECONDARY',
    order: number,
  ) => {
    const id = map.get(code);
    if (!id) throw new Error(`${where}: cod strategic inexistent în versiunea curentă: ${code}`);
    await execute(
      `INSERT INTO ${table} (campaign_id, ${column}, relation_role, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [campaignId, id, role, order, ctx.userId],
      ctx.connection,
    );
  };

  if (campaign.programPrimaryCode) {
    await linkStrategic('campaign_programs', 'program_id', strategy.programs, campaign.programPrimaryCode, 'PRIMARY', 0);
  }
  for (const [index, code] of (campaign.programSecondaryCodes ?? []).entries()) {
    await linkStrategic('campaign_programs', 'program_id', strategy.programs, code, 'SECONDARY', index + 1);
  }
  if (campaign.objectivePrimaryCode) {
    await linkStrategic('campaign_objectives', 'objective_id', strategy.objectives, campaign.objectivePrimaryCode, 'PRIMARY', 0);
  }
  for (const [index, code] of (campaign.objectiveSecondaryCodes ?? []).entries()) {
    await linkStrategic('campaign_objectives', 'objective_id', strategy.objectives, code, 'SECONDARY', index + 1);
  }

  // A campaign-level audience without a catalog code is not valid: only
  // Activations may carry a free-text custom audience (spec section 21).
  const linkAudience = async (code: string | null | undefined, role: 'PRIMARY' | 'SECONDARY', order: number) => {
    if (!code) return;
    const id = resolveCode(catalogs, 'audience_segments', code, `${where}.audience`);
    await execute(
      `INSERT INTO campaign_audiences (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [campaignId, id, role, order, ctx.userId],
      ctx.connection,
    );
  };

  await linkAudience(campaign.primaryAudienceSegment?.code, 'PRIMARY', 0);
  for (const [index, segment] of (campaign.secondaryAudienceSegments ?? []).entries()) {
    await linkAudience(segment?.code, 'SECONDARY', index + 1);
  }

  for (const [index, cta] of (campaign.ctas ?? []).entries()) {
    if (!cta?.code) continue;
    const id = resolveCode(catalogs, 'cta_types', cta.code, `${where}.ctas[${index}]`);
    await execute(
      `INSERT INTO campaign_ctas (campaign_id, cta_type_id, sort_order, created_by) VALUES (?, ?, ?, ?)`,
      [campaignId, id, index, ctx.userId],
      ctx.connection,
    );
  }
}

async function importTemplates(
  campaignId: string,
  campaign: CampaignPayload,
  staged: StagedAssets,
  published: string[],
  ctx: ImportContext,
): Promise<void> {
  for (const [index, mockup] of (campaign.mockups ?? []).entries()) {
    let templateId: string;
    const existingTemplate = await queryOne<{ id: string }>(
      'SELECT id FROM campaign_templates WHERE external_key = ?',
      [mockup.id],
      ctx.connection,
    );

    if (existingTemplate) {
      templateId = existingTemplate.id;
      await execute(
        `UPDATE campaign_templates
            SET campaign_id = ?, name = ?, formats_text = ?, structure_text = ?,
                is_generic = ?, canva_url = ?, sort_order = ?, updated_by = ?
          WHERE id = ?`,
        [
          campaignId, mockup.name, mockup.formats, mockup.structure,
          mockup.generic ? 1 : 0, mockup.canvaUrl, index, ctx.userId, templateId,
        ],
        ctx.connection,
      );
      await ctx.recordItem('campaign_templates', mockup.id, templateId, 'UPDATE');
    } else {
      templateId = newId();
      await execute(
        `INSERT INTO campaign_templates
           (id, external_key, campaign_id, name, formats_text, structure_text, is_generic, canva_url, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          templateId, mockup.id, campaignId, mockup.name, mockup.formats, mockup.structure,
          mockup.generic ? 1 : 0, mockup.canvaUrl, index, ctx.userId,
        ],
        ctx.connection,
      );
      await ctx.recordItem('campaign_templates', mockup.id, templateId, 'CREATE');
    }

    for (const [assetIndex, asset] of (mockup.assets ?? []).entries()) {
      const file = staged.get(asset.id);
      if (!file) continue;

      const existingAsset = await queryOne<{ id: string }>(
        'SELECT id FROM assets WHERE external_key = ?',
        [asset.id],
        ctx.connection,
      );

      let assetId: string;
      if (existingAsset) {
        assetId = existingAsset.id;
        await ctx.recordItem('assets', asset.id, assetId, 'UNCHANGED');
      } else {
        assetId = newId();
        await execute(
          `INSERT INTO assets
             (id, external_key, filename, original_filename, mime_type, file_size, storage_path, checksum_sha256, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            assetId, asset.id, file.filename, `${asset.id}${file.filename.slice(file.filename.lastIndexOf('.'))}`,
            file.mimeType, file.fileSize, file.storageKey, file.checksumSha256, ctx.userId,
          ],
          ctx.connection,
        );
        // Publish inside the transaction; `published` drives cleanup on rollback.
        await assetStorage.publish(file.temporaryPath, file.storageKey);
        published.push(file.storageKey);
        await ctx.recordItem('assets', asset.id, assetId, 'CREATE');
      }

      const existingLink = await queryOne<{ id: string }>(
        'SELECT id FROM campaign_template_assets WHERE external_key = ?',
        [asset.id],
        ctx.connection,
      );

      if (existingLink) {
        await execute(
          `UPDATE campaign_template_assets
              SET campaign_template_id = ?, asset_id = ?, format_text = ?, label = ?, sort_order = ?, updated_by = ?
            WHERE id = ?`,
          [templateId, assetId, asset.format, asset.label, assetIndex, ctx.userId, existingLink.id],
          ctx.connection,
        );
        await ctx.recordItem('campaign_template_assets', asset.id, existingLink.id, 'UPDATE');
      } else {
        const linkId = newId();
        await execute(
          `INSERT INTO campaign_template_assets
             (id, external_key, campaign_template_id, asset_id, format_text, label, sort_order, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [linkId, asset.id, templateId, assetId, asset.format, asset.label, assetIndex, ctx.userId],
          ctx.connection,
        );
        await ctx.recordItem('campaign_template_assets', asset.id, linkId, 'CREATE');
      }
    }
  }
}

export interface CampaignImportResult {
  /** Storage keys written during this run, for cleanup if the transaction fails. */
  publishedStorageKeys: string[];
}

export async function importCampaigns(
  campaigns: CampaignPayload[],
  catalogs: CatalogMaps,
  strategy: StrategyMaps,
  staged: StagedAssets,
  ctx: ImportContext,
): Promise<CampaignImportResult> {
  const publishedStorageKeys: string[] = [];
  const idByExternalKey = new Map<string, string>();

  // Pass 1: campaigns themselves, with self-references left NULL.
  for (const campaign of campaigns) {
    const values = campaignValues(campaign, catalogs, strategy);
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM campaigns WHERE external_key = ?',
      [campaign.externalKey],
      ctx.connection,
    );

    if (existing) {
      await execute(
        `UPDATE campaigns SET ${CAMPAIGN_COLUMNS.map((column) => `${column} = ?`).join(', ')},
                version_number = version_number + 1, updated_by = ?
          WHERE id = ?`,
        [...values, ctx.userId, existing.id],
        ctx.connection,
      );
      idByExternalKey.set(campaign.externalKey, existing.id);
      await ctx.recordItem('campaigns', campaign.externalKey, existing.id, 'UPDATE');
    } else {
      const id = newId();
      await execute(
        `INSERT INTO campaigns
           (id, external_key, campaign_family_external_key, strategy_version_id, ${CAMPAIGN_COLUMNS.join(', ')}, created_by)
         VALUES (?, ?, ?, ?, ${CAMPAIGN_COLUMNS.map(() => '?').join(', ')}, ?)`,
        [
          id,
          campaign.externalKey,
          campaign.campaignFamilyExternalKey,
          strategy.strategyVersionId,
          ...values,
          ctx.userId,
        ],
        ctx.connection,
      );
      idByExternalKey.set(campaign.externalKey, id);
      await ctx.recordItem('campaigns', campaign.externalKey, id, 'CREATE');
    }
  }

  // Pass 2: parent and lineage links, now that every campaign row exists.
  for (const campaign of campaigns) {
    const id = idByExternalKey.get(campaign.externalKey)!;

    const resolveSibling = async (externalKey: string | null | undefined, field: string) => {
      if (!externalKey) return null;
      const local = idByExternalKey.get(externalKey);
      if (local) return local;
      const row = await queryOne<{ id: string }>(
        'SELECT id FROM campaigns WHERE external_key = ?',
        [externalKey],
        ctx.connection,
      );
      if (!row) {
        throw new Error(`campaigns[${campaign.externalKey}].${field}: campanie inexistentă (${externalKey})`);
      }
      return row.id;
    };

    const parentId = await resolveSibling(campaign.parentCampaignExternalKey, 'parentCampaignExternalKey');
    const supersedesId = await resolveSibling(
      campaign.supersedesCampaignExternalKey,
      'supersedesCampaignExternalKey',
    );

    if (supersedesId) {
      const predecessor = await queryOne<{ campaign_family_external_key: string }>(
        'SELECT campaign_family_external_key FROM campaigns WHERE id = ?',
        [supersedesId],
        ctx.connection,
      );
      if (predecessor?.campaign_family_external_key !== campaign.campaignFamilyExternalKey) {
        throw new Error(
          `campaigns[${campaign.externalKey}].supersedesCampaignExternalKey: predecesorul trebuie ` +
            `să aparțină aceleiași familii de campanie.`,
        );
      }
    }

    if (parentId || supersedesId) {
      await execute(
        'UPDATE campaigns SET parent_campaign_id = ?, supersedes_campaign_id = ? WHERE id = ?',
        [parentId, supersedesId, id],
        ctx.connection,
      );
    }

    await replaceRelations(id, campaign, catalogs, strategy, ctx);
    await importTemplates(id, campaign, staged, publishedStorageKeys, ctx);
  }

  return { publishedStorageKeys };
}
