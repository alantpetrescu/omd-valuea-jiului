/**
 * Typed query helpers over mysql2.
 *
 * Every repository method takes an optional `Executor`. Passing the transaction
 * connection down is what makes multi-table writes (campaign + its relation
 * tables, activation + materials + KPIs) atomic. Repositories must never reach
 * for the pool directly when they are called inside a transaction.
 */
import type { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

import { pool } from './pool';

/** Either the pool (autocommit) or a transaction connection. */
export type Executor = Pool | PoolConnection;

/**
 * A single bindable value.
 *
 * `undefined` is deliberately absent: the driver rejects it, and the spec
 * requires NULL to stay distinct from 0 and from "not supplied". Callers must
 * pass `null` explicitly rather than letting an optional field vanish.
 */
export type SqlValue = string | number | bigint | boolean | Date | Buffer | null;

/** Positional parameters, or named ones (the pool enables namedPlaceholders). */
export type QueryParams = SqlValue[] | Record<string, SqlValue>;

/**
 * Runs a SELECT and returns typed rows.
 *
 * Uses `execute` (real prepared statements). Note that prepared statements
 * cannot expand an array into `IN (?)` — build the placeholders with
 * `placeholders()` below instead.
 */
export async function queryRows<T = RowDataPacket>(
  sql: string,
  params: QueryParams = [],
  executor: Executor = pool,
): Promise<T[]> {
  const [rows] = await executor.execute<RowDataPacket[]>(sql, params);
  return rows as T[];
}

/** Returns the first row, or null when the result set is empty. */
export async function queryOne<T = RowDataPacket>(
  sql: string,
  params: QueryParams = [],
  executor: Executor = pool,
): Promise<T | null> {
  const rows = await queryRows<T>(sql, params, executor);
  return rows[0] ?? null;
}

/** Runs INSERT/UPDATE/DELETE and returns affectedRows, insertId and friends. */
export async function execute(
  sql: string,
  params: QueryParams = [],
  executor: Executor = pool,
): Promise<ResultSetHeader> {
  const [result] = await executor.execute<ResultSetHeader>(sql, params);
  return result;
}

/**
 * Runs `fn` inside a transaction, committing on success and rolling back on any
 * thrown error. The connection is always released.
 *
 * Caveat that matters for migrations: MySQL does not roll back DDL. This helper
 * is for data statements only.
 */
export async function withTransaction<T>(fn: (connection: PoolConnection) => Promise<T>): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    try {
      const result = await fn(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  } finally {
    connection.release();
  }
}

/**
 * Builds `?, ?, ?` for an `IN (...)` clause.
 *
 * Always pair with the same array as parameters — never interpolate values.
 * Returns `NULL` for an empty list so `IN (NULL)` matches nothing instead of
 * producing a syntax error.
 */
export function placeholders(values: readonly unknown[]): string {
  return values.length === 0 ? 'NULL' : values.map(() => '?').join(', ');
}

/** MySQL error codes that repositories translate into business responses. */
export const MYSQL_ERROR = {
  DUPLICATE_ENTRY: 'ER_DUP_ENTRY',
  /** A referenced parent row is missing. */
  NO_REFERENCED_ROW: 'ER_NO_REFERENCED_ROW_2',
  /** A child row still references this row — becomes 409 ENTITY_IN_USE, never a 500. */
  ROW_IS_REFERENCED: 'ER_ROW_IS_REFERENCED_2',
  CHECK_CONSTRAINT_VIOLATED: 'ER_CHECK_CONSTRAINT_VIOLATED',
} as const;

export function isMysqlError(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === code;
}
