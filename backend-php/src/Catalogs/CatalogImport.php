<?php

/**
 * Master-data bootstrap from an OMD_CAMPAIGNS_PACKAGE — port of
 * `catalogs/master-data-import.ts`.
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

declare(strict_types=1);

namespace Omd\Catalogs;

use Omd\Database\Db;
use Omd\Imports\ImportContext;
use Omd\Support\Ids;
use RuntimeException;

final class CatalogImport
{
    /** Human labels used in warnings, matching the Admin UI wording. */
    private const CATALOG_LABELS = [
        'campaign_types' => 'Tipuri de campanie',
        'campaign_statuses' => 'Stadii',
        'audience_segments' => 'Publicuri',
        'cta_types' => 'CTA-uri',
        'product_catalog' => 'Produse',
        'channel_catalog' => 'Canale',
        'seasonality_types' => 'Sezonalitate',
        'activation_channels' => 'Canale de activare',
        'implementation_modes' => 'Moduri de implementare',
        'funding_types' => 'Tipuri de finanțare',
    ];

    /** Maps the contract's `catalogs` object onto the ten master tables. */
    public const CATALOG_BY_CONTRACT_KEY = [
        'campaignTypes' => 'campaign_types',
        'campaignStatuses' => 'campaign_statuses',
        'audiences' => 'audience_segments',
        'ctas' => 'cta_types',
        'products' => 'product_catalog',
        'channels' => 'channel_catalog',
        'seasonalityTypes' => 'seasonality_types',
        'activationChannels' => 'activation_channels',
        'implementationModes' => 'implementation_modes',
        'fundingTypes' => 'funding_types',
    ];

    /**
     * Upserts one catalog and returns a code -> id map for FK resolution.
     *
     * The table name is checked against the frozen registry before it reaches
     * SQL. It already comes from the constant above rather than from input, but
     * an identifier cannot be a bound parameter, so the assertion is what makes
     * that guarantee explicit rather than merely true today.
     *
     * @param list<array<string,mixed>> $entries
     * @return array<string,string>
     */
    public static function upsertCatalog(string $catalog, array $entries, ImportContext $ctx): array
    {
        MasterRegistry::assertCatalog($catalog);

        $byCode = [];

        foreach (array_values($entries) as $index => $entry) {
            $code = (string) ($entry['code'] ?? '');
            $label = (string) ($entry['label'] ?? '');

            $existing = Db::one(
                "SELECT id, label, display_label, hint, is_system FROM {$catalog} WHERE code = ?",
                [$code],
            );

            if ($existing !== null) {
                $byCode[$code] = (string) $existing['id'];

                if ((string) $existing['label'] !== $label) {
                    $ctx->warn(sprintf(
                        '%s / %s: label diferit (în aplicație „%s”, în pachet „%s”). '
                        . 'Valoarea din aplicație a fost păstrată.',
                        self::CATALOG_LABELS[$catalog],
                        $code,
                        (string) $existing['label'],
                        $label,
                    ));
                }

                // A protected code can be raised to is_system but never demoted
                // (spec 35.1.5).
                if (MasterRegistry::isSystemCode($catalog, $code) && (int) $existing['is_system'] !== 1) {
                    Db::execute("UPDATE {$catalog} SET is_system = 1 WHERE id = ?", [$existing['id']]);
                }

                $ctx->recordItem($catalog, $code, (string) $existing['id'], ImportContext::UNCHANGED);
                continue;
            }

            $id = Ids::newId();
            Db::execute(
                "INSERT INTO {$catalog}
                   (id, code, label, display_label, hint, is_active, is_system, sort_order, created_by)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
                [
                    $id,
                    $code,
                    $label,
                    $entry['displayLabel'] ?? null,
                    $entry['hint'] ?? null,
                    // Never read from the payload — the registry is the only authority.
                    MasterRegistry::isSystemCode($catalog, $code) ? 1 : 0,
                    $index,
                    $ctx->userId,
                ],
            );

            $byCode[$code] = $id;
            $ctx->recordItem($catalog, $code, $id, ImportContext::CREATE);
        }

        return $byCode;
    }

    /**
     * Upserts all ten catalogs carried by a Campaign package.
     *
     * @param array<string,mixed> $catalogs
     * @return array<string,array<string,string>>
     */
    public static function importCatalogs(array $catalogs, ImportContext $ctx): array
    {
        $maps = [];

        foreach (self::CATALOG_BY_CONTRACT_KEY as $contractKey => $catalog) {
            $entries = $catalogs[$contractKey] ?? [];
            $maps[$catalog] = self::upsertCatalog(
                $catalog,
                is_array($entries) ? $entries : [],
                $ctx,
            );
        }

        return $maps;
    }

    /**
     * Resolves a catalog code to an id, or throws a message naming the failure.
     *
     * @param array<string,array<string,string>> $maps
     */
    public static function resolveCode(array $maps, string $catalog, ?string $code, string $where): string
    {
        $id = ($code !== null && $code !== '') ? ($maps[$catalog][$code] ?? null) : null;

        if ($id === null) {
            throw new RuntimeException(sprintf(
                '%s: cod inexistent în nomenclatorul %s: %s',
                $where,
                self::CATALOG_LABELS[$catalog],
                $code ?? '—',
            ));
        }

        return $id;
    }
}
