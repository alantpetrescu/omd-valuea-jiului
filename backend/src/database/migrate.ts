/**
 * Migration runner.
 *
 *   npm run migrate          apply every pending migration
 *   npm run migrate:status   list applied and pending migrations, change nothing
 *
 * Rules this enforces (FULLSTACK spec section 7):
 *   - migrations are the only way the schema changes;
 *   - the same files run in staging and production;
 *   - an already-applied file that changed on disk is an error, not a silent
 *     no-op, because staging and production would silently diverge.
 *
 * MySQL does not roll back DDL. A failing statement therefore stops the run
 * immediately and leaves earlier statements applied — the failure is reported
 * with the exact file and statement so it can be resolved by hand.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';


import { env } from '../config/env';
import { logger } from '../shared/logger';
import { closePool, pool } from './pool';
import { execute, queryRows } from './db';

const MIGRATIONS_DIR = env.migrationsDir;

interface AppliedRow {
  filename: string;
  checksum_sha256: string;
  applied_at: string;
}

const CREATE_TRACKING_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename        VARCHAR(255) NOT NULL,
    checksum_sha256 CHAR(64) CHARACTER SET ascii COLLATE ascii_general_ci NOT NULL,
    applied_at      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (filename)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
`;

/**
 * Splits a migration file into statements on semicolons at paren depth zero,
 * ignoring line comments and string literals. The pool runs with
 * multipleStatements disabled, so statements are sent one at a time.
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inBacktick = false;
  let inLineComment = false;

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i]!;
    const next = sql[i + 1];

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      current += char;
      continue;
    }
    if (!inSingle && !inDouble && !inBacktick && char === '-' && next === '-') {
      inLineComment = true;
      current += char;
      continue;
    }

    if (char === "'" && !inDouble && !inBacktick) inSingle = !inSingle;
    else if (char === '"' && !inSingle && !inBacktick) inDouble = !inDouble;
    else if (char === '`' && !inSingle && !inDouble) inBacktick = !inBacktick;

    if (!inSingle && !inDouble && !inBacktick) {
      if (char === '(') depth += 1;
      else if (char === ')') depth -= 1;
      else if (char === ';' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) statements.push(trimmed);
        current = '';
        continue;
      }
    }

    current += char;
  }

  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

const checksum = (contents: string) =>
  crypto.createHash('sha256').update(contents, 'utf8').digest('hex');

async function readMigrationFiles() {
  const entries = await fs.readdir(MIGRATIONS_DIR);
  const files = entries.filter((name) => name.endsWith('.sql')).sort();
  return Promise.all(
    files.map(async (filename) => {
      const contents = await fs.readFile(path.join(MIGRATIONS_DIR, filename), 'utf8');
      return { filename, contents, checksum: checksum(contents) };
    }),
  );
}

async function run(statusOnly: boolean): Promise<void> {
  await execute(CREATE_TRACKING_TABLE);

  const applied = await queryRows<AppliedRow>(
    'SELECT filename, checksum_sha256, applied_at FROM schema_migrations ORDER BY filename',
  );
  const appliedByName = new Map(applied.map((row) => [row.filename, row]));
  const files = await readMigrationFiles();

  for (const file of files) {
    const previous = appliedByName.get(file.filename);
    if (previous && previous.checksum_sha256 !== file.checksum) {
      throw new Error(
        `${file.filename} was already applied but its contents changed. ` +
          `Never edit an applied migration — add a new one instead.`,
      );
    }
  }

  const pending = files.filter((file) => !appliedByName.has(file.filename));

  if (statusOnly) {
    for (const file of files) {
      const previous = appliedByName.get(file.filename);
      const state = previous ? `applied ${previous.applied_at}` : 'PENDING';
      process.stdout.write(`  ${file.filename.padEnd(28)} ${state}\n`);
    }
    process.stdout.write(`\n${applied.length} applied, ${pending.length} pending\n`);
    return;
  }

  if (pending.length === 0) {
    logger.info({ database: env.DB_NAME }, 'no pending migrations');
    return;
  }

  for (const file of pending) {
    const statements = splitStatements(file.contents);
    logger.info({ file: file.filename, statements: statements.length }, 'applying migration');

    for (const [index, statement] of statements.entries()) {
      try {
        await pool.query(statement);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `${file.filename}: statement ${index + 1} of ${statements.length} failed.\n` +
            `${statement.split('\n')[0]}\n${message}\n\n` +
            `DDL is not transactional: statements before this one are applied.`,
        );
      }
    }

    await execute('INSERT INTO schema_migrations (filename, checksum_sha256) VALUES (?, ?)', [
      file.filename,
      file.checksum,
    ]);
    logger.info({ file: file.filename }, 'migration applied');
  }

  logger.info({ count: pending.length, database: env.DB_NAME }, 'migrations complete');
}

if (require.main === module) {
  const statusOnly = process.argv.includes('--status');
  run(statusOnly)
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch(async (error: unknown) => {
      logger.error({ err: error }, 'migration run failed');
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}

export { run };
