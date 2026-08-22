<?php

/**
 * The three accounts the hybrid suite logs in as.
 *
 *   php tests/hybrid/ensure-users.php
 *
 * `Harness::ensureUsers()` already knows how to make them — same e-mails, same
 * password, same hasher. This file exists only so the PowerShell runner can call
 * it without also starting a PHP server it does not need.
 */

declare(strict_types=1);

require __DIR__ . '/../shared/harness.php';

$_SERVER['DB_NAME'] = Harness::database();
require Harness::backendRoot() . '/src/bootstrap.php';

Harness::ensureUsers();

printf("Conturi de test pregătite în %s.\n", Harness::database());
