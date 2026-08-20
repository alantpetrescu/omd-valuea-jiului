<?php

/**
 * The incoming request — what Express gave handlers as `req`.
 *
 * Holds the parsed JSON body, the query string, the route parameters the router
 * matched, the cookies, and the authenticated user once the guard has resolved
 * one.
 */

declare(strict_types=1);

namespace Omd\Http;

use Omd\Auth\AuthenticatedUser;
use Omd\Config\Env;

final class Request
{
    /** @var array<string,string> */
    public array $params = [];

    public ?AuthenticatedUser $user = null;

    public readonly string $requestId;

    /**
     * @param array<string,mixed> $query
     * @param array<string,mixed>|null $body
     * @param array<string,string> $cookies
     * @param array<string,string> $headers lower-cased names
     */
    public function __construct(
        public readonly string $method,
        public readonly string $path,
        public readonly array $query,
        public readonly ?array $body,
        public readonly array $cookies,
        public readonly array $headers,
    ) {
        $this->requestId = bin2hex(random_bytes(8));
    }

    public static function fromGlobals(): self
    {
        $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $uri = (string) ($_SERVER['REQUEST_URI'] ?? '/');
        $path = parse_url($uri, PHP_URL_PATH);
        $path = is_string($path) ? $path : '/';

        // Passenger and mod_rewrite both hand the app the full original path, so
        // routes keep their `/api/v1` prefix exactly as Express declared them.
        $path = '/' . trim(rawurldecode($path), '/');

        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (is_string($key) && str_starts_with($key, 'HTTP_')) {
                $name = strtolower(str_replace('_', '-', substr($key, 5)));
                $headers[$name] = (string) $value;
            }
        }
        if (isset($_SERVER['CONTENT_TYPE'])) {
            $headers['content-type'] = (string) $_SERVER['CONTENT_TYPE'];
        }

        return new self($method, $path, $_GET, self::readJsonBody($headers), $_COOKIE, $headers);
    }

    /**
     * Parses the JSON body.
     *
     * A malformed body is a 400 rather than a silent null, matching
     * `express.json()`. The 1 MB ceiling is the same one the Node app applies;
     * imports travel by their own route with their own limit.
     *
     * @param array<string,string> $headers
     * @return array<string,mixed>|null
     */
    private static function readJsonBody(array $headers): ?array
    {
        $type = $headers['content-type'] ?? '';
        if (!str_contains($type, 'application/json')) {
            return null;
        }

        $raw = file_get_contents('php://input');
        if ($raw === false || $raw === '') {
            return null;
        }

        $limit = 1024 * 1024;
        if (strlen($raw) > $limit) {
            throw new ApiError('PAYLOAD_TOO_LARGE', 'Corpul cererii depășește 1 MB.');
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            throw ApiError::badRequest('Corpul cererii nu este JSON valid.');
        }

        return $decoded;
    }

    public function param(string $name): string
    {
        return $this->params[$name] ?? '';
    }

    public function queryString(string $name, string $fallback = ''): string
    {
        $value = $this->query[$name] ?? null;
        return is_scalar($value) ? trim((string) $value) : $fallback;
    }

    public function queryInt(string $name, ?int $fallback = null): ?int
    {
        $value = $this->queryString($name);
        if ($value === '' || !preg_match('/^-?\d+$/', $value)) {
            return $fallback;
        }
        return (int) $value;
    }

    public function header(string $name): ?string
    {
        return $this->headers[strtolower($name)] ?? null;
    }

    /** @return array<string,mixed> */
    public function body(): array
    {
        return $this->body ?? [];
    }

    /**
     * The client address, honouring `X-Forwarded-For` when a proxy is trusted.
     *
     * Same reasoning as `TRUST_PROXY` in the Node app: behind Apache or
     * Passenger, `REMOTE_ADDR` is the proxy, so without this the login rate
     * limiter would count every user as one client.
     */
    public function ip(): string
    {
        $direct = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');

        /*
         * Read through Env, not getenv().
         *
         * `getenv()` sees the process environment, while `.env` is parsed into
         * Env's own array and never becomes environment. So `TRUST_PROXY=1` in
         * `.env` — which is where the file itself says to put it — did nothing:
         * a setting that was documented, configurable and dead. On a host with
         * no proxy that happens to be the safe outcome, which is exactly why it
         * could sit there unnoticed.
         */
        $hops = (int) Env::string('TRUST_PROXY');
        if ($hops <= 0) {
            return $direct;
        }

        $forwarded = $this->header('x-forwarded-for');
        if ($forwarded === null) {
            return $direct;
        }

        $chain = array_values(array_filter(
            array_map('trim', explode(',', $forwarded)),
            static fn (string $entry): bool => $entry !== '',
        ));
        if ($chain === []) {
            return $direct;
        }

        /*
         * Count from the right, as Express does for a numeric `trust proxy`.
         *
         * Every proxy appends the address it received the request from, so the
         * rightmost entries were written by infrastructure and the leftmost is
         * whatever the client sent. Taking the leftmost — which this did — hands
         * the rate limiter a value the caller controls: a fresh
         * `X-Forwarded-For` per attempt and the login limiter never counts to
         * two.
         */
        return $chain[max(0, count($chain) - $hops)];
    }

    public function isSecure(): bool
    {
        if (($this->header('x-forwarded-proto') ?? '') === 'https') {
            return true;
        }
        $https = $_SERVER['HTTPS'] ?? '';
        return $https !== '' && strtolower((string) $https) !== 'off';
    }

    public function baseUrl(): string
    {
        return rtrim(Env::string('APP_BASE_URL'), '/');
    }
}
