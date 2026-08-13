/**
 * Import CLI.
 *
 *   npm run import -- <file.json> [more.json ...]
 *
 * Same service the HTTP endpoints will call in Stage 2; this entry point exists
 * so staging can be seeded before auth is wired, and so the documented staging
 * seed procedure (spec section 43) is scriptable.
 */
import path from 'node:path';

import { closePool } from '../database/pool';
import { importPackageFile } from './import-service';

function pad(value: number): string {
  return String(value).padStart(4);
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  if (files.length === 0) {
    process.stderr.write('Usage: npm run import -- <package.json> [...]\n');
    process.exit(2);
  }

  let failed = false;

  for (const file of files) {
    const absolute = path.resolve(process.cwd(), file);
    process.stdout.write(`\n${path.basename(absolute)}\n`);

    const report = await importPackageFile(absolute);

    if (report.status !== 'SUCCESS') {
      failed = true;
      process.stdout.write(`  FAILED (${report.packageType ?? 'unknown package'})\n`);
      for (const error of report.errors) process.stdout.write(`    ! ${error}\n`);
      break; // ordering matters: later packages depend on earlier ones
    }

    process.stdout.write(`  ${report.packageType}  ${report.packageId ?? ''}\n`);
    process.stdout.write(`  created / updated / unchanged\n`);
    for (const [entity, counts] of Object.entries(report.summary)) {
      process.stdout.write(
        `    ${pad(counts.created)} ${pad(counts.updated)} ${pad(counts.unchanged)}  ${entity}\n`,
      );
    }
    for (const warning of report.warnings) process.stdout.write(`    ~ ${warning}\n`);
  }

  await closePool();
  process.exit(failed ? 1 : 0);
}

main().catch(async (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  await closePool().catch(() => undefined);
  process.exit(1);
});
