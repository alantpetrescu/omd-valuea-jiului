<?php

/**
 * Technical seed — port of `database/seed-technical.ts`.
 *
 *   php bin/seed-technical.php
 *
 * Creates the three roles and one ADMIN account, and backfills the protected
 * master codes. No campaigns, activations, catalogues or strategy: business
 * data arrives only through a JSON import.
 *
 * Safe to re-run. An existing admin is left alone and its password is never
 * reset — running this twice must not lock anybody out.
 */

declare(strict_types=1);

require __DIR__ . '/../src/bootstrap.php';

use Omd\Catalogs\MasterRegistry;
use Omd\Config\Env;
use Omd\Database\Db;
use Omd\Support\Ids;
use Omd\Support\Password;

/**
 * CLI, or included by the guarded public/setup.php.
 *
 * The hosting this port targets has no Terminal, so refusing every non-CLI
 * caller would make the database impossible to create. setup.php defines
 * OMD_SETUP only after checking the token, so this stays closed to the web at
 * large.
 */
if (PHP_SAPI !== 'cli' && !defined('OMD_SETUP')) {
    http_response_code(403);
    echo 'This script runs from the command line, or through setup.php.';
    exit(1);
}

/** STDERR does not exist under the web SAPI; echo reaches setup.php's output. */
if (!function_exists('omd_write_error')) {
    function omd_write_error(string $message): void
    {
        if (PHP_SAPI === 'cli' && defined('STDERR')) {
            fwrite(STDERR, $message);
            return;
        }
        echo $message;
    }
}

const ROLES = [
    ['code' => 'ADMIN', 'label' => 'Administrator'],
    ['code' => 'EDITOR', 'label' => 'Editor'],
    ['code' => 'VIEWER', 'label' => 'Viewer'],
];

/** Readable but high-entropy: four groups of five URL-safe characters. */
function temporaryPassword(): string
{
    $groups = [];
    for ($g = 0; $g < 4; $g++) {
        $groups[] = Password::temporary(5);
    }
    return implode('-', $groups);
}

function ensureRoles(): void
{
    foreach (ROLES as $role) {
        $existing = Db::one('SELECT id FROM roles WHERE code = ?', [$role['code']]);
        if ($existing !== null) {
            continue;
        }
        Db::execute(
            'INSERT INTO roles (id, code, label) VALUES (?, ?, ?)',
            [Ids::newId(), $role['code'], $role['label']],
        );
        printf("  role created: %s\n", $role['code']);
    }
}

function ensureAdminUser(): ?string
{
    $email = Env::string('SEED_ADMIN_EMAIL');

    $existing = Db::one('SELECT id FROM users WHERE email = ?', [$email]);
    if ($existing !== null) {
        printf("  admin user already exists (%s), password untouched\n", $email);
        return null;
    }

    $adminRole = Db::one("SELECT id FROM roles WHERE code = 'ADMIN'");
    if ($adminRole === null) {
        throw new RuntimeException('ADMIN role missing — roles must be seeded first.');
    }

    $password = temporaryPassword();
    Db::execute(
        'INSERT INTO users (id, role_id, name, email, password_hash, is_active, must_change_password)
         VALUES (?, ?, ?, ?, ?, 1, 1)',
        [Ids::newId(), $adminRole['id'], Env::string('SEED_ADMIN_NAME'), $email, Password::hash($password)],
    );

    return $password;
}

/** Confirms the rule that business tables stay empty until a JSON import. */
function reportBusinessTables(): void
{
    $tables = array_merge(
        MasterRegistry::CATALOGS,
        ['strategy_versions', 'campaigns', 'activations', 'annual_plans'],
    );

    $nonEmpty = [];
    foreach ($tables as $table) {
        $total = Db::count("SELECT COUNT(*) FROM {$table}");
        if ($total > 0) {
            $nonEmpty[] = "{$table}={$total}";
        }
    }

    if ($nonEmpty !== []) {
        printf("  note: business tables are not empty (expected after a JSON import): %s\n",
            implode(', ', $nonEmpty));
    } else {
        printf("  business tables are empty, as required before the first import\n");
    }
}

try {
    printf("Technical seed (%s)\n", Env::string('DB_NAME'));
    printf("  password hashing: %s\n", Password::algorithm());

    if (!Password::hasArgon2()) {
        omd_write_error(
            "  WARNING: this PHP has no Argon2 support, so new passwords use bcrypt.\n"
            . "  Existing Argon2 hashes still verify. See backend-php/README.md.\n");
    }

    $temporaryAdminPassword = Db::transaction(static function (): ?string {
        ensureRoles();
        return ensureAdminUser();
    });

    $corrected = MasterRegistry::backfillSystemFlags();
    printf("  protected master codes backfilled: %d\n", $corrected);

    reportBusinessTables();

    $roles = Db::rows('SELECT code FROM roles ORDER BY code');
    $users = Db::count('SELECT COUNT(*) FROM users');
    printf("\ntechnical seed complete — roles: %s, users: %d\n",
        implode(', ', array_column($roles, 'code')), $users);

    if ($temporaryAdminPassword !== null) {
        // Printed once and never stored in recoverable form. The account is
        // created with must_change_password = 1.
        echo (
            "\n  ADMIN account created\n"
            . '    email:    ' . Env::string('SEED_ADMIN_EMAIL') . "\n"
            . '    password: ' . $temporaryAdminPassword . "\n"
            . "  Shown once. Must be changed at first login.\n\n");
    }

    exit(0);
} catch (Throwable $error) {
    omd_write_error("\ntechnical seed failed:\n" . $error->getMessage() . "\n");
    exit(1);
}
