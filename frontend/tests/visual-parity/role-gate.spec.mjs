/**
 * `Repere strategice` is read-only for every role, ADMIN included.
 *
 * Editing moved to Administrare → Strategie (D-002), so no role may see an
 * edit affordance here — which is also what makes the pixel comparison against
 * the prototype hold with no exceptions.
 *
 * ROLE must match the role the running mock reports.
 */
import { chromium } from 'playwright';

import { APP_URL, launchOptions } from './config.mjs';

const role = process.env.ROLE ?? 'VIEWER';

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 2000 } });

await page.goto(APP_URL, { waitUntil: 'networkidle' });
await page.locator('.strategic-tabs button', { hasText: 'Programe și obiective' }).click();
await page.locator('.view-switch button', { hasText: 'Fișă' }).click();
await page.waitForTimeout(250);

// Any control that would write: a form field, a save button, an editor block.
const writable =
  (await page.locator('#strategicContent input, #strategicContent textarea').count()) +
  (await page.locator('#strategicContent button', { hasText: /Editează|Salvează/ }).count()) +
  (await page.locator('.detail-section', { hasText: 'Administrare reper' }).count());

const ok = writable === 0;
console.log(`${ok ? 'PASS' : 'FAIL'}  ${role}: write controls on the fiche = ${writable} (expected 0)`);

await browser.close();
process.exit(ok ? 0 : 1);
