/**
 * Campaign create and update.
 *
 * Rules enforced here (spec sections 17, 18, 8.3):
 *   - the server generates `id` (UUID) and `external_key`; the client never does;
 *   - `external_key` is immutable — editing never regenerates it (rule 67.4);
 *   - a manually created campaign belongs to the ACTIVE strategy version;
 *   - programs/objectives/pillars resolve WITHIN that strategy version;
 *   - update is atomic: the row and all four relation sets move together;
 *   - update is guarded by `version_number` (If-Match), returning 409
 *     STALE_VERSION rather than silently overwriting a concurrent edit.
 */
import { z } from 'zod';

import type { PoolConnection } from 'mysql2/promise';

import { execute, queryOne, withTransaction } from '../database/db';
import { newExternalKey, newId } from '../shared/ids';
import { ApiError } from '../shared/http';
import { writeAudit } from '../audit/audit-service';

/**
 * Input contract for the wizard.
 *
 * Required fields mirror the prototype's per-step validation so the API cannot
 * be used to create a campaign the UI would have rejected.
 */
export const CampaignInput = z.object({
  // Step 1 — Identificare
  title: z.string().trim().min(1, 'Denumirea este obligatorie.'),
  campaignTypeCode: z.string().min(1, 'Tipul campaniei este obligatoriu.'),
  pillarCode: z.string().min(1, 'Pilonul este obligatoriu.'),
  seasonalityTypeCode: z.string().min(1, 'Tipul de sezonalitate este obligatoriu.'),
  seasonalityMonths: z
    .array(z.number().int().min(1).max(12))
    .min(1, 'Selectează cel puțin o lună de relevanță.'),
  seasonalityNote: z.string().default(''),
  statusCode: z.string().default('DRAFT'),
  responsible: z.string().default(''),
  accent: z.string().default('umbrella'),
  version: z.string().default(''),
  parentCampaignExternalKey: z.string().nullable().default(null),
  campaignFamilyExternalKey: z.string().optional(),

  // Step 2 — Încadrare strategică
  programPrimaryCode: z.string().min(1, 'Programul principal este obligatoriu.'),
  programSecondaryCodes: z.array(z.string()).default([]),
  objectivePrimaryCode: z.string().min(1, 'Obiectivul principal este obligatoriu.'),
  objectiveSecondaryCodes: z.array(z.string()).default([]),
  marketingObjective: z.string().trim().min(1, 'Obiectivul de marketing este obligatoriu.'),
  directResult: z.string().trim().min(1, 'Rezultatul direct este obligatoriu.'),
  strategicContribution: z.array(z.string()).default([]),

  // Step 3 — Publicuri
  primaryAudienceCode: z.string().min(1, 'Publicul principal este obligatoriu.'),
  secondaryAudienceCodes: z.array(z.string()).default([]),
  primaryAudienceDescription: z.string().default(''),
  insight: z.string().trim().min(1, 'Insight-ul este obligatoriu.'),
  valueProposition: z.string().trim().min(1, 'Propunerea de valoare este obligatorie.'),

  // Step 4 — Concept
  centralIdea: z.string().trim().min(1, 'Ideea centrală este obligatorie.'),
  promise: z.string().trim().min(1, 'Promisiunea este obligatorie.'),
  mainMessage: z.string().trim().min(1, 'Mesajul principal este obligatoriu.'),
  secondaryMessages: z.array(z.string()).default([]),
  storytellingDirections: z.array(z.string()).default([]),
  tone: z.string().default(''),
  ctaCodes: z.array(z.string()).default([]),

  // Step 5 — Produse și măsurare
  products: z.array(z.string()).default([]),
  productsIntro: z.string().default(''),
  productCondition: z.string().default(''),
  channels: z.array(z.string()).default([]),
  prPartnerships: z.string().default(''),
  kpiDefinitions: z
    .array(
      z.object({
        name: z.string().default(''),
        baseline: z.string().default(''),
        target: z.string().default(''),
        source: z.string().default(''),
      }),
    )
    .default([]),

  // Step 6 — Reguli de adaptare
  fixedElements: z.array(z.string()).default([]),
  adaptableElements: z.array(z.string()).default([]),
  adaptationLimits: z.array(z.string()).default([]),
  applicationExamples: z
    .array(
      z.object({
        context: z.string().default(''),
        adaptation: z.string().default(''),
        fixed: z.string().default(''),
      }),
    )
    .default([]),

  // Step 7 — Livrabile
  deliverableIntro: z.string().default(''),
  frameworkDeliverables: z.array(z.record(z.string(), z.unknown())).default([]),
  headlines: z.array(z.record(z.string(), z.unknown())).default([]),
  posts: z.array(z.record(z.string(), z.unknown())).default([]),
  videoConcepts: z.array(z.record(z.string(), z.unknown())).default([]),
  noVisualsNote: z.string().default(''),

  // Step 8 — Exemple de activări
  activationExamples: z
    .object({
      directions: z.array(z.record(z.string(), z.unknown())).default([]),
      simulatedRows: z.array(z.record(z.string(), z.unknown())).default([]),
    })
    .default({ directions: [], simulatedRows: [] }),
});

export type CampaignInputType = z.infer<typeof CampaignInput>;

async function activeStrategyVersion(connection: PoolConnection): Promise<string> {
  const row = await queryOne<{ id: string }>(
    "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1",
    [],
    connection,
  );
  if (!row) {
    throw ApiError.validation(
      'Nu există o versiune strategică activă. Importă un pachet de campanii sau activează o versiune.',
    );
  }
  return row.id;
}

async function resolveCatalog(
  table: string,
  code: string,
  label: string,
  connection: PoolConnection,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE code = ? AND is_active = 1`,
    [code],
    connection,
  );
  if (!row) throw ApiError.validation(`${label}: valoarea „${code}” nu există în nomenclator.`);
  return row.id;
}

async function resolveStrategic(
  table: 'strategic_pillars' | 'strategic_programs' | 'strategic_objectives',
  strategyVersionId: string,
  code: string,
  label: string,
  connection: PoolConnection,
): Promise<string> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE strategy_version_id = ? AND code = ? AND is_active = 1`,
    [strategyVersionId, code],
    connection,
  );
  if (!row) {
    throw ApiError.validation(
      `${label}: codul „${code}” nu există în versiunea strategică a campaniei.`,
    );
  }
  return row.id;
}

/** Column order shared by INSERT and UPDATE so the two cannot drift apart. */
const WRITE_COLUMNS = [
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

interface ResolvedIds {
  campaignTypeId: string;
  statusId: string;
  pillarId: string;
  seasonalityTypeId: string;
}

function writeValues(input: CampaignInputType, ids: ResolvedIds, timestamp: string) {
  const json = (value: unknown) => JSON.stringify(value ?? []);
  return [
    input.title,
    input.accent,
    ids.campaignTypeId,
    ids.statusId,
    ids.pillarId,
    ids.seasonalityTypeId,
    json(input.seasonalityMonths),
    input.seasonalityNote,
    input.version,
    input.responsible,
    input.marketingObjective,
    input.directResult,
    json(input.strategicContribution),
    input.primaryAudienceDescription,
    input.centralIdea,
    input.promise,
    input.mainMessage,
    json(input.secondaryMessages),
    input.tone,
    input.insight,
    input.valueProposition,
    json(input.products),
    input.productsIntro,
    input.productCondition,
    json(input.channels),
    input.prPartnerships,
    json(input.storytellingDirections),
    json(input.fixedElements),
    json(input.adaptableElements),
    json(input.adaptationLimits),
    json(input.frameworkDeliverables),
    input.deliverableIntro,
    json(input.posts),
    json(input.headlines),
    json(input.videoConcepts),
    json(input.applicationExamples),
    json(input.kpiDefinitions),
    JSON.stringify(input.activationExamples ?? { directions: [], simulatedRows: [] }),
    input.noVisualsNote,
    'Creat în aplicație',
    timestamp,
    timestamp,
  ];
}

async function replaceRelations(
  campaignId: string,
  input: CampaignInputType,
  strategyVersionId: string,
  userId: string | null,
  connection: PoolConnection,
): Promise<void> {
  for (const table of ['campaign_programs', 'campaign_objectives', 'campaign_audiences', 'campaign_ctas']) {
    await execute(`DELETE FROM ${table} WHERE campaign_id = ?`, [campaignId], connection);
  }

  const program = await resolveStrategic(
    'strategic_programs', strategyVersionId, input.programPrimaryCode, 'Program principal', connection,
  );
  await execute(
    `INSERT INTO campaign_programs (campaign_id, program_id, relation_role, sort_order, created_by)
     VALUES (?, ?, 'PRIMARY', 0, ?)`,
    [campaignId, program, userId],
    connection,
  );
  for (const [index, code] of input.programSecondaryCodes.entries()) {
    if (code === input.programPrimaryCode) continue;
    const id = await resolveStrategic('strategic_programs', strategyVersionId, code, 'Program secundar', connection);
    await execute(
      `INSERT INTO campaign_programs (campaign_id, program_id, relation_role, sort_order, created_by)
       VALUES (?, ?, 'SECONDARY', ?, ?)`,
      [campaignId, id, index + 1, userId],
      connection,
    );
  }

  const objective = await resolveStrategic(
    'strategic_objectives', strategyVersionId, input.objectivePrimaryCode, 'Obiectiv principal', connection,
  );
  await execute(
    `INSERT INTO campaign_objectives (campaign_id, objective_id, relation_role, sort_order, created_by)
     VALUES (?, ?, 'PRIMARY', 0, ?)`,
    [campaignId, objective, userId],
    connection,
  );
  for (const [index, code] of input.objectiveSecondaryCodes.entries()) {
    if (code === input.objectivePrimaryCode) continue;
    const id = await resolveStrategic('strategic_objectives', strategyVersionId, code, 'Obiectiv secundar', connection);
    await execute(
      `INSERT INTO campaign_objectives (campaign_id, objective_id, relation_role, sort_order, created_by)
       VALUES (?, ?, 'SECONDARY', ?, ?)`,
      [campaignId, id, index + 1, userId],
      connection,
    );
  }

  const audience = await resolveCatalog('audience_segments', input.primaryAudienceCode, 'Public principal', connection);
  await execute(
    `INSERT INTO campaign_audiences (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
     VALUES (?, ?, 'PRIMARY', 0, ?)`,
    [campaignId, audience, userId],
    connection,
  );
  for (const [index, code] of input.secondaryAudienceCodes.entries()) {
    if (code === input.primaryAudienceCode) continue;
    const id = await resolveCatalog('audience_segments', code, 'Public secundar', connection);
    await execute(
      `INSERT INTO campaign_audiences (campaign_id, audience_segment_id, relation_role, sort_order, created_by)
       VALUES (?, ?, 'SECONDARY', ?, ?)`,
      [campaignId, id, index + 1, userId],
      connection,
    );
  }

  for (const [index, code] of input.ctaCodes.entries()) {
    const id = await resolveCatalog('cta_types', code, 'CTA', connection);
    await execute(
      `INSERT INTO campaign_ctas (campaign_id, cta_type_id, sort_order, created_by) VALUES (?, ?, ?, ?)`,
      [campaignId, id, index, userId],
      connection,
    );
  }
}

export async function createCampaign(
  input: CampaignInputType,
  userId: string | null,
): Promise<{ externalKey: string }> {
  return withTransaction(async (connection) => {
    const strategyVersionId = await activeStrategyVersion(connection);
    const timestamp = new Date().toISOString();

    const ids: ResolvedIds = {
      campaignTypeId: await resolveCatalog('campaign_types', input.campaignTypeCode, 'Tip campanie', connection),
      statusId: await resolveCatalog('campaign_statuses', input.statusCode, 'Stadiu', connection),
      pillarId: await resolveStrategic('strategic_pillars', strategyVersionId, input.pillarCode, 'Pilon', connection),
      seasonalityTypeId: await resolveCatalog('seasonality_types', input.seasonalityTypeCode, 'Sezonalitate', connection),
    };

    let parentId: string | null = null;
    if (input.parentCampaignExternalKey) {
      const parent = await queryOne<{ id: string; strategy_version_id: string }>(
        'SELECT id, strategy_version_id FROM campaigns WHERE external_key = ? AND deleted_at IS NULL',
        [input.parentCampaignExternalKey],
        connection,
      );
      if (!parent) throw ApiError.validation('Campania părinte nu a fost găsită.');
      // parentCampaign expresses architecture within one cycle (spec 17.1).
      if (parent.strategy_version_id !== strategyVersionId) {
        throw ApiError.validation(
          'Campania părinte aparține altei versiuni strategice. Folosește „Continuă în noul ciclu strategic”.',
        );
      }
      parentId = parent.id;
    }

    const id = newId();
    // Server-generated and immutable from here on (spec 8.3).
    const externalKey = newExternalKey('camp');
    const family = input.campaignFamilyExternalKey ?? `family-${externalKey}`;

    await execute(
      `INSERT INTO campaigns
         (id, external_key, campaign_family_external_key, strategy_version_id, parent_campaign_id,
          ${WRITE_COLUMNS.join(', ')}, created_by)
       VALUES (?, ?, ?, ?, ?, ${WRITE_COLUMNS.map(() => '?').join(', ')}, ?)`,
      [id, externalKey, family, strategyVersionId, parentId, ...writeValues(input, ids, timestamp), userId],
      connection,
    );

    await replaceRelations(id, input, strategyVersionId, userId, connection);

    await writeAudit(
      { userId, action: 'CREATE', entityType: 'CAMPAIGN', entityId: id, entityExternalKey: externalKey,
        newValues: { title: input.title, status: input.statusCode } },
      connection,
    );

    return { externalKey };
  });
}

export async function updateCampaign(
  externalKey: string,
  input: CampaignInputType,
  expectedVersion: number | null,
  userId: string | null,
): Promise<void> {
  return withTransaction(async (connection) => {
    const existing = await queryOne<{
      id: string;
      strategy_version_id: string;
      version_number: number;
      title: string;
    }>(
      `SELECT id, strategy_version_id, version_number, title
         FROM campaigns WHERE external_key = ? AND deleted_at IS NULL`,
      [externalKey],
      connection,
    );
    if (!existing) throw ApiError.notFound('Campania nu a fost găsită.');

    const ids: ResolvedIds = {
      campaignTypeId: await resolveCatalog('campaign_types', input.campaignTypeCode, 'Tip campanie', connection),
      statusId: await resolveCatalog('campaign_statuses', input.statusCode, 'Stadiu', connection),
      pillarId: await resolveStrategic(
        'strategic_pillars', existing.strategy_version_id, input.pillarCode, 'Pilon', connection,
      ),
      seasonalityTypeId: await resolveCatalog(
        'seasonality_types', input.seasonalityTypeCode, 'Sezonalitate', connection,
      ),
    };

    const timestamp = new Date().toISOString();
    const assignments = WRITE_COLUMNS.map((column) => `${column} = ?`).join(', ');

    // Optimistic concurrency: the WHERE clause carries the expected version, so
    // a concurrent edit makes this update match zero rows (spec 18).
    const guard = expectedVersion === null ? '' : ' AND version_number = ?';
    const params = [
      ...writeValues(input, ids, timestamp),
      userId,
      existing.id,
      ...(expectedVersion === null ? [] : [expectedVersion]),
    ];

    const result = await execute(
      `UPDATE campaigns SET ${assignments}, version_number = version_number + 1, updated_by = ?
        WHERE id = ?${guard}`,
      params,
      connection,
    );

    if (result.affectedRows === 0) {
      throw new ApiError(
        'STALE_VERSION',
        'Campania a fost modificată de alt utilizator. Reîncarcă datele înainte de salvare.',
      );
    }

    await replaceRelations(existing.id, input, existing.strategy_version_id, userId, connection);

    await writeAudit(
      { userId, action: 'UPDATE', entityType: 'CAMPAIGN', entityId: existing.id,
        entityExternalKey: externalKey,
        oldValues: { title: existing.title },
        newValues: { title: input.title, status: input.statusCode } },
      connection,
    );
  });
}
