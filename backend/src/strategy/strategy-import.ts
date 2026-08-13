/**
 * Strategy bootstrap from an OMD_CAMPAIGNS_PACKAGE.
 *
 * Spec sections 33.4 / 33.4.1 and the Architecture Risk Review: strategic codes
 * are unique per `strategy_version_id`, not globally. `OS2` may legitimately
 * mean one thing in 2026-2028 and something else in 2029-2033, and a historical
 * campaign must keep pointing at the meaning it was written against.
 *
 * A new horizon therefore never rewrites the old one:
 *   first version ever  -> created ACTIVE
 *   a version is active -> the new one is created DRAFT until Admin activates it
 */
import { execute, queryOne } from '../database/db';
import { newId } from '../shared/ids';
import type { ImportContext } from '../imports/import-context';

export interface StrategyVersionPayload {
  externalKey: string;
  label: string;
  periodStartYear: number;
  periodEndYear: number;
}

export interface PillarPayload {
  code: string;
  label: string;
  displayLabel?: string | null;
  hint?: string | null;
}

export interface ProgramPayload {
  code: string;
  name: string;
  result: string;
  objectiveCodes?: string[];
  marketingObjective: string;
  approach: string;
  /** Contract keeps the 2028-era name; DB column is horizon-neutral. */
  result2028: string;
  targetGroupsText: string;
  kpiText: string;
  sourcesText: string;
  annualActions: string;
  validationStatus: string;
  label: string;
}

export interface ObjectivePayload {
  code: string;
  name: string;
  source: string;
  label: string;
}

export interface StrategicDataPayload {
  strategyVersion: StrategyVersionPayload;
  pillars: PillarPayload[];
  programs: ProgramPayload[];
  objectives: ObjectivePayload[];
}

export interface StrategyMaps {
  strategyVersionId: string;
  strategyVersionExternalKey: string;
  pillars: Map<string, string>;
  programs: Map<string, string>;
  objectives: Map<string, string>;
}

async function getOrCreateStrategyVersion(
  payload: StrategyVersionPayload,
  ctx: ImportContext,
): Promise<string> {
  const existing = await queryOne<{ id: string; label: string }>(
    'SELECT id, label FROM strategy_versions WHERE external_key = ?',
    [payload.externalKey],
    ctx.connection,
  );

  if (existing) {
    if (existing.label !== payload.label) {
      ctx.warn(
        `Versiune strategică ${payload.externalKey}: denumire diferită ` +
          `(în aplicație „${existing.label}”, în pachet „${payload.label}”). Nu a fost suprascrisă.`,
      );
    }
    await ctx.recordItem('strategy_versions', payload.externalKey, existing.id, 'UNCHANGED');
    return existing.id;
  }

  const active = await queryOne<{ total: number }>(
    "SELECT COUNT(*) AS total FROM strategy_versions WHERE status = 'ACTIVE'",
    [],
    ctx.connection,
  );
  const status = (active?.total ?? 0) === 0 ? 'ACTIVE' : 'DRAFT';

  const id = newId();
  await execute(
    `INSERT INTO strategy_versions
       (id, external_key, label, period_start_year, period_end_year, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      payload.externalKey,
      payload.label,
      payload.periodStartYear,
      payload.periodEndYear,
      status,
      ctx.userId,
    ],
    ctx.connection,
  );

  if (status === 'DRAFT') {
    ctx.warn(
      `Versiunea strategică ${payload.externalKey} a fost creată ca DRAFT deoarece există deja ` +
        `o versiune ACTIVE. Activarea se face explicit de Admin.`,
    );
  }

  await ctx.recordItem('strategy_versions', payload.externalKey, id, 'CREATE', `status=${status}`);
  return id;
}

/**
 * Upserts a strategic table scoped to one strategy version.
 * Table name comes from the caller's literal union, never from input.
 */
async function upsertScoped(
  table: 'strategic_pillars' | 'strategic_programs' | 'strategic_objectives',
  strategyVersionId: string,
  code: string,
  columns: Record<string, string | number | null>,
  ctx: ImportContext,
): Promise<{ id: string; created: boolean }> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM ${table} WHERE strategy_version_id = ? AND code = ?`,
    [strategyVersionId, code],
    ctx.connection,
  );

  if (existing) {
    await ctx.recordItem(table, code, existing.id, 'UNCHANGED');
    return { id: existing.id, created: false };
  }

  const id = newId();
  const names = Object.keys(columns);
  await execute(
    `INSERT INTO ${table} (id, strategy_version_id, code, ${names.join(', ')}, created_by)
     VALUES (?, ?, ?, ${names.map(() => '?').join(', ')}, ?)`,
    [id, strategyVersionId, code, ...names.map((name) => columns[name]!), ctx.userId],
    ctx.connection,
  );

  await ctx.recordItem(table, code, id, 'CREATE');
  return { id, created: true };
}

export async function importStrategicData(
  data: StrategicDataPayload,
  ctx: ImportContext,
): Promise<StrategyMaps> {
  const strategyVersionId = await getOrCreateStrategyVersion(data.strategyVersion, ctx);

  const pillars = new Map<string, string>();
  for (const [index, pillar] of data.pillars.entries()) {
    const { id } = await upsertScoped(
      'strategic_pillars',
      strategyVersionId,
      pillar.code,
      {
        label: pillar.label,
        display_label: pillar.displayLabel ?? pillar.label,
        hint: pillar.hint ?? '',
        sort_order: index,
      },
      ctx,
    );
    pillars.set(pillar.code, id);
  }

  const objectives = new Map<string, string>();
  for (const [index, objective] of data.objectives.entries()) {
    const { id } = await upsertScoped(
      'strategic_objectives',
      strategyVersionId,
      objective.code,
      {
        name: objective.name,
        source: objective.source,
        label: objective.label,
        sort_order: index,
      },
      ctx,
    );
    objectives.set(objective.code, id);
  }

  const programs = new Map<string, string>();
  for (const [index, program] of data.programs.entries()) {
    const { id, created } = await upsertScoped(
      'strategic_programs',
      strategyVersionId,
      program.code,
      {
        name: program.name,
        result_text: program.result,
        marketing_objective: program.marketingObjective,
        approach: program.approach,
        horizon_result_text: program.result2028,
        target_groups_text: program.targetGroupsText,
        kpi_text: program.kpiText,
        sources_text: program.sourcesText,
        annual_actions: program.annualActions,
        validation_status: program.validationStatus,
        label: program.label,
        sort_order: index,
      },
      ctx,
    );
    programs.set(program.code, id);

    if (!created) continue;

    for (const [position, objectiveCode] of (program.objectiveCodes ?? []).entries()) {
      const objectiveId = objectives.get(objectiveCode);
      if (!objectiveId) {
        throw new Error(
          `strategicData.programs[${index}].objectiveCodes: obiectiv inexistent în această ` +
            `versiune strategică: ${objectiveCode}`,
        );
      }
      await execute(
        `INSERT INTO strategic_program_objectives (program_id, objective_id, sort_order, created_by)
         VALUES (?, ?, ?, ?)`,
        [id, objectiveId, position, ctx.userId],
        ctx.connection,
      );
    }
  }

  return {
    strategyVersionId,
    strategyVersionExternalKey: data.strategyVersion.externalKey,
    pillars,
    programs,
    objectives,
  };
}
