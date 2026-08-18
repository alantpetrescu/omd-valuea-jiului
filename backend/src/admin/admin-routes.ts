/**
 * Admin API — users, catalogs, audit, import history.
 *
 * The deletion policy in spec 35.1 is the important part here:
 *
 *   is_system                -> 409 SYSTEM_VALUE_PROTECTED, never deletable
 *   non-system, 0 references -> physical DELETE allowed
 *   non-system, referenced   -> 409 ENTITY_IN_USE, deactivate instead
 *
 * Reference counts include CLOSED, inactive and soft-deleted rows: anything
 * that physically still holds the reference. Counting only visible rows would
 * let a delete break history.
 */
import { Router } from 'express';
import { z } from 'zod';

import { execute, isMysqlError, limitClause, MYSQL_ERROR, queryOne, queryRows } from '../database/db';
import { newId } from '../shared/ids';
import { hashPassword } from '../shared/password';
import { requireRole, type RoleCode } from '../auth/middleware';
import { ApiError, asyncHandler, pageMeta, readPagination, sendData } from '../shared/http';
import { writeAudit } from '../audit/audit-service';
import { MASTER_CATALOGS, type MasterCatalog } from '../catalogs/system-master-registry';

export const adminRouter = Router();

const requireAdmin = requireRole('ADMIN');

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

adminRouter.get(
  '/admin/users',
  requireAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await queryRows(
      `SELECT u.id, u.name, u.email, r.code AS role, u.is_active AS isActive,
              u.must_change_password AS mustChangePassword, u.last_login_at AS lastLoginAt,
              u.created_at AS createdAt
         FROM users u JOIN roles r ON r.id = u.role_id
        ORDER BY u.name`,
    );
    sendData(res, rows);
  }),
);

const UserInput = z.object({
  name: z.string().trim().min(1, 'Numele este obligatoriu.'),
  email: z.string().email('Adresa de e-mail nu este validă.'),
  role: z.enum(['ADMIN', 'EDITOR', 'VIEWER']),
  password: z.string().min(10, 'Parola temporară trebuie să aibă minimum 10 caractere.').optional(),
});

adminRouter.post(
  '/admin/users',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = UserInput.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele utilizatorului nu sunt valide.', parsed.error.issues);
    if (!parsed.data.password) throw ApiError.validation('Parola temporară este obligatorie.');

    const existing = await queryOne('SELECT id FROM users WHERE email = ?', [parsed.data.email]);
    if (existing) throw new ApiError('CONFLICT', 'Există deja un utilizator cu acest e-mail.');

    const role = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', [parsed.data.role]);
    if (!role) throw ApiError.validation('Rol inexistent.');

    const id = newId();
    // The user is forced to replace the temporary password at first login.
    await execute(
      `INSERT INTO users (id, role_id, name, email, password_hash, is_active, must_change_password, created_by)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?)`,
      [id, role.id, parsed.data.name, parsed.data.email, await hashPassword(parsed.data.password), req.user?.id ?? null],
    );

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'USER_CHANGE',
      entityType: 'USER',
      entityId: id,
      entityExternalKey: parsed.data.email,
      newValues: { name: parsed.data.name, role: parsed.data.role },
    });

    res.status(201);
    sendData(res, { id, email: parsed.data.email });
  }),
);

adminRouter.put(
  '/admin/users/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = UserInput.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele utilizatorului nu sunt valide.', parsed.error.issues);

    const id = String(req.params.id);
    const user = await queryOne<{ id: string; email: string }>('SELECT id, email FROM users WHERE id = ?', [id]);
    if (!user) throw ApiError.notFound('Utilizatorul nu a fost găsit.');

    const role = await queryOne<{ id: string }>('SELECT id FROM roles WHERE code = ?', [parsed.data.role]);
    if (!role) throw ApiError.validation('Rol inexistent.');

    await execute(
      'UPDATE users SET name = ?, email = ?, role_id = ?, updated_by = ? WHERE id = ?',
      [parsed.data.name, parsed.data.email, role.id, req.user?.id ?? null, id],
    );

    // A new password is optional on edit; supplying one forces a change again.
    if (parsed.data.password) {
      await execute(
        'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
        [await hashPassword(parsed.data.password), id],
      );
    }

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'USER_CHANGE',
      entityType: 'USER',
      entityId: id,
      entityExternalKey: parsed.data.email,
      oldValues: { email: user.email },
      newValues: { name: parsed.data.name, role: parsed.data.role, passwordReset: Boolean(parsed.data.password) },
    });

    sendData(res, { id });
  }),
);

/** Users are deactivated, never deleted — audit rows reference them. */
adminRouter.post(
  '/admin/users/:id/toggle-active',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    if (id === req.user?.id) {
      throw ApiError.validation('Nu îți poți dezactiva propriul cont.');
    }

    const user = await queryOne<{ is_active: number; email: string }>(
      'SELECT is_active, email FROM users WHERE id = ?',
      [id],
    );
    if (!user) throw ApiError.notFound('Utilizatorul nu a fost găsit.');

    const next = user.is_active === 1 ? 0 : 1;
    await execute('UPDATE users SET is_active = ?, updated_by = ? WHERE id = ?', [
      next,
      req.user?.id ?? null,
      id,
    ]);

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'USER_CHANGE',
      entityType: 'USER',
      entityId: id,
      entityExternalKey: user.email,
      newValues: { isActive: next === 1 },
    });

    sendData(res, { id, isActive: next === 1 });
  }),
);

// ---------------------------------------------------------------------------
// Catalogs
// ---------------------------------------------------------------------------

/**
 * Where each catalog can be referenced from.
 *
 * Counts deliberately ignore `deleted_at`: a soft-deleted campaign still holds
 * the reference physically, and restoring it must not find a missing value.
 */
const USAGE_QUERIES: Record<MasterCatalog, Array<{ label: string; sql: string }>> = {
  campaign_types: [{ label: 'CAMPAIGN', sql: 'SELECT COUNT(*) AS total FROM campaigns WHERE campaign_type_id = ?' }],
  campaign_statuses: [
    { label: 'CAMPAIGN', sql: 'SELECT COUNT(*) AS total FROM campaigns WHERE status_id = ?' },
    { label: 'ACTIVATION', sql: 'SELECT COUNT(*) AS total FROM activations WHERE status_id = ?' },
  ],
  audience_segments: [
    { label: 'CAMPAIGN', sql: 'SELECT COUNT(*) AS total FROM campaign_audiences WHERE audience_segment_id = ?' },
    { label: 'ACTIVATION', sql: 'SELECT COUNT(*) AS total FROM activation_audiences WHERE audience_segment_id = ?' },
  ],
  cta_types: [{ label: 'CAMPAIGN', sql: 'SELECT COUNT(*) AS total FROM campaign_ctas WHERE cta_type_id = ?' }],
  product_catalog: [],
  channel_catalog: [],
  seasonality_types: [{ label: 'CAMPAIGN', sql: 'SELECT COUNT(*) AS total FROM campaigns WHERE seasonality_type_id = ?' }],
  activation_channels: [
    { label: 'ACTIVATION_MATERIAL', sql: 'SELECT COUNT(*) AS total FROM activation_materials WHERE channel_id = ?' },
  ],
  implementation_modes: [
    { label: 'ACTIVATION', sql: 'SELECT COUNT(*) AS total FROM activations WHERE implementation_mode_id = ?' },
  ],
  funding_types: [
    { label: 'ACTIVATION', sql: 'SELECT COUNT(*) AS total FROM activation_funding_sources WHERE funding_type_id = ?' },
  ],
};

function assertCatalog(name: string): MasterCatalog {
  if (!(MASTER_CATALOGS as readonly string[]).includes(name)) {
    throw ApiError.notFound(`Nomenclator necunoscut: ${name}`);
  }
  return name as MasterCatalog;
}

async function dependenciesOf(
  catalog: MasterCatalog,
  id: string,
): Promise<Array<{ type: string; count: number }>> {
  const dependencies: Array<{ type: string; count: number }> = [];
  for (const usage of USAGE_QUERIES[catalog]) {
    const row = await queryOne<{ total: number }>(usage.sql, [id]);
    if ((row?.total ?? 0) > 0) dependencies.push({ type: usage.label, count: row!.total });
  }
  return dependencies;
}

adminRouter.get(
  '/admin/catalogs/:catalog',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const rows = await queryRows<{ id: string; code: string }>(
      `SELECT id, code, label, display_label AS displayLabel, hint,
              is_active AS isActive, is_system AS isSystem, sort_order AS sortOrder
         FROM ${catalog} ORDER BY sort_order, label`,
    );

    const withUsage = [];
    for (const row of rows) {
      const dependencies = await dependenciesOf(catalog, row.id);
      const usageCount = dependencies.reduce((sum, d) => sum + d.count, 0);
      // The internal id is not business identity; the code is.
      const { id, ...rest } = row as Record<string, unknown> & { id: string };
      withUsage.push({ ...rest, usageCount, dependencies });
    }

    sendData(res, withUsage);
  }),
);

const CatalogInput = z.object({
  code: z.string().trim().min(1, 'Codul este obligatoriu.').optional(),
  label: z.string().trim().min(1, 'Denumirea este obligatorie.'),
  displayLabel: z.string().nullable().default(null),
  hint: z.string().nullable().default(null),
  sortOrder: z.number().int().nonnegative().default(0),
});

adminRouter.post(
  '/admin/catalogs/:catalog',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const parsed = CatalogInput.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele nomenclatorului nu sunt valide.', parsed.error.issues);
    if (!parsed.data.code) throw ApiError.validation('Codul este obligatoriu.');

    const existing = await queryOne(`SELECT id FROM ${catalog} WHERE code = ?`, [parsed.data.code]);
    if (existing) throw new ApiError('CONFLICT', `Codul ${parsed.data.code} există deja.`);

    const id = newId();
    // is_system is technical metadata and is never accepted from a payload.
    await execute(
      `INSERT INTO ${catalog} (id, code, label, display_label, hint, is_active, is_system, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
      [
        id, parsed.data.code, parsed.data.label, parsed.data.displayLabel, parsed.data.hint,
        parsed.data.sortOrder, req.user?.id ?? null,
      ],
    );

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'MASTER_DATA_CHANGE',
      entityType: catalog.toUpperCase(),
      entityId: id,
      entityExternalKey: parsed.data.code,
      newValues: { label: parsed.data.label },
    });

    res.status(201);
    sendData(res, { code: parsed.data.code });
  }),
);

adminRouter.put(
  '/admin/catalogs/:catalog/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const parsed = CatalogInput.safeParse(req.body);
    if (!parsed.success) throw ApiError.validation('Datele nomenclatorului nu sunt valide.', parsed.error.issues);

    const code = String(req.params.code);
    const row = await queryOne<{ id: string; label: string }>(
      `SELECT id, label FROM ${catalog} WHERE code = ?`,
      [code],
    );
    if (!row) throw ApiError.notFound(`Valoarea ${code} nu a fost găsită.`);

    // The code is identity and stays immutable; only presentation changes.
    await execute(
      `UPDATE ${catalog} SET label = ?, display_label = ?, hint = ?, sort_order = ?, updated_by = ?
        WHERE id = ?`,
      [
        parsed.data.label, parsed.data.displayLabel, parsed.data.hint,
        parsed.data.sortOrder, req.user?.id ?? null, row.id,
      ],
    );

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'MASTER_DATA_CHANGE',
      entityType: catalog.toUpperCase(),
      entityId: row.id,
      entityExternalKey: code,
      oldValues: { label: row.label },
      newValues: { label: parsed.data.label },
    });

    sendData(res, { code });
  }),
);

/** Dependency preview, so the UI can explain before it asks to confirm. */
adminRouter.get(
  '/admin/catalogs/:catalog/:code/usage',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const code = String(req.params.code);

    const row = await queryOne<{ id: string; is_system: number; is_active: number }>(
      `SELECT id, is_system, is_active FROM ${catalog} WHERE code = ?`,
      [code],
    );
    if (!row) throw ApiError.notFound(`Valoarea ${code} nu a fost găsită.`);

    const dependencies = await dependenciesOf(catalog, row.id);
    const total = dependencies.reduce((sum, d) => sum + d.count, 0);

    sendData(res, {
      canDelete: row.is_system !== 1 && total === 0,
      canDeactivate: row.is_system !== 1,
      isSystem: row.is_system === 1,
      isActive: row.is_active === 1,
      dependencies,
    });
  }),
);

adminRouter.post(
  '/admin/catalogs/:catalog/:code/deactivate',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const code = String(req.params.code);

    const row = await queryOne<{ id: string; is_system: number; is_active: number }>(
      `SELECT id, is_system, is_active FROM ${catalog} WHERE code = ?`,
      [code],
    );
    if (!row) throw ApiError.notFound(`Valoarea ${code} nu a fost găsită.`);
    if (row.is_system === 1) {
      throw new ApiError(
        'SYSTEM_VALUE_PROTECTED',
        'Valoarea este necesară funcționării aplicației și nu poate fi dezactivată.',
      );
    }

    const next = row.is_active === 1 ? 0 : 1;
    await execute(`UPDATE ${catalog} SET is_active = ?, updated_by = ? WHERE id = ?`, [
      next,
      req.user?.id ?? null,
      row.id,
    ]);

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'MASTER_DATA_CHANGE',
      entityType: catalog.toUpperCase(),
      entityId: row.id,
      entityExternalKey: code,
      newValues: { isActive: next === 1 },
    });

    sendData(res, { code, isActive: next === 1 });
  }),
);

/**
 * Physical delete, permitted only for a non-system value with zero references.
 * The dependency check runs again here — a preview can go stale between the
 * user reading it and confirming (spec 35.1.11).
 */
adminRouter.delete(
  '/admin/catalogs/:catalog/:code',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const catalog = assertCatalog(String(req.params.catalog));
    const code = String(req.params.code);

    const row = await queryOne<{ id: string; is_system: number; label: string }>(
      `SELECT id, is_system, label FROM ${catalog} WHERE code = ?`,
      [code],
    );
    if (!row) throw ApiError.notFound(`Valoarea ${code} nu a fost găsită.`);

    if (row.is_system === 1) {
      throw new ApiError(
        'SYSTEM_VALUE_PROTECTED',
        'Valoarea este necesară funcționării aplicației și nu poate fi ștearsă.',
      );
    }

    const dependencies = await dependenciesOf(catalog, row.id);
    if (dependencies.length > 0) {
      throw new ApiError(
        'ENTITY_IN_USE',
        'Elementul nu poate fi șters deoarece este utilizat în sistem.',
        { entityType: catalog.toUpperCase(), externalKey: code, dependencies, allowedAction: 'DEACTIVATE' },
      );
    }

    try {
      await execute(`DELETE FROM ${catalog} WHERE id = ?`, [row.id]);
    } catch (error) {
      // FK RESTRICT is the safety net; surface it as a business conflict.
      if (isMysqlError(error, MYSQL_ERROR.ROW_IS_REFERENCED)) {
        throw new ApiError('ENTITY_IN_USE', 'Elementul este utilizat în sistem și nu poate fi șters.');
      }
      throw error;
    }

    await writeAudit({
      userId: req.user?.id ?? null,
      action: 'MASTER_DATA_CHANGE',
      entityType: catalog.toUpperCase(),
      entityExternalKey: code,
      oldValues: { label: row.label },
      newValues: null,
    });

    sendData(res, { code, deleted: true });
  }),
);

// ---------------------------------------------------------------------------
// Audit and import history
// ---------------------------------------------------------------------------

adminRouter.get(
  '/admin/audit',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const filters: string[] = [];
    const params: Array<string | number> = [];
    if (req.query.entityType) {
      filters.push('a.entity_type = ?');
      params.push(String(req.query.entityType));
    }
    if (req.query.action) {
      filters.push('a.action = ?');
      params.push(String(req.query.action));
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    const total = await queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM audit_log a ${where}`,
      params,
    );

    const rows = await queryRows(
      `SELECT a.id, a.created_at AS createdAt, a.action, a.entity_type AS entityType,
              a.entity_external_key AS entityExternalKey, a.source,
              a.old_values AS oldValues, a.new_values AS newValues,
              u.name AS userName, u.email AS userEmail
         FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
         ${where}
        ORDER BY a.created_at DESC ${limitClause(pageSize, offset)}`,
      params,
    );

    sendData(res, rows, pageMeta(total?.total ?? 0, page, pageSize));
  }),
);

adminRouter.get(
  '/admin/imports',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const { page, pageSize, offset } = readPagination(req);

    const total = await queryOne<{ total: number }>('SELECT COUNT(*) AS total FROM import_batches');

    const rows = await queryRows(
      `SELECT id, package_type AS packageType, package_id AS packageId,
              schema_version AS schemaVersion, filename, purpose, source, status,
              created_count AS createdCount, updated_count AS updatedCount,
              unchanged_count AS unchangedCount, warning_count AS warningCount,
              error_count AS errorCount, started_at AS startedAt, completed_at AS completedAt,
              checksum_sha256 AS checksum
         FROM import_batches
        ORDER BY created_at DESC ${limitClause(pageSize, offset)}`,
    );

    sendData(res, rows, pageMeta(total?.total ?? 0, page, pageSize));
  }),
);

adminRouter.get(
  '/admin/imports/:id',
  requireAdmin,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);

    const batch = await queryOne(
      `SELECT id, package_type AS packageType, package_id AS packageId, filename, status,
              report_json AS report, started_at AS startedAt, completed_at AS completedAt
         FROM import_batches WHERE id = ?`,
      [id],
    );
    if (!batch) throw ApiError.notFound('Importul nu a fost găsit.');

    const items = await queryRows(
      `SELECT entity_type AS entityType, external_key AS externalKey, operation, status, message
         FROM import_batch_items WHERE import_batch_id = ?
        ORDER BY entity_type, external_key LIMIT 500`,
      [id],
    );

    sendData(res, { ...batch, items });
  }),
);

export type { RoleCode };
