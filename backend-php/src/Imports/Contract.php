<?php

/**
 * Contract registry — port of `imports/contract-registry.ts`.
 *
 * Imports are dispatched on `(packageType, schemaVersion)`, never by one
 * hardcoded parser rewritten destructively when a new contract appears:
 *
 *   (packageType, schemaVersion) -> validator -> adapter -> canonical DTO
 *
 * When a 2.0 contract arrives it registers alongside 1.0; 1.0 keeps working and
 * stays reimportable. An unknown pair is rejected with a controlled message
 * rather than guessed at.
 */

declare(strict_types=1);

namespace Omd\Imports;

use Omd\Config\Env;
use RuntimeException;

final class Contract
{
    public const PACKAGE_TYPES = [
        'OMD_CAMPAIGNS_PACKAGE',
        'OMD_ACTIVATIONS_PACKAGE',
        'OMD_ACTIVATION_MONITORING_PACKAGE',
        'OMD_REPUTATION_MONITORING_PACKAGE',
    ];

    /** Schema file per package type. Byte-identical to 03_JSON_CONTRACTS. */
    private const SCHEMA_FILES = [
        'OMD_CAMPAIGNS_PACKAGE' => 'OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1.json',
        'OMD_ACTIVATIONS_PACKAGE' => 'OMD_ACTIVATIONS_PACKAGE_SCHEMA_v1.json',
        'OMD_ACTIVATION_MONITORING_PACKAGE' => 'OMD_ACTIVATION_MONITORING_PACKAGE_SCHEMA_v1.json',
        'OMD_REPUTATION_MONITORING_PACKAGE' => 'OMD_REPUTATION_MONITORING_PACKAGE_SCHEMA_v1.json',
    ];

    /** Contract versions this release accepts. The frozen baseline is 1.0. */
    private const SUPPORTED_VERSIONS = ['1.0'];

    /** @var array<string,JsonSchema> */
    private static array $validators = [];

    /**
     * Validates a package against its contract schema.
     *
     * @param array<string,mixed>|object $package
     * @return array{valid:bool,errors:list<string>,packageType:string,schemaVersion:string}
     */
    public static function validate(array|object $package): array
    {
        // Normalise through JSON so objects and arrays are unambiguous. A PHP
        // empty array is both `[]` and `{}`; after this round trip the tree is
        // exactly what would be written to the file.
        $encoded = json_encode($package, JSON_UNESCAPED_UNICODE);
        if ($encoded === false) {
            throw new RuntimeException('Pachetul nu a putut fi serializat pentru validare.');
        }
        $document = json_decode($encoded, false);

        if (!is_object($document)) {
            throw new RuntimeException('The package must be a JSON object.');
        }

        $packageType = (string) ($document->packageType ?? '');
        $schemaVersion = (string) ($document->schemaVersion ?? '');

        if (!in_array($packageType, self::PACKAGE_TYPES, true)) {
            throw new RuntimeException(sprintf(
                'Unknown packageType "%s". Expected one of: %s.',
                $packageType,
                implode(', ', self::PACKAGE_TYPES),
            ));
        }
        if (!in_array($schemaVersion, self::SUPPORTED_VERSIONS, true)) {
            throw new RuntimeException(sprintf(
                'schemaVersion "%s" is not supported by this release (accepted: %s).',
                $schemaVersion,
                implode(', ', self::SUPPORTED_VERSIONS),
            ));
        }

        $errors = self::validator($packageType)->validate($document);

        return [
            'valid' => $errors === [],
            'errors' => $errors,
            'packageType' => $packageType,
            'schemaVersion' => $schemaVersion,
        ];
    }

    private static function validator(string $packageType): JsonSchema
    {
        if (isset(self::$validators[$packageType])) {
            return self::$validators[$packageType];
        }

        $file = Env::contractsDir() . '/' . self::SCHEMA_FILES[$packageType];
        $raw = @file_get_contents($file);
        if ($raw === false) {
            throw new RuntimeException(
                "Schema contractului nu a fost găsită: {$file}. "
                . 'Directorul contracts/ trebuie să fie lângă backend-php/, nu în el.'
            );
        }

        $schema = json_decode($raw, false);
        if (!is_object($schema)) {
            throw new RuntimeException("Schema contractului nu este JSON valid: {$file}");
        }

        return self::$validators[$packageType] = new JsonSchema($schema);
    }
}
