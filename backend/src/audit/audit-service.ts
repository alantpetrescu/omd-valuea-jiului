/**
 * Audit log — spec section 35.
 *
 * Records who changed what, when, and whether it came from the UI, an import or
 * the system. Passwords and tokens are never written here.
 */
import type { Executor } from '../database/db';
import { execute } from '../database/db';
import { newId } from '../shared/ids';

export type AuditAction =
  | 'LOGIN'
  | 'CREATE'
  | 'UPDATE'
  | 'SOFT_DELETE'
  | 'RESTORE'
  | 'IMPORT'
  | 'MASTER_DATA_CHANGE'
  | 'STRATEGY_CHANGE'
  | 'USER_CHANGE';

export type AuditSource = 'MANUAL' | 'IMPORT' | 'SYSTEM';

export interface AuditEntry {
  userId: string | null;
  action: AuditAction;
  entityType: string;
  entityId?: string | null;
  entityExternalKey?: string | null;
  source?: AuditSource;
  oldValues?: unknown;
  newValues?: unknown;
  importBatchId?: string | null;
}

const SENSITIVE = new Set(['password', 'passwordHash', 'password_hash', 'token', 'currentPassword', 'newPassword']);

/** Strips anything that must never reach the audit table (spec 35). */
function scrub(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(scrub);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !SENSITIVE.has(key))
      .map(([key, entry]) => [key, scrub(entry)]),
  );
}

export async function writeAudit(entry: AuditEntry, executor?: Executor): Promise<void> {
  await execute(
    `INSERT INTO audit_log
       (id, user_id, action, entity_type, entity_id, entity_external_key, source,
        old_values, new_values, import_batch_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      newId(),
      entry.userId,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.entityExternalKey ?? null,
      entry.source ?? 'MANUAL',
      entry.oldValues === undefined ? null : JSON.stringify(scrub(entry.oldValues)),
      entry.newValues === undefined ? null : JSON.stringify(scrub(entry.newValues)),
      entry.importBatchId ?? null,
    ],
    executor,
  );
}
