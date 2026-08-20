<?php

/**
 * SystemMasterRegistry — port of `catalogs/system-master-registry.ts`.
 *
 * The single technical source of protected master codes. The spec is explicit:
 *
 *   - `is_system` never comes from business JSON;
 *   - the importer must not read or trust an `is_system` field in a payload;
 *   - protection is never decided by inspecting labels;
 *   - a protected code can never be demoted to `is_system = 0`;
 *   - Admin cannot edit the flag.
 *
 * Every master-data create sets `is_system` from `isSystemCode()`, so a first
 * bootstrap into an empty database already has DRAFT/ACTIVE/CLOSED protected —
 * nobody has to remember to flag them afterwards.
 */

declare(strict_types=1);

namespace Omd\Catalogs;

use Omd\Database\Db;
use Omd\Http\ApiError;

final class MasterRegistry
{
    /** The ten editable master tables. */
    public const CATALOGS = [
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
    ];

    /**
     * Protected codes per catalogue.
     *
     * The spec minimum for v1 is the three campaign statuses: the application
     * cannot function without them, so they may be neither deleted nor
     * deactivated.
     */
    private const PROTECTED_CODES = [
        'campaign_statuses' => ['DRAFT', 'ACTIVE', 'CLOSED'],
    ];

    public static function isCatalog(string $name): bool
    {
        return in_array($name, self::CATALOGS, true);
    }

    /**
     * Validates a table name coming from a URL parameter.
     *
     * The result is interpolated into SQL — that is safe only because it is
     * matched against this frozen list first, never because it "looks fine".
     */
    public static function assertCatalog(string $name): string
    {
        if (!self::isCatalog($name)) {
            throw ApiError::notFound('Nomenclatorul nu există.');
        }
        return $name;
    }

    public static function isSystemCode(string $catalog, string $code): bool
    {
        return in_array($code, self::PROTECTED_CODES[$catalog] ?? [], true);
    }

    /** @return list<string> */
    public static function protectedCodes(string $catalog): array
    {
        return self::PROTECTED_CODES[$catalog] ?? [];
    }

    /**
     * Idempotent correction pass, run at seed and deploy time.
     *
     * Brings a database that came from an intermediate stage back in line. Only
     * ever raises the flag; it never clears one.
     */
    public static function backfillSystemFlags(): int
    {
        $updated = 0;

        foreach (self::CATALOGS as $catalog) {
            $codes = self::protectedCodes($catalog);
            if ($codes === []) {
                continue;
            }
            $updated += Db::execute(
                sprintf(
                    'UPDATE %s SET is_system = 1 WHERE code IN (%s) AND is_system <> 1',
                    $catalog,
                    Db::placeholders($codes),
                ),
                array_values($codes),
            );
        }

        return $updated;
    }
}
