<?php

/**
 * Identifier generation — port of `shared/ids.ts`.
 *
 * Two distinct identities per entity, as the spec requires:
 *
 *   id            CHAR(36) UUID, internal, never a business identity
 *   external_key  the stable key the API and UI speak
 *
 * External keys are immutable once assigned: never regenerated on edit, never
 * derived from the title, and never sequential — `camp-007` would eventually
 * collide with an imported package.
 */

declare(strict_types=1);

namespace Omd\Support;

final class Ids
{
    /**
     * A RFC 4122 version 4 UUID.
     *
     * `random_bytes` is cryptographically secure; PHP has no built-in
     * `randomUUID()` before 8.4, so the two version bits are set by hand.
     */
    public static function newId(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); // version 4
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); // variant 10

        $hex = bin2hex($bytes);
        return sprintf(
            '%s-%s-%s-%s-%s',
            substr($hex, 0, 8),
            substr($hex, 8, 4),
            substr($hex, 12, 4),
            substr($hex, 16, 4),
            substr($hex, 20, 12),
        );
    }

    /** External key for an entity created through the UI, e.g. `camp-3f2b…`. */
    public static function newExternalKey(string $prefix): string
    {
        return $prefix . '-' . self::newId();
    }
}
