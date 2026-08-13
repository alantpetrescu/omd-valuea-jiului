/**
 * Contract/schema registry.
 *
 * Spec section 30.0: imports are dispatched on `(packageType, schemaVersion)`,
 * never by one hardcoded parser that gets rewritten destructively when a new
 * contract version appears.
 *
 *   (packageType, schemaVersion) -> validator -> adapter -> canonical DTO -> service
 *
 * When a 2.0 contract arrives it registers alongside 1.0; 1.0 keeps working and
 * stays reimportable. An unknown pair is rejected with a controlled message
 * rather than being guessed at.
 */
import fs from 'node:fs';
import path from 'node:path';

import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import { env } from '../config/env';

export const PACKAGE_TYPES = [
  'OMD_CAMPAIGNS_PACKAGE',
  'OMD_ACTIVATIONS_PACKAGE',
  'OMD_ACTIVATION_MONITORING_PACKAGE',
  'OMD_REPUTATION_MONITORING_PACKAGE',
] as const;

export type PackageType = (typeof PACKAGE_TYPES)[number];

/** Schema file per package type. Copied byte-identical from 03_JSON_CONTRACTS. */
const SCHEMA_FILES: Record<PackageType, string> = {
  OMD_CAMPAIGNS_PACKAGE: 'OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1.json',
  OMD_ACTIVATIONS_PACKAGE: 'OMD_ACTIVATIONS_PACKAGE_SCHEMA_v1.json',
  OMD_ACTIVATION_MONITORING_PACKAGE: 'OMD_ACTIVATION_MONITORING_PACKAGE_SCHEMA_v1.json',
  OMD_REPUTATION_MONITORING_PACKAGE: 'OMD_REPUTATION_MONITORING_PACKAGE_SCHEMA_v1.json',
};

/** Contract versions this release accepts. Frozen baseline is 1.0. */
const SUPPORTED_VERSIONS = ['1.0'] as const;

const CONTRACTS_DIR = path.resolve(env.repoRoot, 'contracts');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const validators = new Map<string, ValidateFunction>();

function key(packageType: string, schemaVersion: string): string {
  return `${packageType}@${schemaVersion}`;
}

function loadValidator(packageType: PackageType): ValidateFunction {
  const file = path.join(CONTRACTS_DIR, SCHEMA_FILES[packageType]);
  const schema = JSON.parse(fs.readFileSync(file, 'utf8'));
  return ajv.compile(schema);
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  return (errors ?? []).map((error) => {
    const where = error.instancePath || '(root)';
    return `${where} ${error.message ?? 'is invalid'}`.trim();
  });
}

export class UnsupportedPackageError extends Error {}

/**
 * Validates a parsed package against its contract schema.
 * Throws UnsupportedPackageError for a pair this release does not know.
 */
export function validateAgainstContract(parsed: unknown): ValidationResult & {
  packageType: PackageType;
  schemaVersion: string;
} {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new UnsupportedPackageError('The package must be a JSON object.');
  }

  const candidate = parsed as { packageType?: unknown; schemaVersion?: unknown };
  const packageType = String(candidate.packageType ?? '');
  const schemaVersion = String(candidate.schemaVersion ?? '');

  if (!PACKAGE_TYPES.includes(packageType as PackageType)) {
    throw new UnsupportedPackageError(
      `Unknown packageType "${packageType}". Expected one of: ${PACKAGE_TYPES.join(', ')}.`,
    );
  }
  if (!SUPPORTED_VERSIONS.includes(schemaVersion as (typeof SUPPORTED_VERSIONS)[number])) {
    throw new UnsupportedPackageError(
      `schemaVersion "${schemaVersion}" is not supported by this release ` +
        `(accepted: ${SUPPORTED_VERSIONS.join(', ')}).`,
    );
  }

  const typed = packageType as PackageType;
  const cacheKey = key(typed, schemaVersion);
  let validator = validators.get(cacheKey);
  if (!validator) {
    validator = loadValidator(typed);
    validators.set(cacheKey, validator);
  }

  const valid = validator(parsed) as boolean;
  return { valid, errors: valid ? [] : formatErrors(validator.errors), packageType: typed, schemaVersion };
}
