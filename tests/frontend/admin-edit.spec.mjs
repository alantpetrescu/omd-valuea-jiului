/**
 * Administrare → Strategie: the only place the strategic repere are edited.
 *
 * The prototype has no counterpart, so this is checked on its own terms rather
 * than by comparison. What matters:
 *
 *   - all three kinds of reper are reachable and editable;
 *   - the code is shown but disabled on a reper that is used or was brought
 *     in by an import — it is the identity campaigns point at and the key the
 *     importer matches on (SPEC_ADMIN_STRATEGIE §4.1). It used to be hidden
 *     outright; TASK-2 replaced "never" with "only while nothing depends on it",
 *     and the deeper coverage of that rule lives in `tests/admin-strategy/`;
 *   - every column the PUT overwrites is present in the form, or a save would
 *     silently blank the fields the form omitted;
 *   - the write is scoped to a strategy version, and carries no `code` unless a
 *     rename was actually asked for;
 *   - a used reper still offers deactivation, and its delete is visibly
 *     unavailable rather than missing (spec 35.1.4).
 *
 * Requires the mock running with ROLE=ADMIN.
 */
import { chromium } from '../shared/deps.mjs';

import { ADMIN_URL, launchOptions } from '../shared/config.mjs';

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

/**
 * Opens the editor for `code` under the current kind and returns its field
 * labels, minus `Cod` — the three lists below count the columns a save writes,
 * and the code is not one of them.
 *
 * The row actions are icons now, so they are found by `title`, not by text.
 */
async function openEditor(kindLabel, code) {
  await page.locator('.sub-toggle button', { hasText: kindLabel }).click();
  await page.waitForTimeout(250);
  await page
    .locator('.activation-list-table tbody tr', { hasText: code })
    .last()
    // Selected by `data-tooltip`, not `title`. The bubble carries the short,
    // stable name; `title` carries the long explanation and changes whenever the
    // wording improves — which is exactly how this selector broke once.
    .locator('.activation-icon-btn[data-tooltip="Editează reperul"]')
    .click();
  await page.waitForTimeout(400);
  const labels = await page.locator('.strategy-form .form-label').allTextContents();
  return labels.filter((label) => !/^Cod/.test(label) && !/^Obiective SMART asociate/.test(label));
}

// A pillar — the reper that had no UI at all before this tab existed.
const pillarFields = await openEditor('Piloni', 'PILLAR_1');
check('pillar editor exposes its three columns', pillarFields.length === 3, pillarFields.join(' / '));

const pillarCode = page.locator('.strategy-form input').first();
check('pillar editor shows the code, disabled on a used reper',
  (await pillarCode.inputValue()) === 'PILLAR_1' && (await pillarCode.isDisabled()));

const NEW_HINT = 'Munte & outdoor, tot anul';
await page.locator('.strategy-form textarea').last().fill(NEW_HINT);
await page.locator('.strategy-form button', { hasText: 'Salvează' }).click();
await page.waitForTimeout(500);

let puts = await page.evaluate(async () => (await (await fetch('/api/v1/__puts')).json()).data);
let last = puts.at(-1);
check('pillar PUT is scoped to the version', last?.path === '/api/v1/strategy/strategy-2026-2028/pillars/PILLAR_1', last?.path);
check('pillar PUT carries every column', ['label', 'displayLabel', 'hint'].every((k) => k in (last?.body ?? {})), Object.keys(last?.body ?? {}).join(','));
check('pillar PUT omits the code when nothing was renamed',
  !('code' in (last?.body ?? {})) && !('newCode' in (last?.body ?? {})));

// A program — eleven columns, the case where an incomplete form would blank data.
const programFields = await openEditor('Programe', 'P5.3');
check('program editor exposes all eleven columns', programFields.length === 11, String(programFields.length));

// `nth(1)`: the first input is the code, which this form now shows.
await page.locator('.strategy-form input').nth(1).fill('Identitate de Brand (revizuit)');
await page.locator('.strategy-form button', { hasText: 'Salvează' }).click();
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

// Close the editor first. It is a modal now, not an inline block: its backdrop
// covers the sub-toggle below, and clicking through it times out with a message
// about a button that is plainly visible — one of the more confusing failures a
// suite can produce.
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// Deactivation stays the answer for a used reper — deletion is offered, but
// disabled, with the reason on it. A hidden button reads as a missing feature.
await page.locator('.sub-toggle button', { hasText: 'Programe' }).click();
await page.waitForTimeout(300);

const usedRow = page.locator('.activation-list-table').nth(1).locator('tbody tr', { hasText: 'campanii' }).first();
const rowTitles = await usedRow.locator('.strategy-row-actions button')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('title') ?? ''));
check('a used reper offers deactivate', rowTitles.some((t) => /Dezactivează/.test(t)), rowTitles.join(' / '));
check('its delete is present but unavailable, with the reason',
  await usedRow.locator('.activation-icon-btn.danger').isDisabled()
  && /folosit în/.test((await usedRow.locator('.activation-icon-btn.danger').getAttribute('title')) ?? ''));

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} admin-strategy checks passed`);
process.exit(failed.length ? 1 : 0);
