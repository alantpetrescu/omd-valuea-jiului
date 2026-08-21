<?php

/**
 * The success half of the API contract — port of `shared/http.ts`.
 *
 *   { "data": ..., "meta": { ... } }
 *
 * Every response leaves through here, so the envelope, the charset and the
 * `Cache-Control: no-store` rule are stated once.
 */

declare(strict_types=1);

namespace Omd\Http;

use Omd\Config\Env;
use Omd\Support\Logger;
use Throwable;

final class Response
{
    public const PAGE_SIZE_DEFAULT = 50;
    public const PAGE_SIZE_MAX = 200;

    /** @var array<string,string> */
    private static array $headers = [];

    private static int $status = 200;

    public static function status(int $code): void
    {
        self::$status = $code;
    }

    public static function header(string $name, string $value): void
    {
        self::$headers[$name] = $value;
    }

    /**
     * @param mixed $data
     * @param array<string,mixed>|null $meta
     */
    public static function data(mixed $data, ?array $meta = null): void
    {
        self::emit($meta === null ? ['data' => $data] : ['data' => $data, 'meta' => $meta]);
    }

    /** @param array<string,mixed> $payload */
    public static function raw(array $payload): void
    {
        self::emit($payload);
    }

    /**
     * A successful write with nothing to say — `204 No Content`.
     *
     * `status(204)` on its own would not do it: that call only records the code,
     * and the code is sent by whichever emitter runs next. A handler that set it
     * and then returned sent PHP's default 200 with an empty body, which reads
     * to a client as a malformed success.
     */
    public static function noContent(): void
    {
        self::$status = 204;
        http_response_code(204);
        foreach (self::$headers as $name => $value) {
            header($name . ': ' . $value);
        }
    }

    /**
     * Sends a file download — used by the campaign export endpoint.
     */
    public static function download(string $filename, string $body, string $type = 'application/json'): void
    {
        self::sendHeaders($type);
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $filename) . '"');
        header('Content-Length: ' . strlen($body));
        echo $body;
    }

    public static function error(Throwable $error, ?string $requestId): void
    {
        if ($error instanceof ApiError) {
            self::$status = $error->status();
            self::emit([
                'error' => [
                    'code' => $error->errorCode,
                    'message' => $error->getMessage(),
                    'details' => $error->details ?? [],
                    'requestId' => $requestId,
                ],
            ]);
            return;
        }

        Logger::error('unhandled error', [
            'message' => $error->getMessage(),
            'file' => $error->getFile() . ':' . $error->getLine(),
            'requestId' => $requestId,
        ]);

        self::$status = 500;
        self::emit([
            'error' => [
                'code' => 'INTERNAL_ERROR',
                'message' => 'A apărut o eroare neașteptată. Încearcă din nou.',
                // The message and stack are logged, never returned in production.
                'details' => Env::isProduction() ? [] : [$error->getMessage()],
                'requestId' => $requestId,
            ],
        ]);
    }

    public static function notFound(): void
    {
        self::$status = 404;
        self::emit([
            'error' => [
                'code' => 'NOT_FOUND',
                'message' => 'Resursa nu a fost găsită.',
                'details' => [],
                'requestId' => null,
            ],
        ]);
    }

    /**
     * Pagination, applied from v1 as the Node version does: a list endpoint
     * never promises to return everything.
     *
     * @return array{page:int,pageSize:int,offset:int}
     */
    public static function pagination(Request $request): array
    {
        $page = max(1, $request->queryInt('page', 1) ?? 1);
        $requested = $request->queryInt('pageSize', self::PAGE_SIZE_DEFAULT) ?? self::PAGE_SIZE_DEFAULT;
        $pageSize = min(self::PAGE_SIZE_MAX, max(1, $requested));

        return ['page' => $page, 'pageSize' => $pageSize, 'offset' => ($page - 1) * $pageSize];
    }

    /** @return array<string,mixed> */
    public static function pageMeta(int $total, int $page, int $pageSize): array
    {
        return [
            'total' => $total,
            'page' => $page,
            'pageSize' => $pageSize,
            'hasMore' => $page * $pageSize < $total,
        ];
    }

    /** @param array<string,mixed> $payload */
    private static function emit(array $payload): void
    {
        self::sendHeaders('application/json; charset=utf-8');
        echo json_encode(
            $payload,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION
        );
    }

    private static function sendHeaders(string $contentType): void
    {
        if (headers_sent()) {
            return;
        }
        http_response_code(self::$status);
        header('Content-Type: ' . $contentType);
        header('X-Content-Type-Options: nosniff');
        // API responses are user-scoped and the ETag carries version_number for
        // If-Match, not as a cache validator — so nothing here may be stored.
        header('Cache-Control: no-store');
        header_remove('X-Powered-By');
        foreach (self::$headers as $name => $value) {
            header($name . ': ' . $value);
        }
    }
}
