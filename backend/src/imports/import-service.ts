/**
 * Import orchestration.
 *
 * One shape for all four package types (spec section 30):
 *
 *   read bytes -> sha256 -> parse -> identify (packageType, schemaVersion)
 *   -> JSON Schema validation -> business validation
 *   -> stage asset files in temp
 *   -> BEGIN -> import_batch -> writes -> publish files -> verify -> COMMIT
 *
 * Any failure rolls the database back, deletes files published during this run
 * and marks the batch FAILED. A partial import is never left behind.
 */
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

import { execute, queryOne, withTransaction } from '../database/db';
import { newId } from '../shared/ids';
import { logger } from '../shared/logger';
import { assetStorage } from '../assets/storage';
import { importCatalogs } from '../catalogs/master-data-import';
import { importStrategicData } from '../strategy/strategy-import';
import { importCampaigns, stageCampaignAssets, type StagedAssets } from '../campaigns/campaign-import';
import { importActivations } from '../activations/activation-import';
import {
  importPerformanceSnapshots,
  importReputationSnapshots,
} from '../monitoring/monitoring-import';
import { validateAgainstContract, type PackageType } from './contract-registry';
import { ImportContext } from './import-context';

export interface ImportReport {
  status: 'SUCCESS' | 'FAILED';
  packageType: PackageType | null;
  packageId: string | null;
  schemaVersion: string | null;
  checksum: string;
  batchId: string | null;
  summary: Record<string, { created: number; updated: number; unchanged: number }>;
  warnings: string[];
  errors: string[];
}

interface PackageMetadata {
  packageId?: string;
  generatedAt?: string;
  purpose?: string;
  source?: string;
  application?: string;
  notes?: string;
}

/** ISO-8601 to a MySQL DATETIME(6) literal. Both sides are UTC. */
function toMysqlDateTime(iso: string | undefined): string | null {
  if (!iso) return null;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Creates the batch row OUTSIDE the import transaction, deliberately.
 *
 * If it were created inside, a rollback would delete the record of the failure
 * along with the failed data, and Admin > Importuri would show nothing at all
 * for a run that visibly failed.
 */
async function createBatch(
  packageType: string,
  schemaVersion: string,
  metadata: PackageMetadata,
  filename: string,
  checksum: string,
  userId: string | null,
): Promise<string> {
  const id = newId();
  await execute(
    `INSERT INTO import_batches
       (id, package_type, package_id, schema_version, filename, checksum_sha256, source, purpose,
        application, notes, generated_at, status, created_by, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, CURRENT_TIMESTAMP(6))`,
    [
      id,
      packageType,
      metadata.packageId ?? null,
      schemaVersion,
      filename,
      checksum,
      metadata.source ?? null,
      metadata.purpose ?? null,
      metadata.application ?? null,
      metadata.notes ?? null,
      toMysqlDateTime(metadata.generatedAt),
      userId,
    ],
  );
  return id;
}

/** Removes files this run published, used when the transaction is rolled back. */
async function unpublish(storageKeys: readonly string[]): Promise<void> {
  for (const key of storageKeys) {
    await assetStorage.delete(key).catch((error: unknown) => {
      logger.warn({ err: error, storageKey: key }, 'could not remove published asset during rollback');
    });
  }
}

async function discardStaged(staged: StagedAssets): Promise<void> {
  for (const file of staged.values()) {
    await fs.rm(file.temporaryPath, { force: true }).catch(() => undefined);
  }
}

export async function importPackageFile(
  filePath: string,
  options: { userId?: string | null } = {},
): Promise<ImportReport> {
  const bytes = await fs.readFile(filePath);
  const checksum = crypto.createHash('sha256').update(bytes).digest('hex');
  const filename = filePath.split(/[\\/]/).pop() ?? 'package.json';
  const userId = options.userId ?? null;

  const base: ImportReport = {
    status: 'FAILED',
    packageType: null,
    packageId: null,
    schemaVersion: null,
    checksum,
    batchId: null,
    summary: {},
    warnings: [],
    errors: [],
  };

  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    return { ...base, errors: [`Fișierul nu este JSON valid: ${(error as Error).message}`] };
  }

  const validation = validateAgainstContract(parsed);
  base.packageType = validation.packageType;
  base.schemaVersion = validation.schemaVersion;

  if (!validation.valid) {
    return { ...base, errors: validation.errors.slice(0, 50) };
  }

  const pkg = parsed as {
    packageType: PackageType;
    schemaVersion: string;
    metadata: PackageMetadata;
    strategicData?: Parameters<typeof importStrategicData>[0];
    catalogs?: Record<string, never>;
    campaigns?: Parameters<typeof importCampaigns>[0];
    activations?: Parameters<typeof importActivations>[0];
    annualPlans?: Parameters<typeof importActivations>[1];
    performanceSnapshots?: Parameters<typeof importPerformanceSnapshots>[0];
    reputationSnapshots?: Parameters<typeof importReputationSnapshots>[0];
  };
  base.packageId = pkg.metadata?.packageId ?? null;

  // Decode assets before opening the transaction so a long CPU/IO step does not
  // hold locks (spec section 24: decode -> temp -> BEGIN -> ... -> COMMIT).
  let staged: StagedAssets = new Map();
  if (validation.packageType === 'OMD_CAMPAIGNS_PACKAGE') {
    try {
      staged = await stageCampaignAssets(pkg.campaigns ?? []);
    } catch (error) {
      return { ...base, errors: [(error as Error).message] };
    }
  }

  const published: string[] = [];
  const batchId = await createBatch(
    pkg.packageType,
    pkg.schemaVersion,
    pkg.metadata ?? {},
    filename,
    checksum,
    userId,
  );

  try {
    const report = await withTransaction(async (connection) => {
      const ctx = new ImportContext(connection, batchId, userId);

      switch (validation.packageType) {
        case 'OMD_CAMPAIGNS_PACKAGE': {
          const strategy = await importStrategicData(pkg.strategicData!, ctx);
          const catalogs = await importCatalogs(pkg.catalogs as never, ctx);
          const result = await importCampaigns(pkg.campaigns ?? [], catalogs, strategy, staged, ctx);
          published.push(...result.publishedStorageKeys);

          // Post-import verification before COMMIT (spec section 30.2).
          const campaignCount = await queryOne<{ total: number }>(
            'SELECT COUNT(*) AS total FROM campaigns WHERE strategy_version_id = ? AND deleted_at IS NULL',
            [strategy.strategyVersionId],
            connection,
          );
          if ((campaignCount?.total ?? 0) < (pkg.campaigns?.length ?? 0)) {
            throw new Error('Verificarea post-import nu a confirmat numărul de campanii.');
          }
          break;
        }

        case 'OMD_ACTIVATIONS_PACKAGE': {
          const result = await importActivations(pkg.activations ?? [], pkg.annualPlans ?? [], ctx);
          published.push(...result.publishedStorageKeys);

          const activationCount = await queryOne<{ total: number }>(
            'SELECT COUNT(*) AS total FROM activations WHERE deleted_at IS NULL',
            [],
            connection,
          );
          if ((activationCount?.total ?? 0) < (pkg.activations?.length ?? 0)) {
            throw new Error('Verificarea post-import nu a confirmat numărul de activări.');
          }
          break;
        }

        case 'OMD_ACTIVATION_MONITORING_PACKAGE':
          await importPerformanceSnapshots(pkg.performanceSnapshots ?? [], ctx);
          break;

        case 'OMD_REPUTATION_MONITORING_PACKAGE':
          await importReputationSnapshots(pkg.reputationSnapshots ?? [], ctx);
          break;
      }

      const totals = ctx.totals();
      await execute(
        `UPDATE import_batches
            SET status = 'SUCCESS', completed_at = CURRENT_TIMESTAMP(6),
                created_count = ?, updated_count = ?, unchanged_count = ?, warning_count = ?,
                report_json = ?
          WHERE id = ?`,
        [
          totals.created,
          totals.updated,
          totals.unchanged,
          ctx.warnings.length,
          JSON.stringify({ summary: ctx.summary(), warnings: ctx.warnings }),
          batchId,
        ],
        connection,
      );

      return { summary: ctx.summary(), warnings: ctx.warnings };
    });

    await discardStaged(staged);

    return {
      ...base,
      status: 'SUCCESS',
      batchId,
      summary: report.summary,
      warnings: report.warnings,
    };
  } catch (error) {
    await unpublish(published);
    await discardStaged(staged);

    await execute(
      `UPDATE import_batches
          SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP(6), error_count = 1, report_json = ?
        WHERE id = ?`,
      [JSON.stringify({ error: (error as Error).message }), batchId],
    ).catch(() => undefined);

    return { ...base, batchId, errors: [(error as Error).message] };
  }
}
