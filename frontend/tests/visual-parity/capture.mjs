/**
 * Captures one side of the comparison.
 *
 *   SIDE=proto|react  which application to drive
 *   MODE=static|interactive  which set of states to walk
 *
 * Both sides are driven through the same visible controls — tab buttons, view
 * switch, sub-toggle, search box — so neither gets a private back door into
 * state that the other lacks. The prototype is seeded by its own external-JSON
 * importer, exactly as it is in the handoff.
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  APP_URL,
  KIND_LABEL,
  KIND_STATES,
  PROTO_URL,
  SCENARIOS,
  SHOTS,
  STATIC_STATES,
  TAB_LABEL,
  VIEWPORT,
  VIEW_LABEL,
  contentBox,
  launchOptions,
} from './config.mjs';

const side = process.env.SIDE;
const mode = process.env.MODE ?? 'static';
if (!['proto', 'react'].includes(side)) throw new Error('SIDE must be proto or react');
if (!['static', 'interactive'].includes(mode)) throw new Error('MODE must be static or interactive');

const out = resolve(SHOTS, `${side}-${mode}`);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const problems = [];
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

if (side === 'proto') {
  await page.goto(PROTO_URL, { waitUntil: 'networkidle' });
  // autoSeedDemo fires on DOMContentLoaded; wait for the six campaigns to land.
  await page.waitForFunction(() => window.OMD?.repositories?.campaign?.list?.().length === 6, null, { timeout: 30000 });
  await page.evaluate(() => window.OMD.app.navigate('strategic'));
  // Toasts live 3s and would otherwise burn into the reference images.
  await page.waitForTimeout(3500);
  await page.evaluate(() => document.querySelector('.toastbox')?.remove());
} else {
  await page.goto(APP_URL, { waitUntil: 'networkidle' });
}
await page.waitForSelector('.strategic-tabs', { timeout: 20000 });

async function act([action, value]) {
  if (action === 'tab') await page.locator('.strategic-tabs button', { hasText: TAB_LABEL[value] }).click();
  else if (action === 'view') await page.locator('.view-switch button', { hasText: VIEW_LABEL[value] }).click();
  else if (action === 'kind') await page.locator('.sub-toggle button', { hasText: KIND_LABEL[value] }).click();
  else if (action === 'jump') await page.locator('.diagnostic-row').first().click();
  else if (action === 'card') await page.locator('.strategic-card').nth(Number(value)).click();
  else if (action === 'search') {
    const input = page.locator('.strategic-toolbar input');
    await input.fill('');
    await input.type(value, { delay: 5 });
  } else if (action === 'select') {
    const select = page.locator('.detail-selector select');
    const wanted =
      value === 'audience::last' ? await select.locator('option').last().getAttribute('value') : value;
    // Derived ids are lowercased; official codes keep their case.
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value));
    await select.selectOption(options.find((o) => o.toLowerCase() === String(wanted).toLowerCase()) ?? wanted);
  }
  await page.waitForTimeout(150);
}

const shots = {};
async function capture(name) {
  await page.screenshot({ path: resolve(out, `${name}.png`), clip: await contentBox(page) });
  shots[name] = await page.evaluate(() => document.querySelector('.content').innerHTML);
}

if (mode === 'static') {
  for (const [tab, view] of STATIC_STATES) {
    await act(['tab', tab]);
    await act(['view', view]);
    await capture(`${tab}-${view}`);
  }
  for (const [tab, view, kind] of KIND_STATES) {
    await act(['tab', tab]);
    await act(['view', view]);
    await act(['kind', kind]);
    await capture(`${tab}-${view}-${kind}`);
  }
} else {
  for (const scenario of SCENARIOS) {
    // Reset to a known state so scenarios cannot leak into one another.
    await act(['tab', 'summary']);
    await act(['view', 'matrix']);
    await page.locator('.strategic-toolbar input').fill('');
    await page.waitForTimeout(100);

    for (const step of scenario.steps) await act(step);
    await capture(scenario.name);
  }
}

writeFileSync(resolve(SHOTS, `${side}-${mode}-dom.json`), JSON.stringify(shots, null, 2));
console.log(`${side}/${mode}: captured ${Object.keys(shots).length} states${problems.length ? ` (${problems.join('; ')})` : ''}`);
if (problems.length) process.exitCode = 1;
await browser.close();
