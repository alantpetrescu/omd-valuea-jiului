<?php

/**
 * Audit log — port of `audit/audit-service.ts`.
 *
 * Records who changed what, when, and whether it came from the UI, an import or
 * the system. Passwords and tokens are never written here — `scrub()` is the
 * enforcement point, applied to both the old and the new value.
 */

declare(strict_types=1);

namespace Omd\Audit;

use Omd\Database\Db;
use Omd\Support\Ids;

final class Audit
{
    private const SENSITIVE = [
        'password',
        'passwordHash',
        'password_hash',
        'token',
        'currentPassword',
        'newPassword',
    ];

    /**
     * @param mixed $oldValues
     * @param mixed $newValues
     */
    public static function write(
        ?string $userId,
        string $action,
        string $entityType,
        ?string $entityId = null,
        ?string $entityExternalKey = null,
        mixed $oldValues = null,
        mixed $newValues = null,
        string $source = 'MANUAL',
        ?string $importBatchId = null,
    ): void {
        Db::execute(
            'INSERT INTO audit_log
               (id, user_id, action, entity_type, entity_id, entity_external_key, source,
                old_values, new_values, import_batch_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
                Ids::newId(),
                $userId,
                $action,
                $entityType,
                $entityId,
                $entityExternalKey,
                $source,
                $oldValues === null ? null : self::encode($oldValues),
                $newValues === null ? null : self::encode($newValues),
                $importBatchId,
            ],
        );
    }

    private static function encode(mixed $value): string
    {
        return (string) json_encode(self::scrub($value), JSON_UNESCAPED_UNICODE);
    }

    /** Strips anything that must never reach the audit table. */
    private static function scrub(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        $out = [];
        foreach ($value as $key => $item) {
            if (is_string($key) && in_array($key, self::SENSITIVE, true)) {
                continue;
            }
            $out[$key] = self::scrub($item);
        }
        return $out;
    }
}
