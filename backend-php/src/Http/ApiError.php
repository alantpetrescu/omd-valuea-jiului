<?php

/**
 * The error half of the API contract — port of `shared/http.ts`.
 *
 * Error body, identical to the Node original because the React client parses
 * exactly this shape:
 *
 *   { "error": { code, message, details, requestId } }
 */

declare(strict_types=1);

namespace Omd\Http;

use RuntimeException;

final class ApiError extends RuntimeException
{
    private const STATUS_BY_CODE = [
        'BAD_REQUEST' => 400,
        'UNAUTHENTICATED' => 401,
        'FORBIDDEN' => 403,
        'NOT_FOUND' => 404,
        'CONFLICT' => 409,
        'STALE_VERSION' => 409,
        'ENTITY_IN_USE' => 409,
        'SYSTEM_VALUE_PROTECTED' => 409,
        'PAYLOAD_TOO_LARGE' => 413,
        'VALIDATION_ERROR' => 422,
        'INTERNAL_ERROR' => 500,
    ];

    /** @param mixed $details */
    public function __construct(
        public readonly string $errorCode,
        string $message,
        public readonly mixed $details = null,
    ) {
        parent::__construct($message);
    }

    public function status(): int
    {
        return self::STATUS_BY_CODE[$this->errorCode] ?? 500;
    }

    public static function badRequest(string $message = 'Cerere invalidă.'): self
    {
        return new self('BAD_REQUEST', $message);
    }

    public static function unauthenticated(string $message = 'Autentificare necesară.'): self
    {
        return new self('UNAUTHENTICATED', $message);
    }

    public static function forbidden(string $message = 'Nu ai drepturi pentru această operație.'): self
    {
        return new self('FORBIDDEN', $message);
    }

    public static function notFound(string $message = 'Resursa nu a fost găsită.'): self
    {
        return new self('NOT_FOUND', $message);
    }

    /** @param mixed $details */
    public static function validation(string $message = 'Datele nu sunt valide.', mixed $details = null): self
    {
        return new self('VALIDATION_ERROR', $message, $details);
    }

    public static function conflict(string $message): self
    {
        return new self('CONFLICT', $message);
    }

    public static function staleVersion(
        string $message = 'Înregistrarea a fost modificată de altcineva între timp. Reîncarcă și încearcă din nou.'
    ): self {
        return new self('STALE_VERSION', $message);
    }
}
