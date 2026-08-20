<?php

/**
 * Import orchestration — port of `imports/import-service.ts`.
 *
 * One shape for all four package types (spec section 30):
 *
 *   read bytes -> sha256 -> parse -> identify (packageType, schemaVersion)
 *   -> JSON Schema validation -> business validation
 *   -> stage asset files in temp
 *   -> BEGIN -> import_batch -> writes -> publish files -> verify -> COMMIT
 *
 * Any failure rolls the database back, deletes files published during this run
 * and marks the batch FAILED. A partial import is never left behind.
 */

declare(strict_types=1);

namespace Omd\Imports;

use Omd\Activations\ActivationImport;
use Omd\Assets\Storage;
use Omd\Campaigns\CampaignImport;
use Omd\Catalogs\CatalogImport;
use Omd\Database\Db;
use Omd\Monitoring\MonitoringImport;
use Omd\Strategy\StrategyImport;
use Omd\Support\Ids;
use Omd\Support\Logger;
use RuntimeException;
use Throwable;

final class ImportService
{
    /**
     * Imports one package file.
     *
     * Never throws for a bad package: a rejected import is a report with
     * `status = FAILED`, because the caller — CLI or HTTP route — has to show
     * the reason either way, and an exception would make the two paths format
     * the same failure differently.
     *
     * @return array{
     *   status:string, packageType:?string, packageId:?string, schemaVersion:?string,
     *   checksum:string, batchId:?string,
     *   summary:array<string,array{created:int,updated:int,unchanged:int}>,
     *   warnings:list<string>, errors:list<string>
     * }
     */
    public static function importFile(string $filePath, ?string $userId = null): array
    {
        $bytes = @file_get_contents($filePath);
        if ($bytes === false) {
            return self::report('', errors: ["Fișierul nu poate fi citit: {$filePath}"]);
        }

        $checksum = hash('sha256', $bytes);
        $filename = basename(str_replace('\\', '/', $filePath));

        $parsed = json_decode($bytes, true);
        if (!is_array($parsed)) {
            $reason = json_last_error() === JSON_ERROR_NONE
                ? 'rădăcina trebuie să fie un obiect JSON'
                : json_last_error_msg();
            return self::report($checksum, errors: ["Fișierul nu este JSON valid: {$reason}"]);
        }

        try {
            $validation = Contract::validate($parsed);
        } catch (Throwable $error) {
            return self::report($checksum, errors: [$error->getMessage()]);
        }

        $packageType = $validation['packageType'];
        $schemaVersion = $validation['schemaVersion'];

        if (!$validation['valid']) {
            return self::report(
                $checksum,
                packageType: $packageType,
                schemaVersion: $schemaVersion,
                // Capped at 50: a structurally wrong package can produce
                // thousands of errors, and nobody reads past the first screen.
                errors: array_slice($validation['errors'], 0, 50),
            );
        }

        $metadata = is_array($parsed['metadata'] ?? null) ? $parsed['metadata'] : [];
        $packageId = isset($metadata['packageId']) ? (string) $metadata['packageId'] : null;

        // Decode assets before opening the transaction so a long CPU/IO step does
        // not hold locks (spec section 24: decode -> temp -> BEGIN -> ... -> COMMIT).
        $staged = [];
        if ($packageType === 'OMD_CAMPAIGNS_PACKAGE') {
            try {
                $staged = CampaignImport::stageAssets($parsed['campaigns'] ?? []);
            } catch (Throwable $error) {
                return self::report(
                    $checksum,
                    packageType: $packageType,
                    packageId: $packageId,
                    schemaVersion: $schemaVersion,
                    errors: [$error->getMessage()],
                );
            }
        }

        $published = [];
        $batchId = self::createBatch($packageType, $schemaVersion, $metadata, $filename, $checksum, $userId);

        try {
            $result = Db::transaction(static function () use (
                $parsed,
                $packageType,
                $batchId,
                $userId,
                $staged,
                &$published,
            ): array {
                $ctx = new ImportContext($batchId, $userId);

                switch ($packageType) {
                    case 'OMD_CAMPAIGNS_PACKAGE':
                        $campaigns = $parsed['campaigns'] ?? [];
                        $strategy = StrategyImport::import($parsed['strategicData'] ?? [], $ctx);
                        $catalogs = CatalogImport::importCatalogs($parsed['catalogs'] ?? [], $ctx);
                        $published = CampaignImport::import($campaigns, $catalogs, $strategy, $staged, $ctx);

                        // Post-import verification before COMMIT (spec 30.2).
                        $total = Db::count(
                            'SELECT COUNT(*) FROM campaigns WHERE strategy_version_id = ? AND deleted_at IS NULL',
                            [$strategy['strategyVersionId']],
                        );
                        if ($total < count($campaigns)) {
                            throw new RuntimeException(
                                'Verificarea post-import nu a confirmat numărul de campanii.'
                            );
                        }
                        break;

                    case 'OMD_ACTIVATIONS_PACKAGE':
                        $activations = $parsed['activations'] ?? [];
                        $published = ActivationImport::import(
                            $activations,
                            $parsed['annualPlans'] ?? [],
                            $ctx,
                        );

                        $total = Db::count('SELECT COUNT(*) FROM activations WHERE deleted_at IS NULL');
                        if ($total < count($activations)) {
                            throw new RuntimeException(
                                'Verificarea post-import nu a confirmat numărul de activări.'
                            );
                        }
                        break;

                    case 'OMD_ACTIVATION_MONITORING_PACKAGE':
                        MonitoringImport::importPerformanceSnapshots(
                            $parsed['performanceSnapshots'] ?? [],
                            $ctx,
                        );
                        break;

                    case 'OMD_REPUTATION_MONITORING_PACKAGE':
                        MonitoringImport::importReputationSnapshots(
                            $parsed['reputationSnapshots'] ?? [],
                            $ctx,
                        );
                        break;
                }

                $totals = $ctx->totals();
                Db::execute(
                    "UPDATE import_batches
                        SET status = 'SUCCESS', completed_at = CURRENT_TIMESTAMP(6),
                            created_count = ?, updated_count = ?, unchanged_count = ?, warning_count = ?,
                            report_json = ?
                      WHERE id = ?",
                    [
                        $totals['created'],
                        $totals['updated'],
                        $totals['unchanged'],
                        count($ctx->warnings),
                        json_encode(
                            ['summary' => $ctx->summary(), 'warnings' => $ctx->warnings],
                            JSON_UNESCAPED_UNICODE,
                        ) ?: '{}',
                        $batchId,
                    ],
                );

                return ['summary' => $ctx->summary(), 'warnings' => $ctx->warnings];
            });

            self::discardStaged($staged);

            return self::report(
                $checksum,
                status: 'SUCCESS',
                packageType: $packageType,
                packageId: $packageId,
                schemaVersion: $schemaVersion,
                batchId: $batchId,
                summary: $result['summary'],
                warnings: $result['warnings'],
            );
        } catch (Throwable $error) {
            self::unpublish($published);
            self::discardStaged($staged);

            try {
                Db::execute(
                    "UPDATE import_batches
                        SET status = 'FAILED', completed_at = CURRENT_TIMESTAMP(6),
                            error_count = 1, report_json = ?
                      WHERE id = ?",
                    [json_encode(['error' => $error->getMessage()], JSON_UNESCAPED_UNICODE) ?: '{}', $batchId],
                );
            } catch (Throwable) {
                // The run already failed; failing to record that must not
                // replace the real error with a second one.
            }

            return self::report(
                $checksum,
                packageType: $packageType,
                packageId: $packageId,
                schemaVersion: $schemaVersion,
                batchId: $batchId,
                errors: [$error->getMessage()],
            );
        }
    }

    /**
     * Creates the batch row OUTSIDE the import transaction, deliberately.
     *
     * If it were created inside, a rollback would delete the record of the
     * failure along with the failed data, and Admin > Importuri would show
     * nothing at all for a run that visibly failed.
     *
     * @param array<string,mixed> $metadata
     */
    private static function createBatch(
        string $packageType,
        string $schemaVersion,
        array $metadata,
        string $filename,
        string $checksum,
        ?string $userId,
    ): string {
        $id = Ids::newId();

        Db::execute(
            "INSERT INTO import_batches
               (id, package_type, package_id, schema_version, filename, checksum_sha256, source, purpose,
                application, notes, generated_at, status, created_by, started_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', ?, CURRENT_TIMESTAMP(6))",
            [
                $id,
                $packageType,
                $metadata['packageId'] ?? null,
                $schemaVersion,
                $filename,
                $checksum,
                $metadata['source'] ?? null,
                $metadata['purpose'] ?? null,
                $metadata['application'] ?? null,
                $metadata['notes'] ?? null,
                self::toMysqlDateTime($metadata['generatedAt'] ?? null),
                $userId,
            ],
        );

        return $id;
    }

    /** ISO-8601 to a MySQL DATETIME literal. Both sides are UTC. */
    private static function toMysqlDateTime(mixed $iso): ?string
    {
        if (!is_string($iso) || trim($iso) === '') {
            return null;
        }
        $timestamp = strtotime($iso);
        return $timestamp === false ? null : gmdate('Y-m-d H:i:s', $timestamp);
    }

    /** Removes files this run published, used when the transaction is rolled back. */
    private static function unpublish(array $storageKeys): void
    {
        foreach ($storageKeys as $key) {
            try {
                Storage::delete($key);
            } catch (Throwable $error) {
                Logger::warn('could not remove published asset during rollback', [
                    'storageKey' => $key,
                    'error' => $error->getMessage(),
                ]);
            }
        }
    }

    /** @param array<string,array<string,mixed>> $staged */
    private static function discardStaged(array $staged): void
    {
        foreach ($staged as $file) {
            if (is_string($file['temporaryPath'] ?? null) && is_file($file['temporaryPath'])) {
                @unlink($file['temporaryPath']);
            }
        }
    }

    /**
     * @param array<string,array{created:int,updated:int,unchanged:int}> $summary
     * @param list<string> $warnings
     * @param list<string> $errors
     * @return array<string,mixed>
     */
    private static function report(
        string $checksum,
        string $status = 'FAILED',
        ?string $packageType = null,
        ?string $packageId = null,
        ?string $schemaVersion = null,
        ?string $batchId = null,
        array $summary = [],
        array $warnings = [],
        array $errors = [],
    ): array {
        return [
            'status' => $status,
            'packageType' => $packageType,
            'packageId' => $packageId,
            'schemaVersion' => $schemaVersion,
            'checksum' => $checksum,
            'batchId' => $batchId,
            'summary' => $summary,
            'warnings' => $warnings,
            'errors' => $errors,
        ];
    }
}
