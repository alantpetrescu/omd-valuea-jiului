<?php

/**
 * Test harness for the PHP backend — runner, HTTP client, assertions.
 *
 * No dependencies, matching the rest of the backend: no Composer, no vendor
 * directory, nothing to install before `php tests/run.php` works. TASK-1 §3
 * proposes `node:test`, which cannot drive a PHP application; this is the same
 * idea in the language the backend is actually written in.
 *
 * Two safety rules, both load-bearing:
 *
 *   - the target database name must end in `_test`. These tests create, rename
 *     and delete strategic repere; pointed at staging they would quietly damage
 *     real work.
 *   - every mutating test works inside a scratch strategy version the suite
 *     creates and drops. The seeded version keeps its golden 4/8/18, which is
 *     itself asserted at the end.
 */

declare(strict_types=1);

final class Harness
{
    public static int $passed = 0;
    /** @var list<array{id:string,message:string}> */
    public static array $failures = [];

    private static ?string $baseUrl = null;
    /** @var array<string,string> role → session cookie */
    private static array $cookies = [];
    /** @var resource|null */
    private static $server = null;

    public const PASSWORD = 'Test-Parola-2026!';

    // ------------------------------------------------------------ assertions

    public static function check(string $id, string $what, bool $ok, string $detail = ''): void
    {
        // Flushed line by line: a suite that only prints at the end tells you
        // nothing about where it stopped when it does not reach the end.
        flush();

        if ($ok) {
            self::$passed++;
            printf("  \033[32m✓\033[0m %-10s %s\n", $id, $what);
            return;
        }
        self::$failures[] = ['id' => $id, 'message' => $what . ($detail !== '' ? " — {$detail}" : '')];
        printf("  \033[31m✗\033[0m %-10s %s%s\n", $id, $what, $detail !== '' ? " — {$detail}" : '');
    }

    public static function same(string $id, string $what, mixed $expected, mixed $actual): void
    {
        self::check(
            $id,
            $what,
            $expected === $actual,
            $expected === $actual ? '' : sprintf('așteptat %s, primit %s', json_encode($expected), json_encode($actual)),
        );
    }

    public static function group(string $title): void
    {
        printf("\n\033[1m%s\033[0m\n", $title);
    }

    // ---------------------------------------------------------------- server

    /**
     * `backend-php/`, from `tests/shared/`.
     *
     * The harness used to sit inside the backend, where `dirname(__DIR__)` was
     * it. Now that all three suites share this file from `tests/shared/`, the
     * backend has to be named rather than inferred from depth — one function,
     * so a future move breaks in one place instead of two.
     */
    public static function backendRoot(): string
    {
        return dirname(__DIR__, 2) . '/backend-php';
    }

    public static function database(): string
    {
        $name = getenv('OMD_TEST_DB') ?: 'omd_vj_test';
        if (!str_ends_with($name, '_test')) {
            fwrite(STDERR, "Refuz să rulez pe „{$name}”: numele bazei de test trebuie să se termine în _test.\n");
            exit(2);
        }
        return $name;
    }

    public static function boot(): void
    {
        $port = (int) (getenv('OMD_TEST_PORT') ?: 8099);
        self::$baseUrl = "http://127.0.0.1:{$port}";

        $root = self::backendRoot();
        $database = self::database();

        /*
         * Refuse to start if something already answers on the port.
         *
         * Not defensive padding — this cost a debugging session. A leftover
         * server keeps the port, the readiness probe below happily gets its
         * `{"status":"ok"}` from *that* process, and the whole suite then runs
         * against stale code and a stale database name while looking healthy.
         * Better to stop and say so.
         */
        $probe = @fsockopen('127.0.0.1', $port, $code, $message, 1);
        if (is_resource($probe)) {
            fclose($probe);
            fwrite(STDERR, "Portul {$port} este deja ocupat. Oprește serverul de acolo sau setează OMD_TEST_PORT.\n");
            exit(2);
        }

        /*
         * Two flags that both look optional and are not.
         *
         * `variables_order=EGPCS`: no web SAPI copies the process environment
         * into the superglobals, so without the `E` the test server would read
         * `.env` and run the destructive tests against staging.
         *
         * The trailing router script is what makes API paths reachable at all:
         * without it the built-in server only serves files that exist on disk,
         * and every endpoint answers 404.
         */
        /*
         * `OMD_TEST_PHP_FLAGS` inserts extra `php` arguments before `-S`.
         *
         * The child server inherits `PHP_BINARY`, but not the ini that binary
         * was started with — so running the suite on a second PHP build means
         * telling the child where its own extensions live. Without this, the
         * server silently starts without `pdo_mysql` and every request 500s.
         *
         *   $env:OMD_TEST_PHP_FLAGS = '-n -d extension_dir=... -d extension=pdo_mysql'
         */
        $extra = array_values(array_filter(
            preg_split('/\s+/', (string) (getenv('OMD_TEST_PHP_FLAGS') ?: '')) ?: [],
            static fn (string $part): bool => $part !== '',
        ));

        $command = array_merge(
            [PHP_BINARY],
            $extra,
            [
                '-d', 'variables_order=EGPCS',
                '-S', "127.0.0.1:{$port}",
                '-t', $root . '/public',
                $root . '/public/index.php',
            ],
        );

        // The log belongs beside the suite that produced it, not inside the
        // application. `tests/.work/` is also where the frontend runners write.
        $log = dirname(__DIR__) . '/.work/server.log';
        if (!is_dir(dirname($log))) {
            @mkdir(dirname($log), 0777, true);
        }
        $descriptors = [1 => ['file', $log, 'w'], 2 => ['file', $log, 'a']];

        /*
         * Only the string entries of `$_SERVER` travel: it also holds `argv`,
         * which is an array, and `proc_open` stringifies whatever it is given.
         *
         * `APP_ENV` stays `staging`. It looks like the place to write `test`, but
         * `Env` accepts only `staging` or `production` and refuses to boot on
         * anything else — the server would start and every request would answer
         * 500 with an invalid-configuration message.
         */
        $environment = ['DB_NAME' => $database, 'APP_ENV' => 'staging'];
        foreach ($_SERVER as $key => $value) {
            if (is_string($key) && is_string($value) && !isset($environment[$key])) {
                $environment[$key] = $value;
            }
        }

        /*
         * The command goes as an array, which matters on Windows: given a string,
         * `proc_open` runs it through `cmd /c`, and `proc_terminate` then kills
         * the `cmd` wrapper while the server keeps the port. Every run leaked a
         * listener, and the next run silently talked to it.
         */
        self::$server = proc_open($command, $descriptors, $pipes, $root, $environment);

        if (!is_resource(self::$server)) {
            fwrite(STDERR, "Serverul de test nu a putut fi pornit.\n");
            exit(2);
        }

        for ($attempt = 0; $attempt < 60; $attempt++) {
            usleep(200000);
            $probe = @file_get_contents(
                self::$baseUrl . '/api/v1/health',
                false,
                stream_context_create(['http' => ['timeout' => 3, 'ignore_errors' => true]]),
            );
            if ($probe !== false && str_contains($probe, 'status')) {
                printf("Server de test pe %s, baza %s\n", self::$baseUrl, $database);
                return;
            }
        }

        fwrite(STDERR, "Serverul de test nu răspunde.\n");
        self::shutdown();
        exit(2);
    }

    public static function shutdown(): void
    {
        if (is_resource(self::$server)) {
            proc_terminate(self::$server);
            proc_close(self::$server);
            self::$server = null;
        }
    }

    // ------------------------------------------------------------------- db

    public static function pdo(): PDO
    {
        static $pdo = null;
        if ($pdo instanceof PDO) {
            return $pdo;
        }

        $env = self::dotEnv();
        $pdo = new PDO(
            sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $env['DB_HOST'], $env['DB_PORT'], self::database()),
            $env['DB_USER'],
            $env['DB_PASSWORD'],
            [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false],
        );
        return $pdo;
    }

    /** @return array<string,string> */
    private static function dotEnv(): array
    {
        $out = ['DB_HOST' => '127.0.0.1', 'DB_PORT' => '3306', 'DB_USER' => '', 'DB_PASSWORD' => ''];
        $file = self::backendRoot() . '/.env';
        foreach (file($file, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
            $line = ltrim($line, "\u{FEFF} \t");
            if ($line === '' || $line[0] === '#' || !str_contains($line, '=')) {
                continue;
            }
            [$key, $value] = explode('=', $line, 2);
            $out[trim($key)] = trim($value);
        }
        return $out;
    }

    /** @return list<array<string,mixed>> */
    public static function rows(string $sql, array $params = []): array
    {
        $statement = self::pdo()->prepare($sql);
        $statement->execute($params);
        return $statement->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function scalar(string $sql, array $params = []): mixed
    {
        $statement = self::pdo()->prepare($sql);
        $statement->execute($params);
        return $statement->fetchColumn();
    }

    public static function exec(string $sql, array $params = []): int
    {
        $statement = self::pdo()->prepare($sql);
        $statement->execute($params);
        return $statement->rowCount();
    }

    // ----------------------------------------------------------------- users

    /**
     * Three users, one per role, with a known password.
     *
     * Created directly rather than through `bin/seed-technical.php`, which
     * generates a random password on purpose — excellent for an install, useless
     * for a test that has to log in afterwards.
     */
    public static function ensureUsers(): void
    {
        $roles = ['ADMIN' => 'Administrator', 'EDITOR' => 'Editor', 'VIEWER' => 'Vizualizare'];
        foreach ($roles as $code => $label) {
            $id = self::scalar('SELECT id FROM roles WHERE code = ?', [$code]);
            if ($id === false) {
                self::exec(
                    'INSERT INTO roles (id, code, label) VALUES (?, ?, ?)',
                    [self::uuid(), $code, $label],
                );
            }
        }

        // The application's own hasher, not `password_hash()` directly: node-argon2
        // and libargon2 disagree on the order of the PHC parameters, and
        // `Password` is where that difference is reconciled. A hash written any
        // other way verifies inconsistently.
        $hash = \Omd\Support\Password::hash(self::PASSWORD);

        foreach (array_keys($roles) as $code) {
            $email = strtolower($code) . '@test.local';
            $roleId = self::scalar('SELECT id FROM roles WHERE code = ?', [$code]);

            if (self::scalar('SELECT id FROM users WHERE email = ?', [$email]) === false) {
                self::exec(
                    'INSERT INTO users (id, role_id, name, email, password_hash, must_change_password)
                     VALUES (?, ?, ?, ?, ?, 0)',
                    [self::uuid(), $roleId, 'Test ' . $code, $email, $hash],
                );
            } else {
                self::exec(
                    'UPDATE users SET password_hash = ?, must_change_password = 0, is_active = 1 WHERE email = ?',
                    [$hash, $email],
                );
            }
        }
    }

    public static function uuid(): string
    {
        $bytes = random_bytes(16);
        $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40);
        $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80);
        return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4));
    }

    // ------------------------------------------------------------------ http

    /**
     * One request, as `$role`.
     *
     * @return array{status:int,body:array<string,mixed>|null,raw:string}
     */
    public static function request(string $method, string $path, mixed $body = null, string $role = 'ADMIN'): array
    {
        $headers = ['Accept: application/json'];
        if ($role !== '') {
            $headers[] = 'Cookie: ' . self::cookie($role);
        }

        $options = [
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'timeout' => 20,
            ],
        ];
        if ($body !== null) {
            $options['http']['header'] .= "\r\nContent-Type: application/json";
            $options['http']['content'] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }

        $raw = @file_get_contents(self::$baseUrl . $path, false, stream_context_create($options));
        $status = 0;
        foreach ($http_response_header ?? [] as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
            }
        }

        return [
            'status' => $status,
            'body' => $raw === false || $raw === '' ? null : json_decode($raw, true),
            'raw' => $raw === false ? '' : $raw,
        ];
    }

    private static function cookie(string $role): string
    {
        if (isset(self::$cookies[$role])) {
            return self::$cookies[$role];
        }

        $options = [
            'http' => [
                'method' => 'POST',
                'header' => "Content-Type: application/json\r\nAccept: application/json",
                'content' => json_encode([
                    'email' => strtolower($role) . '@test.local',
                    'password' => self::PASSWORD,
                ]),
                'ignore_errors' => true,
                'timeout' => 20,
            ],
        ];

        @file_get_contents(self::$baseUrl . '/api/v1/auth/login', false, stream_context_create($options));

        foreach ($http_response_header ?? [] as $line) {
            if (stripos($line, 'Set-Cookie:') === 0) {
                $value = trim(substr($line, 11));
                self::$cookies[$role] = explode(';', $value)[0];
                return self::$cookies[$role];
            }
        }

        fwrite(STDERR, "Autentificarea ca {$role} a eșuat.\n");
        exit(2);
    }

    /** The error code of a failed response, or '' when the shape is unexpected. */
    public static function errorCode(array $response): string
    {
        return (string) ($response['body']['error']['code'] ?? '');
    }

    public static function baseUrl(): string
    {
        return (string) self::$baseUrl;
    }

    /**
     * The session cookie for a role, logging in once and caching it.
     *
     * `request()` attaches this itself. `raw()` deliberately does not — it sends
     * exactly the headers it is given — so a test that needs both a session and
     * a custom header (`If-Match`, mostly) asks for the cookie here.
     */
    public static function cookieFor(string $role = 'ADMIN'): string
    {
        return self::cookie($role);
    }

    /**
     * One request, with the response headers kept.
     *
     * `request()` throws them away, which is fine for the ninety per cent of
     * tests that only care about the body. Everything about sessions, ETags and
     * caching lives in the headers, so those tests need this instead.
     *
     * @param list<string> $headers sent verbatim; nothing is added, not even a cookie
     * @return array{status:int,headers:list<string>,body:array<string,mixed>|null,raw:string}
     */
    public static function raw(string $method, string $path, mixed $body = null, array $headers = []): array
    {
        $headers[] = 'Accept: application/json';

        $options = [
            'http' => [
                'method' => $method,
                'ignore_errors' => true,
                'timeout' => 20,
            ],
        ];
        if ($body !== null) {
            $headers[] = 'Content-Type: application/json';
            $options['http']['content'] = json_encode($body, JSON_UNESCAPED_UNICODE);
        }
        $options['http']['header'] = implode("\r\n", $headers);

        $url = str_starts_with($path, 'http') ? $path : self::$baseUrl . $path;
        $raw = @file_get_contents($url, false, stream_context_create($options));

        $status = 0;
        $received = $http_response_header ?? [];
        foreach ($received as $line) {
            if (preg_match('#^HTTP/\S+\s+(\d{3})#', $line, $m) === 1) {
                $status = (int) $m[1];
            }
        }

        return [
            'status' => $status,
            'headers' => $received,
            'body' => $raw === false || $raw === '' ? null : json_decode($raw, true),
            'raw' => $raw === false ? '' : $raw,
        ];
    }

    /** The first response header whose name matches, or null. */
    public static function header(array $response, string $name): ?string
    {
        foreach ($response['headers'] as $line) {
            if (stripos($line, $name . ':') === 0) {
                return trim(substr($line, strlen($name) + 1));
            }
        }
        return null;
    }

    /** The session cookie of a login attempt, or null when it was refused. */
    public static function sessionCookie(array $response): ?string
    {
        $value = self::header($response, 'Set-Cookie');
        if ($value === null) {
            return null;
        }
        $pair = explode(';', $value)[0];
        // A logout sets the cookie to an empty value to clear it; that is not a
        // session, and a test that treats it as one would pass on a bug.
        return str_ends_with($pair, '=') ? null : $pair;
    }

    // ------------------------------------------------------------- fixtures

    /**
     * A campaign body the API will accept, built from whatever is actually in
     * the database rather than from constants.
     *
     * Seven codes have to exist and be active for a campaign to be creatable —
     * type, status, pillar, seasonality, program, objective, audience — and any
     * of them can be renamed by an administrator between one run and the next.
     * Reading them here means a renamed catalogue value changes nothing; a
     * hard-coded list would fail with "valoarea nu există în nomenclator" and
     * point at the wrong thing.
     *
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    public static function campaignPayload(array $overrides = []): array
    {
        static $codes = null;

        if ($codes === null) {
            $versionId = self::scalar(
                "SELECT id FROM strategy_versions WHERE status = 'ACTIVE' ORDER BY period_start_year LIMIT 1"
            );
            if ($versionId === false) {
                fwrite(STDERR, "Nu există o versiune strategică activă în baza de test.\n");
                exit(2);
            }

            $first = static fn (string $sql, array $params = []): string
                => (string) self::scalar($sql, $params);

            $codes = [
                'campaignTypeCode' => $first('SELECT code FROM campaign_types WHERE is_active = 1 ORDER BY code LIMIT 1'),
                'seasonalityTypeCode' => $first('SELECT code FROM seasonality_types WHERE is_active = 1 ORDER BY code LIMIT 1'),
                'primaryAudienceCode' => $first('SELECT code FROM audience_segments WHERE is_active = 1 ORDER BY code LIMIT 1'),
                'pillarCode' => $first(
                    'SELECT code FROM strategic_pillars WHERE strategy_version_id = ? AND is_active = 1 ORDER BY code LIMIT 1',
                    [$versionId],
                ),
                'programPrimaryCode' => $first(
                    'SELECT code FROM strategic_programs WHERE strategy_version_id = ? AND is_active = 1 ORDER BY code LIMIT 1',
                    [$versionId],
                ),
                'objectivePrimaryCode' => $first(
                    'SELECT code FROM strategic_objectives WHERE strategy_version_id = ? AND is_active = 1 ORDER BY code LIMIT 1',
                    [$versionId],
                ),
            ];
        }

        return array_merge($codes, [
            'title' => 'Campanie de test ' . substr(self::uuid(), 0, 8),
            'statusCode' => 'DRAFT',
            'seasonalityMonths' => [6, 7, 8],
            'marketingObjective' => 'Obiectiv de marketing de test.',
            'directResult' => 'Rezultat direct de test.',
            'insight' => 'Insight de test.',
            'valueProposition' => 'Propunere de valoare de test.',
            'centralIdea' => 'Idee centrală de test.',
            'promise' => 'Promisiune de test.',
            'mainMessage' => 'Mesaj principal de test.',
        ], $overrides);
    }

    /**
     * An activation body the API will accept. Only `title` is required, so this
     * is deliberately thin: a fixture that fills every field would hide the
     * difference between "the endpoint needs this" and "the test happened to
     * send it".
     *
     * @param array<string,mixed> $overrides
     * @return array<string,mixed>
     */
    public static function activationPayload(array $overrides = []): array
    {
        return array_merge([
            'title' => 'Activare de test ' . substr(self::uuid(), 0, 8),
            'statusCode' => 'DRAFT',
        ], $overrides);
    }

    // -------------------------------------------------------------- cleanup

    /** @var array<string,list<string>> table → external keys created by tests */
    private static array $created = [];

    /** Remember something to delete at the end of the run. */
    public static function track(string $table, string $externalKey): void
    {
        self::$created[$table][] = $externalKey;
    }

    /**
     * Hard-delete everything the tests created.
     *
     * The API only soft-deletes, by design — so without this every run would
     * leave its campaigns behind and the fixture counts asserted in
     * `regression.php` would climb until they stopped meaning anything.
     */
    public static function cleanup(): void
    {
        foreach (self::$created as $table => $keys) {
            foreach (array_unique($keys) as $key) {
                try {
                    $id = self::scalar("SELECT id FROM {$table} WHERE external_key = ?", [$key]);
                    if ($id === false) {
                        continue;
                    }

                    foreach (self::childTables($table) as [$childTable, $childColumn]) {
                        self::exec("DELETE FROM {$childTable} WHERE {$childColumn} = ?", [$id]);
                    }
                    self::exec("DELETE FROM {$table} WHERE id = ?", [$id]);
                } catch (Throwable $error) {
                    // A row still held somewhere is worth knowing about, but it
                    // must not abort the rest of the cleanup.
                    fwrite(STDERR, "Curățenie eșuată pentru {$table}/{$key}: {$error->getMessage()}\n");
                }
            }
        }
        self::$created = [];
    }

    /**
     * Every table with a foreign key pointing at `$table`, read from the schema.
     *
     * The relations are `ON DELETE RESTRICT` throughout — deliberately, so that
     * nothing in the application can erase history by deleting one row. That
     * makes a parent undeletable until its children are gone, and this is how the
     * suite finds out who they are. A hand-written list would work today and be
     * wrong the first time a table is added, which is exactly the failure nobody
     * notices: cleanup that quietly stops cleaning.
     *
     * @return list<array{0:string,1:string}> table and column
     */
    private static function childTables(string $table): array
    {
        static $cache = [];

        if (!isset($cache[$table])) {
            $cache[$table] = array_map(
                static fn (array $row): array => [(string) $row['t'], (string) $row['c']],
                self::rows(
                    'SELECT TABLE_NAME AS t, COLUMN_NAME AS c
                       FROM information_schema.KEY_COLUMN_USAGE
                      WHERE TABLE_SCHEMA = DATABASE()
                        AND REFERENCED_TABLE_NAME = ?
                      ORDER BY TABLE_NAME',
                    [$table],
                ),
            );
        }

        return $cache[$table];
    }
}
