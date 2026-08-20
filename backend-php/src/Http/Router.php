<?php

/**
 * Route table — what `express.Router()` provided.
 *
 * Patterns use Express's own `:name` syntax so the two backends can be diffed
 * route by route: `/campaigns/:externalKey/activations`.
 *
 * Matching is literal segment by segment, with `:name` capturing one segment.
 * No regular expression is built from the pattern, so a route can never be
 * widened by a character in a path.
 */

declare(strict_types=1);

namespace Omd\Http;

final class Router
{
    /** @var list<array{method:string,segments:list<string>,handler:callable,guards:list<callable>}> */
    private array $routes = [];

    /** @var list<callable> */
    private array $globalGuards = [];

    /** Runs before every matched route — used for `attachUser`. */
    public function before(callable $guard): void
    {
        $this->globalGuards[] = $guard;
    }

    /** @param list<callable> $guards */
    public function get(string $pattern, callable $handler, array $guards = []): void
    {
        $this->add('GET', $pattern, $handler, $guards);
    }

    /** @param list<callable> $guards */
    public function post(string $pattern, callable $handler, array $guards = []): void
    {
        $this->add('POST', $pattern, $handler, $guards);
    }

    /** @param list<callable> $guards */
    public function put(string $pattern, callable $handler, array $guards = []): void
    {
        $this->add('PUT', $pattern, $handler, $guards);
    }

    /** @param list<callable> $guards */
    public function delete(string $pattern, callable $handler, array $guards = []): void
    {
        $this->add('DELETE', $pattern, $handler, $guards);
    }

    /** @param list<callable> $guards */
    private function add(string $method, string $pattern, callable $handler, array $guards): void
    {
        $this->routes[] = [
            'method' => $method,
            'segments' => explode('/', trim($pattern, '/')),
            'handler' => $handler,
            'guards' => $guards,
        ];
    }

    /**
     * Finds and runs the handler.
     *
     * Returns false when nothing matched, so the front controller can answer
     * 404 in the API's own error shape rather than Apache's HTML page.
     */
    public function dispatch(Request $request): bool
    {
        $given = explode('/', trim($request->path, '/'));

        // A path that matches only on the wrong verb is still a 404 here, as it
        // is in the Express app: no route list is exposed through a 405.
        foreach ($this->routes as $route) {
            if ($route['method'] !== $request->method) {
                continue;
            }
            $params = self::match($route['segments'], $given);
            if ($params === null) {
                continue;
            }

            $request->params = $params;

            foreach ($this->globalGuards as $guard) {
                $guard($request);
            }
            foreach ($route['guards'] as $guard) {
                $guard($request);
            }

            ($route['handler'])($request);
            return true;
        }

        return false;
    }

    /**
     * @param list<string> $pattern
     * @param list<string> $given
     * @return array<string,string>|null
     */
    private static function match(array $pattern, array $given): ?array
    {
        if (count($pattern) !== count($given)) {
            return null;
        }

        $params = [];
        foreach ($pattern as $index => $segment) {
            $actual = $given[$index];
            if ($segment !== '' && $segment[0] === ':') {
                if ($actual === '') {
                    return null;
                }
                $params[substr($segment, 1)] = $actual;
                continue;
            }
            if ($segment !== $actual) {
                return null;
            }
        }

        return $params;
    }
}
