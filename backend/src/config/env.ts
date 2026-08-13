/**
 * Environment configuration.
 *
 * Spec rule (FULLSTACK v1.5, section 6): the application must refuse to start
 * if critical variables are missing. Validation happens once, here, at import
 * time — no `process.env` reads anywhere else in the codebase.
 */
import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const numeric = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value === '' ? fallback : Number(value)))
    .pipe(z.number().int().positive());

const schema = z.object({
  /** Spec section 5 defines exactly two environments. Local development runs as staging. */
  APP_ENV: z.enum(['staging', 'production']),
  APP_BASE_URL: z.string().url(),
  APP_SECRET: z.string().min(16, 'APP_SECRET must be at least 16 characters'),
  PORT: numeric(3000),
  /** Bind address. Behind a reverse proxy in production this should stay on loopback. */
  HOST: z.string().min(1).default('0.0.0.0'),

  DB_HOST: z.string().min(1),
  DB_PORT: numeric(3306),
  DB_NAME: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string(),

  UPLOAD_DIR: z.string().min(1),
  IMPORT_TEMP_DIR: z.string().min(1),
  MAX_UPLOAD_MB: numeric(15),
  MAX_JSON_IMPORT_MB: numeric(25),

  AUTH_SECRET: z.string().min(16, 'AUTH_SECRET must be at least 16 characters'),
  AUTH_TOKEN_TTL: numeric(28800),

  /** Identity of the initial ADMIN created by the technical seed. */
  SEED_ADMIN_EMAIL: z.string().email().default('admin@omd.ro'),
  SEED_ADMIN_NAME: z.string().min(1).default('Administrator OMD'),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  TRUST_PROXY: z.string().optional(),
  ALLOWED_ORIGIN: z.string().optional(),
  BACKUP_DIR: z.string().optional(),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
  // Deliberately not the logger: config is what the logger is built from.
  console.error(`Invalid environment configuration:\n${problems}\n\nSee backend/.env.example.`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.APP_ENV === 'production',
  isStaging: raw.APP_ENV === 'staging',
  /** Repository root — the folder containing backend/, database/ and storage/. */
  repoRoot: REPO_ROOT,
  /** Absolute paths, resolved once. Storage keys stay relative — see AssetStorage. */
  uploadDir: path.resolve(REPO_ROOT, raw.UPLOAD_DIR),
  importTempDir: path.resolve(REPO_ROOT, raw.IMPORT_TEMP_DIR),
  migrationsDir: path.resolve(REPO_ROOT, 'database', 'migrations'),
} as const;

export type Env = typeof env;
