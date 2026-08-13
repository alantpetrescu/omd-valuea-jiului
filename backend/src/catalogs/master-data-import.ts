/**
 * Master-data bootstrap from an OMD_CAMPAIGNS_PACKAGE.
 *
 * Spec sections 33.4-33.6, which define the whole policy in three rules:
 *
 *   empty DB            -> create every code the package needs, no manual entry
 *   code already exists -> use the DB row; a differing label is a WARNING
 *   new valid code      -> create it, do not make Admin pre-create it
 *
 * The label rule is the important one: an Admin who renamed "Tineri activi" to
 * "Tineri activi / outdoor" must not have that silently reverted by the next
 * import. Identity is the code; the label is a snapshot for comparison only.
 */
import { execute, queryOne } from '../database/db';
import { newId } from '../shared/ids';
import type { ImportContext } from '../imports/import-context';
import { isSystemCode, type MasterCatalog } from './system-master-registry';

/** A `catalogRef` entry as carried by the contract. */
export interface CatalogEntry {
  code: string;
  label: string;
  displayLabel?: string | null;
  hint?: string | null;
}

interface CatalogRow {
  id: string;
  label: string;
  display_label: string | null;
  hint: string | null;
  is_system: number;
}

/** Human labels used in warnings, matching the Admin UI wording. */
const CATALOG_LABELS: Record<MasterCatalog, string> = {
  campaign_types: 'Tipuri de campanie',
  campaign_statuses: 'Stadii',
  audience_segments: 'Publicuri',
  cta_types: 'CTA-uri',
  product_catalog: 'Produse',
  channel_catalog: 'Canale',
  seasonality_types: 'Sezonalitate',
  activation_channels: 'Canale de activare',
  implementation_modes: 'Moduri de implementare',
  funding_types: 'Tipuri de finanțare',
};

/**
 * Upserts one catalog and returns a code -> id map for FK resolution.
 * Table names come from the frozen MasterCatalog union, never from input.
 */
export async function upsertCatalog(
  catalog: MasterCatalog,
  entries: readonly CatalogEntry[],
  ctx: ImportContext,
): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();

  for (const [index, entry] of entries.entries()) {
    const existing = await queryOne<CatalogRow>(
      `SELECT id, label, display_label, hint, is_system FROM ${catalog} WHERE code = ?`,
      [entry.code],
      ctx.connection,
    );

    if (existing) {
      byCode.set(entry.code, existing.id);

      if (existing.label !== entry.label) {
        ctx.warn(
          `${CATALOG_LABELS[catalog]} / ${entry.code}: label diferit ` +
            `(în aplicație „${existing.label}”, în pachet „${entry.label}”). ` +
            `Valoarea din aplicație a fost păstrată.`,
        );
      }

      // A protected code can be raised to is_system but never demoted (spec 35.1.5).
      if (isSystemCode(catalog, entry.code) && existing.is_system !== 1) {
        await execute(`UPDATE ${catalog} SET is_system = 1 WHERE id = ?`, [existing.id], ctx.connection);
      }

      await ctx.recordItem(catalog, entry.code, existing.id, 'UNCHANGED');
      continue;
    }

    const id = newId();
    await execute(
      `INSERT INTO ${catalog} (id, code, label, display_label, hint, is_active, is_system, sort_order, created_by)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        id,
        entry.code,
        entry.label,
        entry.displayLabel ?? null,
        entry.hint ?? null,
        // Never read from the payload — the registry is the only authority.
        isSystemCode(catalog, entry.code) ? 1 : 0,
        index,
        ctx.userId,
      ],
      ctx.connection,
    );

    byCode.set(entry.code, id);
    await ctx.recordItem(catalog, entry.code, id, 'CREATE');
  }

  return byCode;
}

/** Maps the contract's `catalogs` object onto the ten master tables. */
export const CATALOG_BY_CONTRACT_KEY: Record<string, MasterCatalog> = {
  campaignTypes: 'campaign_types',
  campaignStatuses: 'campaign_statuses',
  audiences: 'audience_segments',
  ctas: 'cta_types',
  products: 'product_catalog',
  channels: 'channel_catalog',
  seasonalityTypes: 'seasonality_types',
  activationChannels: 'activation_channels',
  implementationModes: 'implementation_modes',
  fundingTypes: 'funding_types',
};

export type CatalogMaps = Record<MasterCatalog, Map<string, string>>;

/** Upserts all ten catalogs carried by a Campaign package. */
export async function importCatalogs(
  catalogs: Record<string, CatalogEntry[]>,
  ctx: ImportContext,
): Promise<CatalogMaps> {
  const maps = {} as CatalogMaps;

  for (const [contractKey, catalog] of Object.entries(CATALOG_BY_CONTRACT_KEY)) {
    maps[catalog] = await upsertCatalog(catalog, catalogs[contractKey] ?? [], ctx);
  }

  return maps;
}

/** Resolves a catalog code to an id, or throws a message naming the failure. */
export function resolveCode(
  maps: CatalogMaps,
  catalog: MasterCatalog,
  code: string | null | undefined,
  where: string,
): string {
  const id = code ? maps[catalog].get(code) : undefined;
  if (!id) {
    throw new Error(`${where}: cod inexistent în nomenclatorul ${CATALOG_LABELS[catalog]}: ${code ?? '—'}`);
  }
  return id;
}
