<?php

/**
 * Shared state for one import run — port of `imports/import-context.ts`.
 *
 * Every importer receives the same context so warnings accumulate in one place
 * and per-entity outcomes land in `import_batch_items` for the
 * Admin > Importuri screen.
 *
 * One field of the original is deliberately absent: the `connection`. mysql2
 * hands out pooled connections, so Node had to thread the transaction's
 * connection through every call or the writes would land outside it. PDO gives
 * a request one connection, and `Db::transaction()` runs on that one, so every
 * write here joins the open transaction by construction. Carrying a connection
 * field would be a field that can only ever hold one value.
 */

declare(strict_types=1);

namespace Omd\Imports;

use Omd\Database\Db;
use Omd\Support\Ids;

final class ImportContext
{
    public const CREATE = 'CREATE';
    public const UPDATE = 'UPDATE';
    public const UNCHANGED = 'UNCHANGED';
    public const SKIP = 'SKIP';

    /** @var list<string> */
    public array $warnings = [];

    /** @var array<string,array{created:int,updated:int,unchanged:int}> */
    private array $counts = [];

    public function __construct(
        public readonly string $batchId,
        public readonly ?string $userId = null,
    ) {
    }

    public function warn(string $message): void
    {
        $this->warnings[] = $message;
    }

    public function count(string $entityType, string $operation): void
    {
        $current = $this->counts[$entityType] ?? ['created' => 0, 'updated' => 0, 'unchanged' => 0];

        if ($operation === self::CREATE) {
            $current['created']++;
        } elseif ($operation === self::UPDATE) {
            $current['updated']++;
        } elseif ($operation === self::UNCHANGED) {
            $current['unchanged']++;
        }

        $this->counts[$entityType] = $current;
    }

    /** Records one entity outcome. Kept lightweight: details only when useful. */
    public function recordItem(
        string $entityType,
        ?string $externalKey,
        ?string $entityId,
        string $operation,
        ?string $message = null,
    ): void {
        $this->count($entityType, $operation);

        Db::execute(
            'INSERT INTO import_batch_items
               (id, import_batch_id, entity_type, external_key, entity_id, operation, status, message)
             VALUES (?, ?, ?, ?, ?, ?, \'SUCCESS\', ?)',
            [Ids::newId(), $this->batchId, $entityType, $externalKey, $entityId, $operation, $message],
        );
    }

    /** @return array<string,array{created:int,updated:int,unchanged:int}> */
    public function summary(): array
    {
        $summary = $this->counts;

        /*
         * Byte order, which is what Node's `localeCompare` produces here.
         *
         * ICU's default collation does not ignore punctuation: `_` carries a
         * lower primary weight than any letter, so `campaign_types` sorts
         * before `campaigns` — the same order `strcmp` gives, since `_` is 0x5F
         * and `s` is 0x73. Verified against the Node report for the same
         * package, not assumed: an earlier attempt here "corrected" for a
         * punctuation-ignoring collation that ICU does not use by default, and
         * produced the one ordering the two backends did not share.
         */
        ksort($summary, SORT_STRING);
        return $summary;
    }

    /** @return array{created:int,updated:int,unchanged:int} */
    public function totals(): array
    {
        $totals = ['created' => 0, 'updated' => 0, 'unchanged' => 0];
        foreach ($this->counts as $item) {
            $totals['created'] += $item['created'];
            $totals['updated'] += $item['updated'];
            $totals['unchanged'] += $item['unchanged'];
        }
        return $totals;
    }
}
