/**
 * Strategy API — spec section 15.
 *
 * `Repere strategice` is a shared screen: everyone reads it, ADMIN also edits.
 * Codes are unique per strategy version, never globally, so every write is
 * scoped to a version.
 *
 * History is protected: a version that campaigns already point at cannot be
 * repurposed, and a used pillar/program/objective cannot be deleted — it is
 * deactivated instead (spec 35.1.4).
 */
import { Router } from 'express';
import { z } from 'zod';

import { execute, queryOne, queryRows, withTransaction } from '../database/db';
import { newId } from '../shared/ids';
import { requireAuth, requireRole } from '../auth/middleware';
import { ApiError, asyncHandler, sendData } from '../shared/http';
import { writeAudit } from '../audit/audit-service';

export const strategyRouter = Router();

const requireAdmin = requireRole('ADMIN');

/** Strategy versions with usage counts, newest horizon first. */
strategyRouter.get(
  '/strategy/versions',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const rows = await queryRows(
      `SELECT sv.external_key AS id, sv.label, sv.status,
              sv.period_start_year AS periodStartYear, sv.period_end_year AS periodEndYear,
              sv.notes,
              (SELECT COUNT(*) FROM campaigns c
                WHERE c.strategy_version_id = sv.id AND c.deleted_at IS NULL) AS campaignCount,
              (SELECT COUNT(*) FROM strategic_pillars p WHERE p.strategy_version_id = sv.id) AS pillarCount,
              (SELECT COUNT(*) FROM strategic_programs p WHERE p.strategy_version_id = sv.id) AS programCount,
              (SELECT COUNT(*) FROM strategic_objectives o WHERE o.strategy_version_id = sv.id) AS objectiveCount
         FROM strategy_versions sv
        ORDER BY sv.period_start_year DESC`,
    );
    sendData(res, rows);
  }),
);

/** Full strategic content of one version, or of the ACTIVE one by default. */
strategyRouter.get(
  '/strategy',
  requireAuth,
  asyncHandler(async (req, res) => {
    const requested = req.query.version ? String(req.query.version) : null;

    const version = await queryOne<{ id: string; external_key: string; label: string; status: string }>(
      requested
        ? 'SELECT id, external_key, label, status FROM strategy_versions WHERE external_key = ?'
        : "SELECT id, external_key, label, status FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1",
      requested ? [requested] : [],
    );
    if (!version) throw ApiError.notFound('Versiunea strategică nu a fost găsită.');

    // Usage counts drive the delete/deactivate affordances in the Admin UI.
    const pillars = await queryRows(
      `SELECT p.code, p.label, p.display_label AS displayLabel, p.hint, p.is_active AS isActive,
              p.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM campaigns c WHERE c.pillar_id = p.id) AS usageCount
         FROM strategic_pillars p WHERE p.strategy_version_id = ? ORDER BY p.sort_order`,
      [version.id],
    );

    const programs = await queryRows(
      `SELECT p.code, p.name, p.label, p.result_text AS result,
              p.marketing_objective AS marketingObjective, p.approach,
              p.horizon_result_text AS horizonResult, p.target_groups_text AS targetGroups,
              p.kpi_text AS kpiText, p.sources_text AS sources, p.annual_actions AS annualActions,
              p.validation_status AS validationStatus, p.is_active AS isActive,
              p.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM campaign_programs cp WHERE cp.program_id = p.id) AS usageCount
         FROM strategic_programs p WHERE p.strategy_version_id = ? ORDER BY p.sort_order`,
      [version.id],
    );

    const objectives = await queryRows(
      `SELECT o.code, o.name, o.label, o.source, o.is_active AS isActive, o.sort_order AS sortOrder,
              (SELECT COUNT(*) FROM campaign_objectives co WHERE co.objective_id = o.id) AS usageCount
         FROM strategic_objectives o WHERE o.strategy_version_id = ? ORDER BY o.sort_order`,
      [version.id],
    );

    const programObjectives = await queryRows(
      `SELECT p.code AS programCode, o.code AS objectiveCode
         FROM strategic_program_objectives spo
         JOIN strategic_programs p ON p.id = spo.program_id
         JOIN strategic_objectives o ON o.id = spo.objective_id
        WHERE p.strategy_version_id = ? ORDER BY spo.sort_order`,
      [version.id],
    );

    sendData(res, {
      version: {
        id: version.external_key,
        label: version.label,
        status: version.status,
      },
      pillars,
      programs,
      objectives,
      programObjectives,
    });
  }),
);

const PillarInput = z.object({
  label: z.string().trim().min(1, 'Denumirea este obligatorie.'),
  displayLabel: z.string().default(''),
  hint: z.string().default(''),
});

const ObjectiveInput = z.object({
  name: z.string().trim().min(1, 'Denumirea este obligatorie.'),
  label: z.string().default(''),
  source: z.string().default(''),
});

const ProgramInput = z.object({
  name: z.string().trim().min(1, 'Denumirea este obligatorie.'),
  label: z.string().default(''),
  result: z.string().default(''),
  marketingObjective: z.string().default(''),
  approach: z.string().default(''),
  horizonResult: z.string().default(''),
  targetGroups: z.string().default(''),
  kpiText: z.string().default(''),
  sources: z.string().default(''),
  annualActions: z.string().default(''),
  validationStatus: z.string().default(''),
});

type StrategicTable = 'strategic_pillars' | 'strategic_programs' | 'strategic_objectives';

async function versionIdFor(externalKey: string): Promise<string> {
  const row = await queryOne<{ id: string }>(
    'SELECT id FROM strategy_versions WHERE external_key = ?',
    [externalKey],
  );
  if (!row) throw ApiError.notFound('Versiunea strategică nu a fost găsită.');
  return row.id;
}

/** Edits a strategic record in place. Codes are never rewritten. */
async function updateStrategicRecord(
  table: StrategicTable,
  versionKey: string,
  code: string,
  columns: Record<string, string>,
  userId: string | null,
): Promise<void> {
  const versionId = await versionIdFor(versionKey);
  const names = Object.keys(columns);

  const result = await execute(
    `UPDATE ${table} SET ${names.map((name) => `${name} = ?`).join(', ')}, updated_by = ?
      WHERE strategy_version_id = ? AND code = ?`,
    [...names.map((name) => columns[name]!), userId, versionId, code],
  );

  if (result.affectedRows === 0) throw ApiError.notFound(`Reperul ${code} nu a fost găsit.`);

  await writeAudit({
    userId,
    action: 'STRATEGY_CHANGE',
    entityType: table.toUpperCase(),
    entityExternalKey: `${versionKey}:${code}`,
    newValues: columns,
  });
}

strategyRouter.put(
  '/strategy/:versionKey/pillars/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = PillarInput.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele pilonului nu sunt valide.', parsed.error.issues);

    await updateStrategicRecord(
      'strategic_pillars',
      String(req.params.versionKey),
      String(req.params.code),
      {
        label: parsed.data.label,
        display_label: parsed.data.displayLabel || parsed.data.label,
        hint: parsed.data.hint,
      },
      req.user?.id ?? null,
    );
    sendData(res, { ok: true });
  }),
);

strategyRouter.put(
  '/strategy/:versionKey/objectives/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = ObjectiveInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele obiectivului nu sunt valide.', parsed.error.issues);
    }

    await updateStrategicRecord(
      'strategic_objectives',
      String(req.params.versionKey),
      String(req.params.code),
      {
        name: parsed.data.name,
        label: parsed.data.label || parsed.data.name,
        source: parsed.data.source,
      },
      req.user?.id ?? null,
    );
    sendData(res, { ok: true });
  }),
);

strategyRouter.put(
  '/strategy/:versionKey/programs/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = ProgramInput.safeParse(req.body);
    if (!parsed.success) {
      throw ApiError.validation('Datele programului nu sunt valide.', parsed.error.issues);
    }

    const d = parsed.data;
    await updateStrategicRecord(
      'strategic_programs',
      String(req.params.versionKey),
      String(req.params.code),
      {
        name: d.name,
        label: d.label || d.name,
        result_text: d.result,
        marketing_objective: d.marketingObjective,
        approach: d.approach,
        horizon_result_text: d.horizonResult,
        target_groups_text: d.targetGroups,
        kpi_text: d.kpiText,
        sources_text: d.sources,
        annual_actions: d.annualActions,
        validation_status: d.validationStatus,
      },
      req.user?.id ?? null,
    );
    sendData(res, { ok: true });
  }),
);

/**
 * Deactivate rather than delete.
 *
 * A used strategic record must stay resolvable for historical campaigns, so
 * deactivation is the only reversible way to retire it (spec 35.1.4).
 */
strategyRouter.post(
  '/strategy/:versionKey/:kind/:code/toggle-active',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const kinds: Record<string, StrategicTable> = {
      pillars: 'strategic_pillars',
      programs: 'strategic_programs',
      objectives: 'strategic_objectives',
    };
    const table = kinds[String(req.params.kind)];
    if (!table) throw ApiError.notFound('Tip de reper necunoscut.');

    const versionId = await versionIdFor(String(req.params.versionKey));
    const code = String(req.params.code);

    const row = await queryOne<{ id: string; is_active: number }>(
      `SELECT id, is_active FROM ${table} WHERE strategy_version_id = ? AND code = ?`,
      [versionId, code],
    );
    if (!row) throw ApiError.notFound(`Reperul ${code} nu a fost găsit.`);

    const next = row.is_active === 1 ? 0 : 1;
    await execute(`UPDATE ${table} SET is_active = ?, updated_by = ? WHERE id = ?`, [
      next,
      req.user?.id ?? null,
      row.id,
    ]);

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'STRATEGY_CHANGE',
      entityType: table.toUpperCase(),
      entityId: row.id,
      entityExternalKey: code,
      newValues: { isActive: next === 1 },
    });

    sendData(res, { code, isActive: next === 1 });
  }),
);

/**
 * Activates a strategy version.
 *
 * Exactly one version is ACTIVE; the previous one is archived rather than
 * deleted, so historical campaigns keep pointing at a version that still
 * exists (spec 33.4.1).
 */
strategyRouter.post(
  '/strategy/versions/:versionKey/activate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const versionKey = String(req.params.versionKey);
    const userId = req.user?.id ?? null;

    await withTransaction(async (connection) => {
      const version = await queryOne<{ id: string; status: string }>(
        'SELECT id, status FROM strategy_versions WHERE external_key = ?',
        [versionKey],
        connection,
      );
      if (!version) throw ApiError.notFound('Versiunea strategică nu a fost găsită.');
      if (version.status === 'ACTIVE') return;

      await execute(
        "UPDATE strategy_versions SET status = 'ARCHIVED', updated_by = ? WHERE status = 'ACTIVE'",
        [userId],
        connection,
      );
      await execute(
        "UPDATE strategy_versions SET status = 'ACTIVE', updated_by = ? WHERE id = ?",
        [userId, version.id],
        connection,
      );

      await writeAudit(
        { userId, action: 'STRATEGY_CHANGE', entityType: 'STRATEGY_VERSION',
          entityId: version.id, entityExternalKey: versionKey,
          newValues: { status: 'ACTIVE' } },
        connection,
      );
    });

    sendData(res, { id: versionKey, status: 'ACTIVE' });
  }),
);

/** New strategy version. Created DRAFT — activation is a separate decision. */
strategyRouter.post(
  '/strategy/versions',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const Input = z.object({
      externalKey: z.string().trim().min(1, 'Cheia versiunii este obligatorie.'),
      label: z.string().trim().min(1, 'Denumirea este obligatorie.'),
      periodStartYear: z.number().int(),
      periodEndYear: z.number().int(),
      notes: z.string().default(''),
    });

    const parsed = Input.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele versiunii nu sunt valide.', parsed.error.issues);
    if (parsed.data.periodEndYear < parsed.data.periodStartYear) {
      throw ApiError.validation('Anul de final trebuie să fie după anul de început.');
    }

    const existing = await queryOne(
      'SELECT id FROM strategy_versions WHERE external_key = ?',
      [parsed.data.externalKey],
    );
    if (existing) throw new ApiError('CONFLICT', 'Există deja o versiune cu această cheie.');

    const id = newId();
    await execute(
      `INSERT INTO strategy_versions
         (id, external_key, label, period_start_year, period_end_year, status, notes, created_by)
       VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, ?)`,
      [
        id,
        parsed.data.externalKey,
        parsed.data.label,
        parsed.data.periodStartYear,
        parsed.data.periodEndYear,
        parsed.data.notes,
        req.user?.id ?? null,
      ],
    );

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'STRATEGY_CHANGE',
      entityType: 'STRATEGY_VERSION',
      entityId: id,
      entityExternalKey: parsed.data.externalKey,
      newValues: { status: 'DRAFT' },
    });

    res.status(201);
    sendData(res, { id: parsed.data.externalKey, status: 'DRAFT' });
  }),
);
