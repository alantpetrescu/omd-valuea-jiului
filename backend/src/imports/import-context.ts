/**
 * Shared state for one import run.
 *
 * Every importer receives the same context so that all writes join the single
 * transaction, warnings accumulate in one place, and per-entity outcomes land
 * in `import_batch_items` for the Admin > Importuri screen.
 */
import type { PoolConnection } from 'mysql2/promise';

import { execute } from '../database/db';
import { newId } from '../shared/ids';

export type ImportOperation = 'CREATE' | 'UPDATE' | 'UNCHANGED' | 'SKIP';

export interface ImportCounts {
  created: number;
  updated: number;
  unchanged: number;
}

export class ImportContext {
  readonly warnings: string[] = [];
  private readonly counts = new Map<string, ImportCounts>();

  constructor(
    readonly connection: PoolConnection,
    readonly batchId: string,
    readonly userId: string | null = null,
  ) {}

  warn(message: string): void {
    this.warnings.push(message);
  }

  count(entityType: string, operation: ImportOperation): void {
    const current = this.counts.get(entityType) ?? { created: 0, updated: 0, unchanged: 0 };
    if (operation === 'CREATE') current.created += 1;
    else if (operation === 'UPDATE') current.updated += 1;
    else if (operation === 'UNCHANGED') current.unchanged += 1;
    this.counts.set(entityType, current);
  }

  /** Records one entity outcome. Kept lightweight: details only when useful. */
  async recordItem(
    entityType: string,
    externalKey: string | null,
    entityId: string | null,
    operation: ImportOperation,
    message?: string,
  ): Promise<void> {
    this.count(entityType, operation);
    await execute(
      `INSERT INTO import_batch_items
         (id, import_batch_id, entity_type, external_key, entity_id, operation, status, message)
       VALUES (?, ?, ?, ?, ?, ?, 'SUCCESS', ?)`,
      [newId(), this.batchId, entityType, externalKey, entityId, operation, message ?? null],
      this.connection,
    );
  }

  summary(): Record<string, ImportCounts> {
    return Object.fromEntries([...this.counts.entries()].sort(([a], [b]) => a.localeCompare(b)));
  }

  totals(): ImportCounts {
    return [...this.counts.values()].reduce(
      (total, item) => ({
        created: total.created + item.created,
        updated: total.updated + item.updated,
        unchanged: total.unchanged + item.unchanged,
      }),
      { created: 0, updated: 0, unchanged: 0 },
    );
  }
}
