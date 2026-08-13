/**
 * SystemMasterRegistry — the single technical source of protected master codes.
 *
 * Spec section 35.1.5, which is explicit about this:
 *
 *   - `is_system` never comes from business JSON;
 *   - the importer must not read or trust an `is_system` field in a payload;
 *   - the importer must not decide protection by inspecting labels;
 *   - a protected code can never be demoted to `is_system = 0`;
 *   - Admin cannot edit the flag.
 *
 * Every master-data CREATE/UPSERT sets `is_system = isSystemCode(catalog, code)`.
 * That way, on a first bootstrap into an empty database, DRAFT/ACTIVE/CLOSED
 * arrive already protected — nobody has to remember to flag them afterwards.
 */
import type { Executor } from '../database/db';
import { execute } from '../database/db';

/** The ten editable master tables, keyed by table name. */
export const MASTER_CATALOGS = [
  'campaign_types',
  'campaign_statuses',
  'audience_segments',
  'cta_types',
  'product_catalog',
  'channel_catalog',
  'seasonality_types',
  'activation_channels',
  'implementation_modes',
  'funding_types',
] as const;

export type MasterCatalog = (typeof MASTER_CATALOGS)[number];

/**
 * Protected codes per catalog.
 *
 * Spec minimum for v1 is the three campaign statuses: the application cannot
 * function without them, so they may be neither deleted nor deactivated.
 * Additions here take effect on the next backfill run.
 */
const PROTECTED_CODES: Partial<Record<MasterCatalog, readonly string[]>> = {
  campaign_statuses: ['DRAFT', 'ACTIVE', 'CLOSED'],
};

export function isSystemCode(catalog: MasterCatalog, code: string): boolean {
  return PROTECTED_CODES[catalog]?.includes(code) ?? false;
}

export function protectedCodes(catalog: MasterCatalog): readonly string[] {
  return PROTECTED_CODES[catalog] ?? [];
}

/**
 * Idempotent correction pass.
 *
 * Run at deployment/seed time. Required by spec 35.1.5 so a database that came
 * from an intermediate stage — or one where a code was created before it was
 * added to this registry — is brought back in line. Only ever raises the flag;
 * it never clears one.
 */
export async function backfillSystemFlags(executor?: Executor): Promise<number> {
  let updated = 0;

  for (const catalog of MASTER_CATALOGS) {
    const codes = protectedCodes(catalog);
    if (codes.length === 0) continue;

    // Table name comes from the frozen MASTER_CATALOGS list, never from input.
    const list = codes.map(() => '?').join(', ');
    const result = await execute(
      `UPDATE ${catalog} SET is_system = 1 WHERE code IN (${list}) AND is_system <> 1`,
      [...codes],
      executor,
    );
    updated += result.affectedRows;
  }

  return updated;
}
