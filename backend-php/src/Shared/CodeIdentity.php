<?php

/**
 * When a code may still be changed, and what a valid one looks like.
 *
 * Two screens ask the same question about two different kinds of record —
 * Administrare → Strategie about a pilon, program or obiectiv, Administrare →
 * Nomenclatoare about a value in one of the ten catalogs — and the answer has to
 * be the same, because the reason is the same. A code is:
 *
 *   - the identity other rows point at, and
 *   - the key an import matches on (§33.5).
 *
 * Rename one that is already load-bearing and the next import of a package that
 * still uses the old value stops finding it, so it creates a second record. The
 * import stops being idempotent, which §32 and §57 require it to be.
 *
 * The rule was written first for the strategic repere (SPEC_ADMIN_STRATEGIE
 * §4.1). It lives here rather than there so the catalogs can apply it without
 * `Admin` depending on `Strategy`, and so there is one definition to change if
 * it ever has to change.
 */

declare(strict_types=1);

namespace Omd\Shared;

use Omd\Database\Db;
use Omd\Http\ApiError;

final class CodeIdentity
{
    /** `VARCHAR(64)` on every table that carries a code. */
    public const MAX_LENGTH = 64;

    /**
     * Validates a code without rewriting it (SPEC §3.1).
     *
     * No `strtoupper()`, no substitutions, no normalisation: `p5.9` stays
     * `p5.9`. The convention belongs to the beneficiary's documents, not to this
     * application, and silently correcting a value changes what its author
     * chose. The screen may *suggest* a convention; it must not impose one.
     *
     * Surrounding whitespace is the one thing trimmed, and it has to be: the
     * `utf8mb4_0900_ai_ci` collation is NO PAD, so `'P5.1 '` and `'P5.1'` are two
     * distinct values to a UNIQUE index. Accepting both would let a stray space
     * create a second, invisible record.
     */
    public static function normalize(mixed $raw): string
    {
        $code = is_string($raw) ? trim($raw) : '';

        if ($code === '') {
            throw ApiError::validation('Codul este obligatoriu.', [
                'fields' => [['path' => 'code', 'message' => 'Codul nu poate fi gol.']],
            ]);
        }
        if (mb_strlen($code) > self::MAX_LENGTH) {
            throw ApiError::validation(
                'Codul poate avea cel mult ' . self::MAX_LENGTH . ' de caractere.',
                ['fields' => [['path' => 'code', 'message' => 'Maximum ' . self::MAX_LENGTH . ' de caractere.']]],
            );
        }

        return $code;
    }

    /**
     * Whether a code may still be renamed.
     *
     * `$protected` covers what is structural rather than merely referenced: a
     * catalog value flagged `is_system` is compared by code in the application's
     * own logic, so renaming it breaks behaviour and not only imports. Strategic
     * repere have no such flag and always pass `false`.
     */
    public static function editable(int $businessRefs, bool $importTouched, bool $protected = false): bool
    {
        return $businessRefs === 0 && !$importTouched && !$protected;
    }

    /**
     * When an import first wrote this row, or null.
     *
     * Matched on `entity_id`, never on the code: the same code exists in several
     * strategy versions, and asking by code would lock a brand-new record
     * because a different version's namesake once came through an import.
     */
    public static function importedAt(string $recordId): ?string
    {
        $value = Db::scalar(
            'SELECT MIN(created_at) FROM import_batch_items WHERE entity_id = ?',
            [$recordId],
        );

        return is_string($value) && $value !== '' ? $value : null;
    }

    /** The `409` a refused rename produces. */
    public static function lockedError(string $code, array $dependencies, ?string $importedAt, bool $protected): ApiError
    {
        $reason = $protected
            ? 'Valoarea este necesară funcționării aplicației, iar codul ei nu poate fi schimbat.'
            : 'Codul nu mai poate fi schimbat: valoarea este folosită sau a fost adusă prin import.';

        return new ApiError('CODE_LOCKED', $reason, [
            'externalKey' => $code,
            'dependencies' => $dependencies,
            'importedAt' => $importedAt,
            'isSystem' => $protected,
        ]);
    }
}
