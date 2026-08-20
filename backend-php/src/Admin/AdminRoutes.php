<?php

/**
 * Admin API — port of `admin/admin-routes.ts`.
 *
 * The deletion policy is the important part:
 *
 *   is_system                -> 409 SYSTEM_VALUE_PROTECTED, never deletable
 *   non-system, 0 references -> physical DELETE allowed
 *   non-system, referenced   -> 409 ENTITY_IN_USE, deactivate instead
 *
 * Reference counts include CLOSED, inactive and soft-deleted rows: anything
 * that physically still holds the reference. Counting only visible rows would
 * let a delete break history.
 */

declare(strict_types=1);

namespace Omd\Admin;

use Omd\Audit\Audit;
use Omd\Auth\Guard;
use Omd\Catalogs\MasterRegistry;
use Omd\Database\Db;
use Omd\Http\ApiError;
use Omd\Http\Request;
use Omd\Http\Response;
use Omd\Http\Router;
use Omd\Support\Ids;
use Omd\Support\Password;
use Omd\Support\Validate;
use PDOException;

final class AdminRoutes
{
    /**
     * Where each catalogue can be referenced from.
     *
     * Counts deliberately ignore `deleted_at`: a soft-deleted campaign still
     * holds the reference physically, and restoring it must not find a missing
     * value.
     *
     * @var array<string,list<array{label:string,sql:string}>>
     */
    private const USAGE_QUERIES = [
        'campaign_types' => [
            ['label' => 'CAMPAIGN', 'sql' => 'SELECT COUNT(*) FROM campaigns WHERE campaign_type_id = ?'],
        ],
        'campaign_statuses' => [
            ['label' => 'CAMPAIGN', 'sql' => 'SELECT COUNT(*) FROM campaigns WHERE status_id = ?'],
            ['label' => 'ACTIVATION', 'sql' => 'SELECT COUNT(*) FROM activations WHERE status_id = ?'],
        ],
        'audience_segments' => [
            ['label' => 'CAMPAIGN', 'sql' => 'SELECT COUNT(*) FROM campaign_audiences WHERE audience_segment_id = ?'],
            ['label' => 'ACTIVATION', 'sql' => 'SELECT COUNT(*) FROM activation_audiences WHERE audience_segment_id = ?'],
        ],
        'cta_types' => [
            ['label' => 'CAMPAIGN', 'sql' => 'SELECT COUNT(*) FROM campaign_ctas WHERE cta_type_id = ?'],
        ],
        'product_catalog' => [],
        'channel_catalog' => [],
        'seasonality_types' => [
            ['label' => 'CAMPAIGN', 'sql' => 'SELECT COUNT(*) FROM campaigns WHERE seasonality_type_id = ?'],
        ],
        'activation_channels' => [
            ['label' => 'ACTIVATION_MATERIAL', 'sql' => 'SELECT COUNT(*) FROM activation_materials WHERE channel_id = ?'],
        ],
        'implementation_modes' => [
            ['label' => 'ACTIVATION', 'sql' => 'SELECT COUNT(*) FROM activations WHERE implementation_mode_id = ?'],
        ],
        'funding_types' => [
            ['label' => 'ACTIVATION', 'sql' => 'SELECT COUNT(*) FROM activation_funding_sources WHERE funding_type_id = ?'],
        ],
    ];

    public static function register(Router $router): void
    {
        $admin = [Guard::requireAdmin()];

        $router->get('/api/v1/admin/users', [self::class, 'users'], $admin);
        $router->post('/api/v1/admin/users', [self::class, 'createUser'], $admin);
        $router->post('/api/v1/admin/users/:id/toggle-active', [self::class, 'toggleUser'], $admin);
        $router->put('/api/v1/admin/users/:id', [self::class, 'updateUser'], $admin);

        $router->get('/api/v1/admin/catalogs/:catalog/:code/usage', [self::class, 'catalogUsage'], $admin);
        $router->post('/api/v1/admin/catalogs/:catalog/:code/deactivate', [self::class, 'deactivateValue'], $admin);
        $router->get('/api/v1/admin/catalogs/:catalog', [self::class, 'catalog'], $admin);
        $router->post('/api/v1/admin/catalogs/:catalog', [self::class, 'createValue'], $admin);
        $router->put('/api/v1/admin/catalogs/:catalog/:code', [self::class, 'updateValue'], $admin);
        $router->delete('/api/v1/admin/catalogs/:catalog/:code', [self::class, 'deleteValue'], $admin);

        $router->get('/api/v1/admin/audit', [self::class, 'audit'], $admin);
        $router->get('/api/v1/admin/imports', [self::class, 'imports'], $admin);
        $router->get('/api/v1/admin/imports/:id', [self::class, 'importDetail'], $admin);
    }

    // -----------------------------------------------------------------------
    // Users
    // -----------------------------------------------------------------------

    public static function users(Request $request): void
    {
        $rows = Db::rows(
            'SELECT u.id, u.name, u.email, r.code AS role, u.is_active AS isActive,
                    u.must_change_password AS mustChangePassword, u.last_login_at AS lastLoginAt,
                    u.created_at AS createdAt
               FROM users u JOIN roles r ON r.id = u.role_id
              ORDER BY u.name'
        );
        foreach ($rows as &$row) {
            $row['isActive'] = (int) $row['isActive'];
            $row['mustChangePassword'] = (int) $row['mustChangePassword'];
        }
        unset($row);

        Response::data($rows);
    }

    /** @return array{name:string,email:string,role:string,password:?string} */
    private static function userInput(Request $request, bool $passwordRequired): array
    {
        $v = new Validate($request->body());
        $name = $v->string('name', required: true, max: 255);
        $email = $v->string('email', required: true, max: 255);
        $role = $v->enum('role', ['ADMIN', 'EDITOR', 'VIEWER'], null, required: true);
        $password = $v->nullableString('password');

        if ($email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            $v->fail('email', 'Adresa de e-mail nu este validă.');
        }
        if ($password !== null && mb_strlen($password) < 10) {
            $v->fail('password', 'Parola temporară trebuie să aibă minimum 10 caractere.');
        }
        if ($passwordRequired && $password === null) {
            $v->fail('password', 'Parola temporară este obligatorie.');
        }
        $v->check('Datele utilizatorului nu sunt valide.');

        return ['name' => $name, 'email' => $email, 'role' => (string) $role, 'password' => $password];
    }

    public static function createUser(Request $request): void
    {
        $input = self::userInput($request, passwordRequired: true);

        $existing = Db::one('SELECT id FROM users WHERE email = ?', [$input['email']]);
        if ($existing !== null) {
            throw ApiError::conflict('Există deja un utilizator cu acest e-mail.');
        }

        $role = Db::one('SELECT id FROM roles WHERE code = ?', [$input['role']]);
        if ($role === null) {
            throw ApiError::validation('Rol inexistent.');
        }

        $id = Ids::newId();
        // The user is forced to replace the temporary password at first login.
        Db::execute(
            'INSERT INTO users (id, role_id, name, email, password_hash, is_active,
                                must_change_password, created_by)
             VALUES (?, ?, ?, ?, ?, 1, 1, ?)',
            [
                $id, $role['id'], $input['name'], $input['email'],
                Password::hash((string) $input['password']), Guard::actorId($request),
            ],
        );

        Audit::write(
            userId: Guard::actorId($request),
            action: 'USER_CHANGE',
            entityType: 'USER',
            entityId: $id,
            entityExternalKey: $input['email'],
            newValues: ['name' => $input['name'], 'role' => $input['role']],
        );

        Response::status(201);
        Response::data(['id' => $id, 'email' => $input['email']]);
    }

    public static function updateUser(Request $request): void
    {
        $input = self::userInput($request, passwordRequired: false);
        $id = $request->param('id');

        $user = Db::one('SELECT id, email FROM users WHERE id = ?', [$id]);
        if ($user === null) {
            throw ApiError::notFound('Utilizatorul nu a fost găsit.');
        }

        $role = Db::one('SELECT id FROM roles WHERE code = ?', [$input['role']]);
        if ($role === null) {
            throw ApiError::validation('Rol inexistent.');
        }

        Db::execute(
            'UPDATE users SET name = ?, email = ?, role_id = ?, updated_by = ? WHERE id = ?',
            [$input['name'], $input['email'], $role['id'], Guard::actorId($request), $id],
        );

        // A new password is optional on edit; supplying one forces a change again.
        if ($input['password'] !== null) {
            Db::execute(
                'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
                [Password::hash($input['password']), $id],
            );
        }

        Audit::write(
            userId: Guard::actorId($request),
            action: 'USER_CHANGE',
            entityType: 'USER',
            entityId: $id,
            entityExternalKey: $input['email'],
            oldValues: ['email' => $user['email']],
            newValues: [
                'name' => $input['name'],
                'role' => $input['role'],
                'passwordReset' => $input['password'] !== null,
            ],
        );

        Response::data(['id' => $id]);
    }

    /** Users are deactivated, never deleted — audit rows reference them. */
    public static function toggleUser(Request $request): void
    {
        $id = $request->param('id');
        if ($id === Guard::actorId($request)) {
            throw ApiError::validation('Nu îți poți dezactiva propriul cont.');
        }

        $user = Db::one('SELECT is_active, email FROM users WHERE id = ?', [$id]);
        if ($user === null) {
            throw ApiError::notFound('Utilizatorul nu a fost găsit.');
        }

        $next = (int) $user['is_active'] === 1 ? 0 : 1;
        Db::execute(
            'UPDATE users SET is_active = ?, updated_by = ? WHERE id = ?',
            [$next, Guard::actorId($request), $id],
        );

        Audit::write(
            userId: Guard::actorId($request),
            action: 'USER_CHANGE',
            entityType: 'USER',
            entityId: $id,
            entityExternalKey: (string) $user['email'],
            newValues: ['isActive' => $next === 1],
        );

        Response::data(['id' => $id, 'isActive' => $next === 1]);
    }

    // -----------------------------------------------------------------------
    // Catalogues
    // -----------------------------------------------------------------------

    /** @return list<array{type:string,count:int}> */
    private static function dependenciesOf(string $catalog, string $id): array
    {
        $dependencies = [];
        foreach (self::USAGE_QUERIES[$catalog] ?? [] as $usage) {
            $total = Db::count($usage['sql'], [$id]);
            if ($total > 0) {
                $dependencies[] = ['type' => $usage['label'], 'count' => $total];
            }
        }
        return $dependencies;
    }

    public static function catalog(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));

        $rows = Db::rows(
            "SELECT id, code, label, display_label AS displayLabel, hint,
                    is_active AS isActive, is_system AS isSystem, sort_order AS sortOrder
               FROM {$catalog} ORDER BY sort_order, label"
        );

        $withUsage = [];
        foreach ($rows as $row) {
            $dependencies = self::dependenciesOf($catalog, (string) $row['id']);
            $usageCount = array_sum(array_column($dependencies, 'count'));

            // The internal id is not business identity; the code is.
            unset($row['id']);
            $row['isActive'] = (int) $row['isActive'];
            $row['isSystem'] = (int) $row['isSystem'];
            $row['sortOrder'] = (int) $row['sortOrder'];

            $withUsage[] = $row + ['usageCount' => $usageCount, 'dependencies' => $dependencies];
        }

        Response::data($withUsage);
    }

    /** @return array{code:?string,label:string,displayLabel:?string,hint:?string,sortOrder:int} */
    private static function catalogInput(Request $request): array
    {
        $v = new Validate($request->body());
        $out = [
            'code' => $v->nullableString('code', 100),
            'label' => $v->string('label', required: true, max: 255),
            'displayLabel' => $v->nullableString('displayLabel', 255),
            'hint' => $v->nullableString('hint'),
            'sortOrder' => $v->int('sortOrder', 0, min: 0) ?? 0,
        ];
        $v->check('Datele nomenclatorului nu sunt valide.');
        return $out;
    }

    public static function createValue(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));
        $input = self::catalogInput($request);

        if ($input['code'] === null) {
            throw ApiError::validation('Codul este obligatoriu.');
        }

        $existing = Db::one("SELECT id FROM {$catalog} WHERE code = ?", [$input['code']]);
        if ($existing !== null) {
            throw ApiError::conflict("Codul {$input['code']} există deja.");
        }

        $id = Ids::newId();
        // is_system is technical metadata and is never accepted from a payload;
        // the registry decides it.
        $isSystem = MasterRegistry::isSystemCode($catalog, $input['code']) ? 1 : 0;

        Db::execute(
            "INSERT INTO {$catalog}
               (id, code, label, display_label, hint, is_active, is_system, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)",
            [
                $id, $input['code'], $input['label'], $input['displayLabel'], $input['hint'],
                $isSystem, $input['sortOrder'], Guard::actorId($request),
            ],
        );

        Audit::write(
            userId: Guard::actorId($request),
            action: 'MASTER_DATA_CHANGE',
            entityType: strtoupper($catalog),
            entityId: $id,
            entityExternalKey: $input['code'],
            newValues: ['label' => $input['label']],
        );

        Response::status(201);
        Response::data(['code' => $input['code']]);
    }

    public static function updateValue(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));
        $input = self::catalogInput($request);
        $code = $request->param('code');

        $row = Db::one("SELECT id, label FROM {$catalog} WHERE code = ?", [$code]);
        if ($row === null) {
            throw ApiError::notFound("Valoarea {$code} nu a fost găsită.");
        }

        // The code is identity and stays immutable; only presentation changes.
        Db::execute(
            "UPDATE {$catalog} SET label = ?, display_label = ?, hint = ?, sort_order = ?, updated_by = ?
              WHERE id = ?",
            [
                $input['label'], $input['displayLabel'], $input['hint'],
                $input['sortOrder'], Guard::actorId($request), $row['id'],
            ],
        );

        Audit::write(
            userId: Guard::actorId($request),
            action: 'MASTER_DATA_CHANGE',
            entityType: strtoupper($catalog),
            entityId: (string) $row['id'],
            entityExternalKey: $code,
            oldValues: ['label' => $row['label']],
            newValues: ['label' => $input['label']],
        );

        Response::data(['code' => $code]);
    }

    /** Dependency preview, so the UI can explain before it asks to confirm. */
    public static function catalogUsage(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));
        $code = $request->param('code');

        $row = Db::one("SELECT id, is_system, is_active FROM {$catalog} WHERE code = ?", [$code]);
        if ($row === null) {
            throw ApiError::notFound("Valoarea {$code} nu a fost găsită.");
        }

        $dependencies = self::dependenciesOf($catalog, (string) $row['id']);
        $total = array_sum(array_column($dependencies, 'count'));

        Response::data([
            'canDelete' => (int) $row['is_system'] !== 1 && $total === 0,
            'canDeactivate' => (int) $row['is_system'] !== 1,
            'isSystem' => (int) $row['is_system'] === 1,
            'isActive' => (int) $row['is_active'] === 1,
            'dependencies' => $dependencies,
        ]);
    }

    public static function deactivateValue(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));
        $code = $request->param('code');

        $row = Db::one("SELECT id, is_system, is_active FROM {$catalog} WHERE code = ?", [$code]);
        if ($row === null) {
            throw ApiError::notFound("Valoarea {$code} nu a fost găsită.");
        }
        if ((int) $row['is_system'] === 1) {
            throw new ApiError(
                'SYSTEM_VALUE_PROTECTED',
                'Valoarea este necesară funcționării aplicației și nu poate fi dezactivată.',
            );
        }

        $next = (int) $row['is_active'] === 1 ? 0 : 1;
        Db::execute(
            "UPDATE {$catalog} SET is_active = ?, updated_by = ? WHERE id = ?",
            [$next, Guard::actorId($request), $row['id']],
        );

        Audit::write(
            userId: Guard::actorId($request),
            action: 'MASTER_DATA_CHANGE',
            entityType: strtoupper($catalog),
            entityId: (string) $row['id'],
            entityExternalKey: $code,
            newValues: ['isActive' => $next === 1],
        );

        Response::data(['code' => $code, 'isActive' => $next === 1]);
    }

    /**
     * Physical delete, permitted only for a non-system value with zero
     * references. The dependency check runs again here — a preview can go stale
     * between the user reading it and confirming.
     */
    public static function deleteValue(Request $request): void
    {
        $catalog = MasterRegistry::assertCatalog($request->param('catalog'));
        $code = $request->param('code');

        $row = Db::one("SELECT id, is_system, label FROM {$catalog} WHERE code = ?", [$code]);
        if ($row === null) {
            throw ApiError::notFound("Valoarea {$code} nu a fost găsită.");
        }
        if ((int) $row['is_system'] === 1) {
            throw new ApiError(
                'SYSTEM_VALUE_PROTECTED',
                'Valoarea este necesară funcționării aplicației și nu poate fi ștearsă.',
            );
        }

        $dependencies = self::dependenciesOf($catalog, (string) $row['id']);
        if ($dependencies !== []) {
            throw new ApiError(
                'ENTITY_IN_USE',
                'Elementul nu poate fi șters deoarece este utilizat în sistem.',
                [
                    'entityType' => strtoupper($catalog),
                    'externalKey' => $code,
                    'dependencies' => $dependencies,
                    'allowedAction' => 'DEACTIVATE',
                ],
            );
        }

        try {
            Db::execute("DELETE FROM {$catalog} WHERE id = ?", [$row['id']]);
        } catch (PDOException $error) {
            // FK RESTRICT is the safety net; surface it as a business conflict.
            if (Db::isMysqlError($error, Db::ERR_ROW_IS_REFERENCED)) {
                throw new ApiError(
                    'ENTITY_IN_USE',
                    'Elementul este utilizat în sistem și nu poate fi șters.',
                );
            }
            throw $error;
        }

        Audit::write(
            userId: Guard::actorId($request),
            action: 'MASTER_DATA_CHANGE',
            entityType: strtoupper($catalog),
            entityExternalKey: $code,
            oldValues: ['label' => $row['label']],
        );

        Response::data(['code' => $code, 'deleted' => true]);
    }

    // -----------------------------------------------------------------------
    // Audit and import history
    // -----------------------------------------------------------------------

    public static function audit(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $filters = [];
        $params = [];
        foreach (['entityType' => 'a.entity_type = ?', 'action' => 'a.action = ?'] as $key => $clause) {
            $value = $request->queryString($key);
            if ($value !== '') {
                $filters[] = $clause;
                $params[] = $value;
            }
        }
        $where = $filters === [] ? '' : 'WHERE ' . implode(' AND ', $filters);

        $total = Db::count("SELECT COUNT(*) FROM audit_log a {$where}", $params);

        $rows = Db::rows(
            "SELECT a.id, a.created_at AS createdAt, a.action, a.entity_type AS entityType,
                    a.entity_external_key AS entityExternalKey, a.source,
                    a.old_values AS oldValues, a.new_values AS newValues,
                    u.name AS userName, u.email AS userEmail
               FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
               {$where}
              ORDER BY a.created_at DESC " . Db::limit($pageSize, $offset),
            $params,
        );

        // JSON columns arrive as strings from PDO; the client expects objects.
        foreach ($rows as &$row) {
            $row['oldValues'] = $row['oldValues'] === null ? null : json_decode((string) $row['oldValues'], true);
            $row['newValues'] = $row['newValues'] === null ? null : json_decode((string) $row['newValues'], true);
        }
        unset($row);

        Response::data($rows, Response::pageMeta($total, $page, $pageSize));
    }

    public static function imports(Request $request): void
    {
        ['page' => $page, 'pageSize' => $pageSize, 'offset' => $offset] = Response::pagination($request);

        $total = Db::count('SELECT COUNT(*) FROM import_batches');

        $rows = Db::rows(
            'SELECT id, package_type AS packageType, package_id AS packageId,
                    schema_version AS schemaVersion, filename, purpose, source, status,
                    created_count AS createdCount, updated_count AS updatedCount,
                    unchanged_count AS unchangedCount, warning_count AS warningCount,
                    error_count AS errorCount, started_at AS startedAt, completed_at AS completedAt,
                    checksum_sha256 AS checksum
               FROM import_batches
              ORDER BY created_at DESC ' . Db::limit($pageSize, $offset)
        );
        foreach ($rows as &$row) {
            foreach (['createdCount', 'updatedCount', 'unchangedCount', 'warningCount', 'errorCount'] as $key) {
                $row[$key] = (int) $row[$key];
            }
        }
        unset($row);

        Response::data($rows, Response::pageMeta($total, $page, $pageSize));
    }

    public static function importDetail(Request $request): void
    {
        $id = $request->param('id');

        $batch = Db::one(
            'SELECT id, package_type AS packageType, package_id AS packageId, filename, status,
                    report_json AS report, started_at AS startedAt, completed_at AS completedAt
               FROM import_batches WHERE id = ?',
            [$id],
        );
        if ($batch === null) {
            throw ApiError::notFound('Importul nu a fost găsit.');
        }
        $batch['report'] = $batch['report'] === null
            ? null
            : json_decode((string) $batch['report'], true);

        $items = Db::rows(
            'SELECT entity_type AS entityType, external_key AS externalKey, operation, status, message
               FROM import_batch_items WHERE import_batch_id = ?
              ORDER BY entity_type, external_key LIMIT 500',
            [$id],
        );

        Response::data($batch + ['items' => $items]);
    }
}
