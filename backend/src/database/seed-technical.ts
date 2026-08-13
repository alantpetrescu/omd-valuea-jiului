/**
 * Technical seed.
 *
 *   npm run seed:technical
 *
 * Creates the only data the spec permits outside of a JSON import (section 7):
 * the three fixed roles, one initial ADMIN user, and the protected-code
 * backfill. No campaigns, activations, catalogs or strategy — all business data
 * must arrive through an OMD_CAMPAIGNS_PACKAGE import, including in production.
 *
 * Safe to re-run: existing rows are left alone and an existing admin password is
 * never silently reset.
 */
import crypto from 'node:crypto';

import { env } from '../config/env';
import { logger } from '../shared/logger';
import { newId } from '../shared/ids';
import { hashPassword } from '../shared/password';
import { backfillSystemFlags, MASTER_CATALOGS } from '../catalogs/system-master-registry';
import { closePool } from './pool';
import { execute, queryOne, queryRows, withTransaction } from './db';
import type { Executor } from './db';

const ROLES = [
  { code: 'ADMIN', label: 'Administrator' },
  { code: 'EDITOR', label: 'Editor' },
  { code: 'VIEWER', label: 'Viewer' },
] as const;

/** Readable but high-entropy: 4 groups of 5 URL-safe characters. */
function temporaryPassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const pick = () =>
    Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  return [pick(), pick(), pick(), pick()].join('-');
}

async function ensureRoles(executor: Executor): Promise<void> {
  for (const role of ROLES) {
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM roles WHERE code = ?',
      [role.code],
      executor,
    );
    if (existing) continue;
    await execute(
      'INSERT INTO roles (id, code, label) VALUES (?, ?, ?)',
      [newId(), role.code, role.label],
      executor,
    );
    logger.info({ role: role.code }, 'role created');
  }
}

async function ensureAdminUser(executor: Executor): Promise<string | null> {
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM users WHERE email = ?',
    [env.SEED_ADMIN_EMAIL],
    executor,
  );
  if (existing) {
    logger.info({ email: env.SEED_ADMIN_EMAIL }, 'admin user already exists, password untouched');
    return null;
  }

  const adminRole = await queryOne<{ id: string }>(
    "SELECT id FROM roles WHERE code = 'ADMIN'",
    [],
    executor,
  );
  if (!adminRole) throw new Error('ADMIN role missing — roles must be seeded first.');

  const password = temporaryPassword();
  await execute(
    `INSERT INTO users (id, role_id, name, email, password_hash, is_active, must_change_password)
     VALUES (?, ?, ?, ?, ?, 1, 1)`,
    [newId(), adminRole.id, env.SEED_ADMIN_NAME, env.SEED_ADMIN_EMAIL, await hashPassword(password)],
    executor,
  );
  return password;
}

/** Confirms the spec rule that business tables stay empty until a JSON import. */
async function assertBusinessTablesEmpty(): Promise<void> {
  const tables = [...MASTER_CATALOGS, 'strategy_versions', 'campaigns', 'activations', 'annual_plans'];
  const nonEmpty: string[] = [];

  for (const table of tables) {
    const row = await queryOne<{ total: number }>(`SELECT COUNT(*) AS total FROM ${table}`);
    if ((row?.total ?? 0) > 0) nonEmpty.push(`${table}=${row?.total}`);
  }

  if (nonEmpty.length > 0) {
    logger.warn({ tables: nonEmpty }, 'business tables are not empty (expected after a JSON import)');
  } else {
    logger.info('business tables are empty, as required before the first import');
  }
}

async function main(): Promise<void> {
  const temporaryAdminPassword = await withTransaction(async (connection) => {
    await ensureRoles(connection);
    return ensureAdminUser(connection);
  });

  const corrected = await backfillSystemFlags();
  logger.info({ corrected }, 'protected master codes backfilled');

  const roles = await queryRows<{ code: string }>('SELECT code FROM roles ORDER BY code');
  const users = await queryRows<{ email: string; role: string }>(
    'SELECT u.email, r.code AS role FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.email',
  );
  logger.info({ roles: roles.map((r) => r.code), users }, 'technical seed complete');

  await assertBusinessTablesEmpty();

  if (temporaryAdminPassword) {
    // Printed once, on purpose: it is not stored anywhere and must be changed at
    // first login (must_change_password = 1).
    process.stdout.write(
      `\n  Initial admin created\n` +
        `    email:    ${env.SEED_ADMIN_EMAIL}\n` +
        `    password: ${temporaryAdminPassword}\n` +
        `  Shown once. Must be changed at first login.\n\n`,
    );
  }
}

if (require.main === module) {
  main()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      logger.error({ err: error }, 'technical seed failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
