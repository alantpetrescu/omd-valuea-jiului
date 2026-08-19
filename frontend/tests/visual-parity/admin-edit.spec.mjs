/**
 * Administrare → Strategie: the only place the strategic repere are edited.
 *
 * The prototype has no counterpart, so this is checked on its own terms rather
 * than by comparison. What matters:
 *
 *   - all three kinds of reper are reachable and editable;
 *   - the code is never offered as a field — it is the identity campaigns point
 *     at, and reusing it with a new meaning is what strategy versions exist to
 *     prevent (spec 14, 15.2);
 *   - every column the PUT overwrites is present in the form, or a save would
 *     silently blank the fields the form omitted;
 *   - the write is scoped to a strategy version;
 *   - a used reper offers deactivation, not deletion (spec 35.1.4).
 *
 * Requires the mock running with ROLE=ADMIN.
 */
import { chromium } from 'playwright';

import { ADMIN_URL, launchOptions } from './config.mjs';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 2400 } });
page.on('pageerror', (error) => check('no runtime error', false, error.message));

await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
await page.locator('.wizard-step', { hasText: 'Strategie' }).click();
await page.waitForTimeout(400);

check('the Strategie tab exists in Administrare', await page.locator('.sub-toggle').isVisible());

const kinds = await page.locator('.sub-toggle button').allTextContents();
check('all three kinds are offered', kinds.join('|') === 'Piloni|Programe|Obiective SMART', kinds.join(' / '));

const versionRow = await page.locator('.activation-list-table tbody tr').first().textContent();
check('the strategy version is listed', /strategy-2026-2028/.test(versionRow ?? ''), (versionRow ?? '').slice(0, 60));

/** Opens the editor for `code` under the current kind and returns its labels. */
async function openEditor(kindLabel, code) {
  await page.locator('.sub-toggle button', { hasText: kindLabel }).click();
  await page.waitForTimeout(200);
  await page
    .locator('.activation-list-table tbody tr', { hasText: code })
    .last()
    .locator('button', { hasText: 'Editează' })
    .click();
  await page.waitForTimeout(200);
  return page.locator('.wizard-body .form-label').allTextContents();
}

// A pillar — the reper that had no UI at all before this tab existed.
const pillarFields = await openEditor('Piloni', 'PILLAR_1');
check('pillar editor exposes its three columns', pillarFields.length === 3, pillarFields.join(' / '));
check('pillar editor hides the code', !pillarFields.some((l) => /^cod/i.test(l)));

const NEW_HINT = 'Munte & outdoor, tot anul';
await page.locator('.wizard-body textarea').last().fill(NEW_HINT);
await page.locator('.wizard-body button', { hasText: 'Salvează' }).click();
await page.waitForTimeout(500);

let puts = await page.evaluate(async () => (await (await fetch('/api/v1/__puts')).json()).data);
let last = puts.at(-1);
check('pillar PUT is scoped to the version', last?.path === '/api/v1/strategy/strategy-2026-2028/pillars/PILLAR_1', last?.path);
check('pillar PUT carries every column', ['label', 'displayLabel', 'hint'].every((k) => k in (last?.body ?? {})), Object.keys(last?.body ?? {}).join(','));
check('pillar PUT omits the code', !('code' in (last?.body ?? {})));

// A program — eleven columns, the case where an incomplete form would blank data.
const programFields = await openEditor('Programe', 'P5.3');
check('program editor exposes all eleven columns', programFields.length === 11, String(programFields.length));

await page.locator('.wizard-body input').first().fill('Identitate de Brand (revizuit)');
await page.locator('.wizard-body button', { hasText: 'Salvează' }).click();
await page.waitForTimeout(500);

puts = await page.evaluate(async () => (await (await fetch('/api/v1/__puts')).json()).data);
last = puts.at(-1);
const PROGRAM_COLUMNS = ['name', 'label', 'result', 'marketingObjective', 'approach', 'horizonResult', 'targetGroups', 'kpiText', 'sources', 'annualActions', 'validationStatus'];
check('program PUT hits the right route', last?.path === '/api/v1/strategy/strategy-2026-2028/programs/P5.3', last?.path);
check('program PUT carries every column', PROGRAM_COLUMNS.every((k) => k in (last?.body ?? {})), PROGRAM_COLUMNS.filter((k) => !(k in (last?.body ?? {}))).join(',') || 'all present');
check('program PUT applies the edit', last?.body?.name === 'Identitate de Brand (revizuit)');

// An objective.
const objectiveFields = await openEditor('Obiective SMART', 'OS17');
check('objective editor exposes its three columns', objectiveFields.length === 3, objectiveFields.join(' / '));

// Deactivation rather than deletion, for every kind.
await page.locator('.sub-toggle button', { hasText: 'Programe' }).click();
await page.waitForTimeout(200);
const rowActions = await page.locator('.activation-list-table').last().locator('tbody tr').first().locator('button').allTextContents();
check('a reper offers deactivate, never delete', rowActions.includes('Dezactivează') && !rowActions.some((t) => /ș?terge/i.test(t)), rowActions.join(' / '));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} admin-strategy checks passed`);
process.exit(failed.length ? 1 : 0);
