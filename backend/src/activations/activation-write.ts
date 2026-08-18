/**
 * Activation create and update.
 *
 * Rules this enforces:
 *   - manual create requires an ACTIVE campaign (spec 20); the importer is the
 *     only path allowed to attach to a CLOSED one;
 *   - strategy version is INHERITED from the campaign and never re-chosen; an
 *     independent activation resolves it from its own key or the ACTIVE version;
 *   - `pillar` is only meaningful for an independent activation;
 *   - an audience carries either a catalog code or a custom label, never both —
 *     custom audiences stay custom and never create a global catalog entry
 *     (spec 21);
 *   - `includeAnnualPlan` has no column: it materialises into
 *     `annual_plan_activations`, creating `annual_plans(year)` on demand, and
 *     relations for years no longer covered are removed (spec 25);
 *   - materials are upserted, never deleted, because monitoring snapshots
 *     reference them.
 */
import { z } from 'zod';
import type { PoolConnection } from 'mysql2/promise';

import { execute, queryOne, queryRows, withTransaction } from '../database/db';
import { newExternalKey, newId } from '../shared/ids';
import { ApiError } from '../shared/http';
import { writeAudit } from '../audit/audit-service';

const MoneyOrNull = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .transform((value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

const DateOrNull = z
  .string()
  .nullable()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value : null));

/** Exactly one of `code` / `customLabel` — mirrors the DB CHECK constraint. */
const AudienceInput = z
  .object({
    code: z.string().nullable().optional(),
    customLabel: z.string().nullable().optional(),
  })
  .refine(
    (value) => Boolean(value.code) !== Boolean(value.customLabel?.trim()),
    'Un public trebuie să aibă fie un cod din nomenclator, fie o denumire personalizată.',
  );

export const ActivationInput = z.object({
  title: z.string().trim().min(1, 'Denumirea activării este obligatorie.'),
  campaignExternalKey: z.string().nullable().default(null),
  strategyVersionExternalKey: z.string().nullable().optional(),
  pillarCode: z.string().nullable().optional(),
  startDate: DateOrNull,
  endDate: DateOrNull,
  statusCode: z.string().default('DRAFT'),
  responsible: z.string().default(''),
  plannedBudget: MoneyOrNull,
  actualSpend: MoneyOrNull,
  implementationModeCode: z.string().nullable().optional(),
  implementationPartners: z.string().default(''),
  objective: z.string().default(''),
  products: z.array(z.string()).default([]),
  zone: z.string().default(''),
  message: z.string().default(''),
  landingUrl: z.string().default(''),
  resultSummary: z.string().default(''),
  whatWorked: z.string().default(''),
  recommendation: z.string().default(''),
  includeAnnualPlan: z.boolean().default(false),
  audiences: z.array(AudienceInput).default([]),
  fundingSources: z
    .array(
      z.object({
        typeCode: z.string().min(1, 'Tipul de finanțare este obligatoriu.'),
        label: z.string().default(''),
        amount: z.union([z.number(), z.string()]).transform((v) => Number(v) || 0),
      }),
    )
    .default([]),
  materials: z
    .array(
      z.object({
        id: z.string().optional(),
        title: z.string().default(''),
        channel: z.string().default(''),
        otherChannel: z.string().default(''),
        format: z.string().default(''),
        budgetAllocated: MoneyOrNull,
        runStartDate: DateOrNull,
        runEndDate: DateOrNull,
        copy: z.string().default(''),
        publicUrl: z.string().default(''),
        visualName: z.string().default(''),
      }),
    )
    .default([]),
  kpis: z
    .array(
      z.object({
        id: z.string().optional(),
        enabled: z.boolean().default(true),
        name: z.string().default(''),
        target: z.string().default(''),
        result: z.string().default(''),
        source: z.string().default(''),
        collection: z.string().default(''),
      }),
    )
    .default([]),
});

export type ActivationInputType = z.infer<typeof ActivationInput>;

function endsBeforeStart(input: ActivationInputType): boolean {
  return Boolean(input.startDate && input.endDate && input.endDate < input.startDate);
}

/** Every calendar year touched by the period. */
export function overlappedYears(startDate: string | null, endDate: string | null): number[] {
  if (!startDate || !endDate) return [];
  const first = Number(startDate.slice(0, 4));
  const last = Number(endDate.slice(0, 4));
  if (!Number.isInteger(first) || !Number.isInteger(last) || last < first) return [];
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

async function idByColumn(
  table: string,
  column: string,
  value: string,
  connection: PoolConnection,
): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE ${column} = ?`,
    [value],
    connection,
  );
  return row?.id ?? null;
}

interface ResolvedContext {
  campaignId: string | null;
  strategyVersionId: string;
  statusId: string;
  implementationModeId: string | null;
  pillarId: string | null;
}

async function resolveContext(
  input: ActivationInputType,
  connection: PoolConnection,
  { requireActiveCampaign }: { requireActiveCampaign: boolean },
): Promise<ResolvedContext> {
  let campaignId: string | null = null;
  let strategyVersionId: string | null = null;

  if (input.campaignExternalKey) {
    const campaign = await queryOne<{ id: string; strategy_version_id: string; status_code: string }>(
      `SELECT c.id, c.strategy_version_id, s.code AS status_code
         FROM campaigns c JOIN campaign_statuses s ON s.id = c.status_id
        WHERE c.external_key = ? AND c.deleted_at IS NULL`,
      [input.campaignExternalKey],
      connection,
    );
    if (!campaign) throw ApiError.validation('Campania selectată nu a fost găsită.');

    // Spec 20: only an ACTIVE campaign can spawn a new activation by hand.
    if (requireActiveCampaign && campaign.status_code !== 'ACTIVE') {
      throw ApiError.validation(
        'O activare nouă poate fi creată doar dintr-o campanie cu stadiul Activă.',
      );
    }

    campaignId = campaign.id;
    strategyVersionId = campaign.strategy_version_id;

    if (input.strategyVersionExternalKey) {
      const declared = await idByColumn(
        'strategy_versions',
        'external_key',
        input.strategyVersionExternalKey,
        connection,
      );
      if (declared && declared !== strategyVersionId) {
        throw ApiError.validation(
          'Versiunea strategică trimisă intră în conflict cu cea a campaniei.',
        );
      }
    }
  } else if (input.strategyVersionExternalKey) {
    strategyVersionId = await idByColumn(
      'strategy_versions',
      'external_key',
      input.strategyVersionExternalKey,
      connection,
    );
    if (!strategyVersionId) throw ApiError.validation('Versiunea strategică nu a fost găsită.');
  } else {
    const active = await queryOne<{ id: string }>(
      "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1",
      [],
      connection,
    );
    if (!active) throw ApiError.validation('Nu există o versiune strategică activă.');
    strategyVersionId = active.id;
  }

  const statusId = await idByColumn('campaign_statuses', 'code', input.statusCode, connection);
  if (!statusId) throw ApiError.validation(`Stadiul „${input.statusCode}” nu există.`);

  const implementationModeId = input.implementationModeCode
    ? await idByColumn('implementation_modes', 'code', input.implementationModeCode, connection)
    : null;

  // Pillar only applies when there is no campaign to inherit the frame from.
  let pillarId: string | null = null;
  if (!campaignId && input.pillarCode) {
    const row = await queryOne<{ id: string }>(
      'SELECT id FROM strategic_pillars WHERE strategy_version_id = ? AND code = ?',
      [strategyVersionId, input.pillarCode],
      connection,
    );
    pillarId = row?.id ?? null;
  }

  return { campaignId, strategyVersionId: strategyVersionId!, statusId, implementationModeId, pillarId };
}

const WRITE_COLUMNS = [
  'strategy_version_id', 'campaign_id', 'pillar_id', 'title', 'start_date', 'end_date',
  'status_id', 'responsible', 'planned_budget', 'actual_spend', 'implementation_mode_id',
  'implementation_partners', 'objective', 'products', 'zone', 'message', 'landing_url',
  'result_summary', 'what_worked', 'recommendation', 'source_created_at_raw', 'source_updated_at_raw',
] as const;

function writeValues(input: ActivationInputType, ctx: ResolvedContext, timestamp: string) {
  return [
    ctx.strategyVersionId,
    ctx.campaignId,
    ctx.pillarId,
    input.title,
    input.startDate,
    input.endDate,
    ctx.statusId,
    input.responsible,
    input.plannedBudget,
    input.actualSpend,
    ctx.implementationModeId,
    input.implementationPartners,
    input.objective,
    JSON.stringify(input.products ?? []),
    input.zone,
    input.message,
    input.landingUrl,
    input.resultSummary,
    input.whatWorked,
    input.recommendation,
    timestamp,
    timestamp,
  ];
}

async function replaceChildren(
  activationId: string,
  input: ActivationInputType,
  userId: string | null,
  connection: PoolConnection,
): Promise<void> {
  // Audiences and funding have no stable external ids, so they are replaced for
  // this activation only — never globally.
  await execute('DELETE FROM activation_audiences WHERE activation_id = ?', [activationId], connection);
  for (const [index, audience] of input.audiences.entries()) {
    let segmentId: string | null = null;
    if (audience.code) {
      segmentId = await idByColumn('audience_segments', 'code', audience.code, connection);
      if (!segmentId) throw ApiError.validation(`Publicul „${audience.code}” nu există.`);
    }
    await execute(
      `INSERT INTO activation_audiences
         (id, activation_id, audience_segment_id, custom_label, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [newId(), activationId, segmentId, segmentId ? null : audience.customLabel!.trim(), index, userId],
      connection,
    );
  }

  await execute(
    'DELETE FROM activation_funding_sources WHERE activation_id = ?',
    [activationId],
    connection,
  );
  for (const [index, source] of input.fundingSources.entries()) {
    const typeId = await idByColumn('funding_types', 'code', source.typeCode, connection);
    if (!typeId) throw ApiError.validation(`Tipul de finanțare „${source.typeCode}” nu există.`);
    await execute(
      `INSERT INTO activation_funding_sources
         (id, activation_id, funding_type_id, custom_label, amount, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [newId(), activationId, typeId, source.label, source.amount, index, userId],
      connection,
    );
  }

  // KPIs are upserted by their scoped external key (see KNOWN_DEVIATIONS D-001).
  const keptKpis: string[] = [];
  for (const [index, kpi] of input.kpis.entries()) {
    if (!kpi.name.trim()) continue;
    const externalKey = kpi.id ?? `${activationId}::kpi-${newId()}`;
    keptKpis.push(externalKey);
    const existing = await idByColumn('activation_kpis', 'external_key', externalKey, connection);
    const values = [
      kpi.enabled ? 1 : 0, kpi.name, kpi.target, kpi.result, kpi.source, kpi.collection, index,
    ];
    if (existing) {
      await execute(
        `UPDATE activation_kpis SET enabled = ?, name = ?, target_text = ?, result_text = ?,
                source_text = ?, collection_text = ?, sort_order = ?, updated_by = ?
          WHERE id = ?`,
        [...values, userId, existing],
        connection,
      );
    } else {
      await execute(
        `INSERT INTO activation_kpis
           (id, external_key, activation_id, enabled, name, target_text, result_text,
            source_text, collection_text, sort_order, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [newId(), externalKey, activationId, ...values, userId],
        connection,
      );
    }
  }
  // KPIs removed in the editor are soft-deleted, keeping history intact.
  await execute(
    `UPDATE activation_kpis SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
      WHERE activation_id = ? AND deleted_at IS NULL
        ${keptKpis.length ? `AND external_key NOT IN (${keptKpis.map(() => '?').join(', ')})` : ''}`,
    [userId, activationId, ...keptKpis],
    connection,
  );

  // Materials are upserted and never hard-deleted: performance snapshots
  // reference them and the history must survive (spec 35.1.4).
  const keptMaterials: string[] = [];
  for (const material of input.materials) {
    if (!material.title.trim()) continue;
    const externalKey = material.id ?? newExternalKey('material');
    keptMaterials.push(externalKey);

    const channelId = material.channel
      ? await queryOne<{ id: string }>(
          'SELECT id FROM activation_channels WHERE label = ? OR code = ?',
          [material.channel, material.channel],
          connection,
        ).then((row) => row?.id ?? null)
      : null;

    const values = [
      material.title, channelId, material.channel, material.otherChannel, material.format,
      material.budgetAllocated, material.runStartDate, material.runEndDate,
      material.visualName, material.copy, material.publicUrl,
    ];

    const existing = await idByColumn('activation_materials', 'external_key', externalKey, connection);
    if (existing) {
      await execute(
        `UPDATE activation_materials
            SET title = ?, channel_id = ?, channel_raw = ?, other_channel = ?, format_text = ?,
                budget_allocated = ?, run_start_date = ?, run_end_date = ?, visual_name = ?,
                copy_text = ?, public_url = ?, deleted_at = NULL, updated_by = ?
          WHERE id = ?`,
        [...values, userId, existing],
        connection,
      );
    } else {
      await execute(
        `INSERT INTO activation_materials
           (id, external_key, activation_id, title, channel_id, channel_raw, other_channel,
            format_text, budget_allocated, run_start_date, run_end_date, visual_name,
            copy_text, public_url, visual_canva_url, platform_external_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?)`,
        [newId(), externalKey, activationId, ...values, userId],
        connection,
      );
    }
  }
  await execute(
    `UPDATE activation_materials SET deleted_at = CURRENT_TIMESTAMP(6), deleted_by = ?
      WHERE activation_id = ? AND deleted_at IS NULL
        ${keptMaterials.length ? `AND external_key NOT IN (${keptMaterials.map(() => '?').join(', ')})` : ''}`,
    [userId, activationId, ...keptMaterials],
    connection,
  );
}

/** Turns `includeAnnualPlan` into plan relations, creating plans on demand. */
async function materialiseAnnualPlan(
  activationId: string,
  input: ActivationInputType,
  userId: string | null,
  connection: PoolConnection,
): Promise<void> {
  const years = input.includeAnnualPlan ? overlappedYears(input.startDate, input.endDate) : [];
  const planIds: string[] = [];

  for (const year of years) {
    let plan = await queryOne<{ id: string; deleted_at: string | null }>(
      'SELECT id, deleted_at FROM annual_plans WHERE year = ?',
      [year],
      connection,
    );
    if (plan?.deleted_at) {
      await execute('UPDATE annual_plans SET deleted_at = NULL WHERE id = ?', [plan.id], connection);
    }
    if (!plan) {
      const id = newId();
      await execute(
        'INSERT INTO annual_plans (id, external_key, year, created_by) VALUES (?, ?, ?, ?)',
        [id, String(year), year, userId],
        connection,
      );
      plan = { id, deleted_at: null };
    }
    planIds.push(plan.id);
    await execute(
      `INSERT INTO annual_plan_activations (annual_plan_id, activation_id, created_by)
       VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE annual_plan_id = annual_plan_id`,
      [plan.id, activationId, userId],
      connection,
    );
  }

  // Years no longer covered lose their relation; the plan itself stays.
  await execute(
    `DELETE FROM annual_plan_activations
      WHERE activation_id = ?
        ${planIds.length ? `AND annual_plan_id NOT IN (${planIds.map(() => '?').join(', ')})` : ''}`,
    [activationId, ...planIds],
    connection,
  );
}

export async function createActivation(
  input: ActivationInputType,
  userId: string | null,
): Promise<{ externalKey: string }> {
  if (endsBeforeStart(input)) {
    throw ApiError.validation('Data de final trebuie să fie după data de început.');
  }

  return withTransaction(async (connection) => {
    const ctx = await resolveContext(input, connection, { requireActiveCampaign: true });
    const id = newId();
    const externalKey = newExternalKey('activation');
    const timestamp = new Date().toISOString();

    await execute(
      `INSERT INTO activations (id, external_key, ${WRITE_COLUMNS.join(', ')}, created_by)
       VALUES (?, ?, ${WRITE_COLUMNS.map(() => '?').join(', ')}, ?)`,
      [id, externalKey, ...writeValues(input, ctx, timestamp), userId],
      connection,
    );

    await replaceChildren(id, input, userId, connection);
    await materialiseAnnualPlan(id, input, userId, connection);

    await writeAudit(
      { userId, action: 'CREATE', entityType: 'ACTIVATION', entityId: id,
        entityExternalKey: externalKey, newValues: { title: input.title, status: input.statusCode } },
      connection,
    );

    return { externalKey };
  });
}

export async function updateActivation(
  externalKey: string,
  input: ActivationInputType,
  expectedVersion: number | null,
  userId: string | null,
): Promise<void> {
  if (endsBeforeStart(input)) {
    throw ApiError.validation('Data de final trebuie să fie după data de început.');
  }

  return withTransaction(async (connection) => {
    const existing = await queryOne<{ id: string; version_number: number; title: string }>(
      'SELECT id, version_number, title FROM activations WHERE external_key = ? AND deleted_at IS NULL',
      [externalKey],
      connection,
    );
    if (!existing) throw ApiError.notFound('Activarea nu a fost găsită.');

    // Editing an existing activation does not re-check campaign status: a
    // historical activation may legitimately belong to a CLOSED campaign.
    const ctx = await resolveContext(input, connection, { requireActiveCampaign: false });
    const timestamp = new Date().toISOString();

    const guard = expectedVersion === null ? '' : ' AND version_number = ?';
    const result = await execute(
      `UPDATE activations SET ${WRITE_COLUMNS.map((c) => `${c} = ?`).join(', ')},
              version_number = version_number + 1, updated_by = ?
        WHERE id = ?${guard}`,
      [
        ...writeValues(input, ctx, timestamp),
        userId,
        existing.id,
        ...(expectedVersion === null ? [] : [expectedVersion]),
      ],
      connection,
    );

    if (result.affectedRows === 0) {
      throw new ApiError(
        'STALE_VERSION',
        'Activarea a fost modificată de alt utilizator. Reîncarcă datele înainte de salvare.',
      );
    }

    await replaceChildren(existing.id, input, userId, connection);
    await materialiseAnnualPlan(existing.id, input, userId, connection);

    await writeAudit(
      { userId, action: 'UPDATE', entityType: 'ACTIVATION', entityId: existing.id,
        entityExternalKey: externalKey,
        oldValues: { title: existing.title },
        newValues: { title: input.title, status: input.statusCode } },
      connection,
    );
  });
}

/** Channels available to materials, for the editor's dropdown. */
export async function listActivationChannels() {
  return queryRows(
    'SELECT code, label FROM activation_channels WHERE is_active = 1 ORDER BY sort_order, label',
  );
}
