/**
 * MySQL connection pool.
 *
 * The four settings below are not cosmetic — each one prevents a class of bug
 * that would otherwise surface as wrong numbers on screen:
 *
 *   dateStrings     mysql2 otherwise converts DATE/DATETIME into JS Date objects
 *                   using the local timezone, which shifts '2026-03-20' by the
 *                   machine's offset and breaks annual-plan year overlap.
 *   timezone 'Z'    DB timestamps are UTC (blueprint sets time_zone '+00:00').
 *   decimalNumbers  DECIMAL columns otherwise arrive as strings, so budget sums
 *                   would concatenate instead of add.
 *   multipleStatements=false
 *                   defence in depth against SQL injection. The migration runner
 *                   splits statements itself rather than turning this on.
 */
import mysql from 'mysql2/promise';

import { env } from '../config/env';

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  charset: 'utf8mb4_0900_ai_ci',
  timezone: 'Z',
  dateStrings: ['DATE', 'DATETIME', 'TIMESTAMP'],
  decimalNumbers: true,
  supportBigNumbers: true,
  bigNumberStrings: false,
  namedPlaceholders: true,
  multipleStatements: false,
});

/** Cheap liveness probe for GET /api/v1/health/ready. */
export async function pingDatabase(): Promise<void> {
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
