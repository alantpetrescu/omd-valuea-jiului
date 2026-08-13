/**
 * Activation import — OMD_ACTIVATIONS_PACKAGE.
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
import { execute, queryOne } from '../database/db';
import { newId } from '../shared/ids';
import { assetStorage, stageDataUri } from '../assets/storage';
import type { ImportContext } from '../imports/import-context';

export interface ActivationMaterialPayload {
  id: string;
  title: string;
  channel: string;
  otherChannel: string;
  format: string;
  budgetAllocated: string;
  runStartDate: string;
  runEndDate: string;
  visual: { src: string; name: string; canvaUrl: string };
  copy: string;
  publicUrl: string;
  externalId: string;
  templateCampaignId: string;
  templateId: string;
  templateAssetId: string;
}

export interface ActivationPayload {
  externalKey: string;
  campaignExternalKey: string | null;
  strategyVersionExternalKey?: string | null;
  pillar?: { code: string; label: string } | null;
  title: string;
  startDate: string;
  endDate: string;
  status: { code: string; label: string };
  responsible: string;
  plannedBudget: number | null;
  actualSpend: number | null;
  implementationMode?: { code: string; label: string } | null;
  implementationPartners: string;
  fundingSources: Array<{ type: { code: string; label: string }; label: string; amount: number }>;
  includeAnnualPlan: boolean;
  objective: string;
  audiences: Array<{ code?: string | null; label?: string | null }>;
  products: unknown[];
  zone: string;
  message: string;
  landingUrl: string;
  materials: ActivationMaterialPayload[];
  kpis: Array<{
    id: string;
    enabled: boolean;
    name: string;
    target: string;
    result: string;
    source: string;
    collection: string;
  }>;
  resultSummary: string;
  whatWorked: string;
  recommendation: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnualPlanPayload {
  externalKey: string;
  year: number;
  selectedCampaignExternalKeys: string[];
}

/**
 * Contract money fields are strings. Blank stays NULL — "not supplied" is not
 * the same as zero (spec section 28 / rule 67.7).
 */
function decimalOrNull(value: unknown, where: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const trimmed = String(value).trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) throw new Error(`${where}: valoare numerică invalidă „${trimmed}”.`);
  return parsed;
}

const dateOrNull = (value: string | null | undefined): string | null =>
  value && value.trim() !== '' ? value : null;

async function idByColumn(
  table: string,
  column: string,
  value: string,
  ctx: ImportContext,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${column} = ?`,
    [value],
    ctx.connection,
  );
  return row?.id ?? null;
}

async function resolveStrategyVersion(
  activation: ActivationPayload,
  campaignId: string | null,
  ctx: ImportContext,
): Promise<string> {
  // Linked to a campaign: the version is inherited, never re-chosen (spec 20).
  if (campaignId) {
    const row = await queryOne<{ strategy_version_id: string }>(
      'SELECT strategy_version_id FROM campaigns WHERE id = ?',
      [campaignId],
      ctx.connection,
    );
    if (!row) throw new Error(`activations[${activation.externalKey}]: campania asociată nu a fost găsită.`);

    if (activation.strategyVersionExternalKey) {
      const declared = await idByColumn(
        'strategy_versions',
        'external_key',
        activation.strategyVersionExternalKey,
        ctx,
      );
      if (declared && declared !== row.strategy_version_id) {
        throw new Error(
          `activations[${activation.externalKey}].strategyVersionExternalKey intră în conflict ` +
            `cu versiunea strategică a campaniei.`,
        );
      }
    }
    return row.strategy_version_id;
  }

  if (activation.strategyVersionExternalKey) {
    const id = await idByColumn(
      'strategy_versions',
      'external_key',
      activation.strategyVersionExternalKey,
      ctx,
    );
    if (!id) {
      throw new Error(
        `activations[${activation.externalKey}].strategyVersionExternalKey: versiune inexistentă ` +
          `(${activation.strategyVersionExternalKey}).`,
      );
    }
    return id;
  }

  const active = await queryOne<{ id: string }>(
    "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1",
    [],
    ctx.connection,
  );
  if (!active) {
    throw new Error(
      `activations[${activation.externalKey}]: activare independentă fără versiune strategică ` +
        `și nu există nicio versiune ACTIVE.`,
    );
  }
  return active.id;
}

async function replaceAudiences(
  activationId: string,
  activation: ActivationPayload,
  ctx: ImportContext,
): Promise<void> {
  await execute('DELETE FROM activation_audiences WHERE activation_id = ?', [activationId], ctx.connection);

  for (const [index, audience] of (activation.audiences ?? []).entries()) {
    let segmentId: string | null = null;
    let customLabel: string | null = null;

    if (audience?.code) {
      segmentId = await idByColumn('audience_segments', 'code', audience.code, ctx);
      if (!segmentId) {
        throw new Error(
          `activations[${activation.externalKey}].audiences[${index}]: public inexistent (${audience.code}).`,
        );
      }
    } else if (audience?.label) {
      // Valid and deliberate: spec section 21 requires custom audiences to stay
      // custom, without silently creating a global catalog entry.
      customLabel = audience.label;
    } else {
      throw new Error(
        `activations[${activation.externalKey}].audiences[${index}]: fără cod și fără denumire.`,
      );
    }

    await execute(
      `INSERT INTO activation_audiences (id, activation_id, audience_segment_id, custom_label, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), activationId, segmentId, customLabel, index, ctx.userId],
      ctx.connection,
    );
  }
}

async function replaceFundingSources(
  activationId: string,
  activation: ActivationPayload,
  ctx: ImportContext,
): Promise<void> {
  await execute(
    'DELETE FROM activation_funding_sources WHERE activation_id = ?',
    [activationId],
    ctx.connection,
  );

  for (const [index, source] of (activation.fundingSources ?? []).entries()) {
    const typeId = await idByColumn('funding_types', 'code', source.type?.code ?? '', ctx);
    if (!typeId) {
      throw new Error(
        `activations[${activation.externalKey}].fundingSources[${index}]: tip de finanțare inexistent ` +
          `(${source.type?.code ?? '—'}).`,
      );
    }
    await execute(
      `INSERT INTO activation_funding_sources
         (id, activation_id, funding_type_id, custom_label, amount, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        newId(),
        activationId,
        typeId,
        source.label ?? '',
        decimalOrNull(source.amount, `fundingSources[${index}].amount`) ?? 0,
        index,
        ctx.userId,
      ],
      ctx.connection,
    );
  }
}

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
 * Taking the mapping literally would collapse 78 KPIs into 33 and reassign them
 * to whichever activation was imported last — silent data loss. Scoping the key
 * keeps every row, respects the existing UNIQUE constraint and needs no schema
 * change. Export splits on the separator to reproduce the contract id.
 *
 * See KNOWN_DEVIATIONS.md.
 */
const KPI_KEY_SEPARATOR = '::';

export function scopedKpiKey(activationExternalKey: string, kpiId: string): string {
  return `${activationExternalKey}${KPI_KEY_SEPARATOR}${kpiId}`;
}

export function contractKpiId(externalKey: string): string {
  const index = externalKey.indexOf(KPI_KEY_SEPARATOR);
  return index === -1 ? externalKey : externalKey.slice(index + KPI_KEY_SEPARATOR.length);
}

async function upsertKpis(
  activationId: string,
  activation: ActivationPayload,
  ctx: ImportContext,
): Promise<void> {
  for (const [index, kpi] of (activation.kpis ?? []).entries()) {
    const externalKey = scopedKpiKey(activation.externalKey, kpi.id);
    const existing = await idByColumn('activation_kpis', 'external_key', externalKey, ctx);
    const columns = [
      kpi.enabled ? 1 : 0,
      kpi.name ?? '',
      kpi.target ?? '',
      kpi.result ?? '',
      kpi.source ?? '',
      kpi.collection ?? '',
      index,
    ];

    if (existing) {
      await execute(
        `UPDATE activation_kpis
            SET activation_id = ?, enabled = ?, name = ?, target_text = ?, result_text = ?,
                source_text = ?, collection_text = ?, sort_order = ?, updated_by = ?
          WHERE id = ?`,
        [activationId, ...columns, ctx.userId, existing],
        ctx.connection,
      );
      await ctx.recordItem('activation_kpis', externalKey, existing, 'UPDATE');
    } else {
      const id = newId();
      await execute(
        `INSERT INTO activation_kpis
           (id, external_key, activation_id, enabled, name, target_text, result_text,
            source_text, collection_text, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, externalKey, activationId, ...columns, ctx.userId],
        ctx.connection,
      );
      await ctx.recordItem('activation_kpis', externalKey, id, 'CREATE');
    }
  }
}

async function upsertMaterials(
  activationId: string,
  activation: ActivationPayload,
  published: string[],
  ctx: ImportContext,
): Promise<void> {
  for (const material of activation.materials ?? []) {
    const where = `activations[${activation.externalKey}].materials[${material.id}]`;

    // Channel arrives as a display label; the code lives in the catalog.
    let channelId: string | null = null;
    if (material.channel) {
      channelId = await idByColumn('activation_channels', 'label', material.channel, ctx);
      if (!channelId) ctx.warn(`${where}: canal necunoscut în nomenclator „${material.channel}”.`);
    }

    const templateCampaignId = material.templateCampaignId
      ? await idByColumn('campaigns', 'external_key', material.templateCampaignId, ctx)
      : null;
    const templateId = material.templateId
      ? await idByColumn('campaign_templates', 'external_key', material.templateId, ctx)
      : null;
    const templateAssetId = material.templateAssetId
      ? await idByColumn('campaign_template_assets', 'external_key', material.templateAssetId, ctx)
      : null;

    if (material.templateId && !templateId) throw new Error(`${where}.templateId: template inexistent.`);
    if (material.templateAssetId && !templateAssetId) {
      throw new Error(`${where}.templateAssetId: vizual de template inexistent.`);
    }

    // A material may carry its own image instead of reusing a template asset.
    let ownAssetId: string | null = null;
    const src = material.visual?.src ?? '';
    if (src.startsWith('data:')) {
      const file = await stageDataUri(src);
      ownAssetId = newId();
      await execute(
        `INSERT INTO assets
           (id, external_key, filename, original_filename, mime_type, file_size, storage_path, checksum_sha256, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          ownAssetId, `asset-${material.id}`, file.filename, file.filename,
          file.mimeType, file.fileSize, file.storageKey, file.checksumSha256, ctx.userId,
        ],
        ctx.connection,
      );
      await assetStorage.publish(file.temporaryPath, file.storageKey);
      published.push(file.storageKey);
      await ctx.recordItem('assets', `asset-${material.id}`, ownAssetId, 'CREATE');
    }

    const values = [
      activationId,
      material.title ?? '',
      channelId,
      material.channel ?? '',
      material.otherChannel ?? '',
      material.format ?? '',
      decimalOrNull(material.budgetAllocated, `${where}.budgetAllocated`),
      dateOrNull(material.runStartDate),
      dateOrNull(material.runEndDate),
      material.visual?.name ?? '',
      material.visual?.canvaUrl ?? '',
      ownAssetId,
      material.copy ?? '',
      material.publicUrl ?? '',
      material.externalId ?? '',
      templateCampaignId,
      templateId,
      templateAssetId,
    ];

    const existing = await idByColumn('activation_materials', 'external_key', material.id, ctx);
    if (existing) {
      await execute(
        `UPDATE activation_materials
            SET activation_id = ?, title = ?, channel_id = ?, channel_raw = ?, other_channel = ?,
                format_text = ?, budget_allocated = ?, run_start_date = ?, run_end_date = ?,
                visual_name = ?, visual_canva_url = ?, own_asset_id = COALESCE(?, own_asset_id),
                copy_text = ?, public_url = ?, platform_external_id = ?,
                template_campaign_id = ?, campaign_template_id = ?, campaign_template_asset_id = ?,
                updated_by = ?
          WHERE id = ?`,
        [...values, ctx.userId, existing],
        ctx.connection,
      );
      await ctx.recordItem('activation_materials', material.id, existing, 'UPDATE');
    } else {
      const id = newId();
      await execute(
        `INSERT INTO activation_materials
           (id, external_key, activation_id, title, channel_id, channel_raw, other_channel, format_text,
            budget_allocated, run_start_date, run_end_date, visual_name, visual_canva_url, own_asset_id,
            copy_text, public_url, platform_external_id, template_campaign_id, campaign_template_id,
            campaign_template_asset_id, created_by)
         VALUES (?, ?, ${values.map(() => '?').join(', ')}, ?)`,
        [id, material.id, ...values, ctx.userId],
        ctx.connection,
      );
      await ctx.recordItem('activation_materials', material.id, id, 'CREATE');
    }
  }
}

/** Every calendar year touched by the activation period. */
export function overlappedYears(startDate: string | null, endDate: string | null): number[] {
  if (!startDate || !endDate) return [];
  const first = Number(startDate.slice(0, 4));
  const last = Number(endDate.slice(0, 4));
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

async function getOrCreateAnnualPlan(year: number, ctx: ImportContext): Promise<string> {
  const existing = await queryOne<{ id: string; deleted_at: string | null }>(
    'SELECT id, deleted_at FROM annual_plans WHERE year = ?',
    [year],
    ctx.connection,
  );

  if (existing) {
    // A soft-deleted plan for the same year is reactivated, never duplicated.
    if (existing.deleted_at) {
      await execute(
        'UPDATE annual_plans SET deleted_at = NULL, deleted_by = NULL WHERE id = ?',
        [existing.id],
        ctx.connection,
      );
    }
    return existing.id;
  }

  const id = newId();
  await execute(
    'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
    [id, String(year), year, ctx.userId],
    ctx.connection,
  );
  await ctx.recordItem('annual_plans', String(year), id, 'CREATE', 'materialised from activation dates');
  return id;
}

/** Materialises `includeAnnualPlan` into relations. No warning when a plan is missing. */
async function materialiseAnnualPlan(
  activationId: string,
  activation: ActivationPayload,
  ctx: ImportContext,
): Promise<void> {
  const years = activation.includeAnnualPlan
    ? overlappedYears(dateOrNull(activation.startDate), dateOrNull(activation.endDate))
    : [];

  const planIds = new Set<string>();
  for (const year of years) {
    const planId = await getOrCreateAnnualPlan(year, ctx);
    planIds.add(planId);
    await execute(
      `INSERT INTO annual_plan_activations (annual_plan_id, activation_id, created_by)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE annual_plan_id = annual_plan_id`,
      [planId, activationId, ctx.userId],
      ctx.connection,
    );
    await ctx.recordItem('annual_plan_activations', `${year}:${activation.externalKey}`, null, 'CREATE');
  }

  // Drop relations for years the activation no longer covers after a date change.
  const stale = await queryOne<{ total: number }>(
    `SELECT COUNT(*) AS total FROM annual_plan_activations WHERE activation_id = ?`,
    [activationId],
    ctx.connection,
  );
  if ((stale?.total ?? 0) > planIds.size) {
    const keep = [...planIds];
    await execute(
      `DELETE FROM annual_plan_activations
        WHERE activation_id = ?
          ${keep.length ? `AND annual_plan_id NOT IN (${keep.map(() => '?').join(', ')})` : ''}`,
      [activationId, ...keep],
      ctx.connection,
    );
  }
}

/** Explicit `annualPlans[]` carry MANUAL campaign selections only. */
async function importManualPlanSelections(
  plans: AnnualPlanPayload[],
  ctx: ImportContext,
): Promise<void> {
  for (const plan of plans ?? []) {
    if (String(plan.externalKey) !== String(plan.year)) {
      throw new Error(`annualPlans[${plan.externalKey}]: externalKey trebuie să coincidă cu anul.`);
    }

    const planId = await getOrCreateAnnualPlan(plan.year, ctx);
    await execute('DELETE FROM annual_plan_campaigns WHERE annual_plan_id = ?', [planId], ctx.connection);

    for (const [index, campaignKey] of (plan.selectedCampaignExternalKeys ?? []).entries()) {
      const campaignId = await idByColumn('campaigns', 'external_key', campaignKey, ctx);
      if (!campaignId) {
        throw new Error(
          `annualPlans[${plan.year}].selectedCampaignExternalKeys: campanie inexistentă (${campaignKey}).`,
        );
      }
      await execute(
        `INSERT INTO annual_plan_campaigns (annual_plan_id, campaign_id, sort_order, created_by)
         VALUES (?, ?, ?, ?)`,
        [planId, campaignId, index, ctx.userId],
        ctx.connection,
      );
    }

    await ctx.recordItem('annual_plan_campaigns', String(plan.year), planId, 'UPDATE');
  }
}

export async function importActivations(
  activations: ActivationPayload[],
  annualPlans: AnnualPlanPayload[],
  ctx: ImportContext,
): Promise<{ publishedStorageKeys: string[] }> {
  const published: string[] = [];

  for (const activation of activations) {
    const campaignId = activation.campaignExternalKey
      ? await idByColumn('campaigns', 'external_key', activation.campaignExternalKey, ctx)
      : null;

    if (activation.campaignExternalKey && !campaignId) {
      throw new Error(
        `activations[${activation.externalKey}].campaignExternalKey: campanie inexistentă ` +
          `(${activation.campaignExternalKey}).`,
      );
    }

    const strategyVersionId = await resolveStrategyVersion(activation, campaignId, ctx);

    const statusId = await idByColumn('campaign_statuses', 'code', activation.status?.code ?? '', ctx);
    if (!statusId) {
      throw new Error(
        `activations[${activation.externalKey}].status: stadiu inexistent (${activation.status?.code ?? '—'}).`,
      );
    }

    const implementationModeId = activation.implementationMode?.code
      ? await idByColumn('implementation_modes', 'code', activation.implementationMode.code, ctx)
      : null;

    // Pillar is only meaningful for an independent activation; a linked one
    // inherits its strategic frame from the campaign.
    let pillarId: string | null = null;
    if (!campaignId && activation.pillar?.code) {
      pillarId = await queryOne<{ id: string }>(
        'SELECT id FROM strategic_pillars WHERE strategy_version_id = ? AND code = ?',
        [strategyVersionId, activation.pillar.code],
        ctx.connection,
      ).then((row) => row?.id ?? null);
    }

    const values = [
      strategyVersionId,
      campaignId,
      pillarId,
      activation.title ?? '',
      dateOrNull(activation.startDate),
      dateOrNull(activation.endDate),
      statusId,
      activation.responsible ?? '',
      decimalOrNull(activation.plannedBudget, `activations[${activation.externalKey}].plannedBudget`),
      decimalOrNull(activation.actualSpend, `activations[${activation.externalKey}].actualSpend`),
      implementationModeId,
      activation.implementationPartners ?? '',
      activation.objective ?? '',
      JSON.stringify(activation.products ?? []),
      activation.zone ?? '',
      activation.message ?? '',
      activation.landingUrl ?? '',
      activation.resultSummary ?? '',
      activation.whatWorked ?? '',
      activation.recommendation ?? '',
      activation.createdAt ?? '',
      activation.updatedAt ?? '',
    ];

    const existing = await idByColumn('activations', 'external_key', activation.externalKey, ctx);
    let activationId: string;

    if (existing) {
      activationId = existing;
      await execute(
        `UPDATE activations
            SET strategy_version_id = ?, campaign_id = ?, pillar_id = ?, title = ?, start_date = ?,
                end_date = ?, status_id = ?, responsible = ?, planned_budget = ?, actual_spend = ?,
                implementation_mode_id = ?, implementation_partners = ?, objective = ?, products = ?,
                zone = ?, message = ?, landing_url = ?, result_summary = ?, what_worked = ?,
                recommendation = ?, source_created_at_raw = ?, source_updated_at_raw = ?,
                version_number = version_number + 1, updated_by = ?
          WHERE id = ?`,
        [...values, ctx.userId, activationId],
        ctx.connection,
      );
      await ctx.recordItem('activations', activation.externalKey, activationId, 'UPDATE');
    } else {
      activationId = newId();
      await execute(
        `INSERT INTO activations
           (id, external_key, strategy_version_id, campaign_id, pillar_id, title, start_date, end_date,
            status_id, responsible, planned_budget, actual_spend, implementation_mode_id,
            implementation_partners, objective, products, zone, message, landing_url,
            result_summary, what_worked, recommendation, source_created_at_raw, source_updated_at_raw, created_by)
         VALUES (?, ?, ${values.map(() => '?').join(', ')}, ?)`,
        [activationId, activation.externalKey, ...values, ctx.userId],
        ctx.connection,
      );
      await ctx.recordItem('activations', activation.externalKey, activationId, 'CREATE');
    }

    await replaceAudiences(activationId, activation, ctx);
    await replaceFundingSources(activationId, activation, ctx);
    await upsertKpis(activationId, activation, ctx);
    await upsertMaterials(activationId, activation, published, ctx);
    await materialiseAnnualPlan(activationId, activation, ctx);
  }

  await importManualPlanSelections(annualPlans, ctx);

  return { publishedStorageKeys: published };
}
