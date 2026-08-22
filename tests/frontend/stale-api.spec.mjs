/**
 * Regression: an API older than this screen must be diagnosed, not crashed on.
 *
 * `GET /strategy` grew `campaigns` and `audiences` for this screen. A backend
 * still serving a stale compiled build answers 200 without them. The first
 * version of the page read `payload.campaigns.map(...)` and white-screened with
 * "can't access property map, all is undefined".
 *
 * Two things are asserted, and the second matters as much as the first: no
 * runtime error, AND no silently-zeroed coverage. Rendering "0/8 programe
 * asociate" from an incomplete payload would be a wrong answer stated as fact.
 *
 * Requires the mock running with LEGACY=1.
 */
import { chromium } from '../shared/deps.mjs';

import { APP_URL, launchOptions } from '../shared/config.mjs';

const checks = [];
const check = (name, ok, detail = '') => {
  checks.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on('pageerror', (error) => errors.push(error.message));

await page.goto(APP_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);

check('no runtime error', errors.length === 0, errors.join(' | '));

const note = (await page.locator('.state-note.error').textContent().catch(() => '')) ?? '';
check('an explanation is rendered', note.length > 0);
check('it names the missing fields', note.includes('campaigns') && note.includes('audiences'));
check('it says what to do', /npm run (dev|build)/.test(note));

// The screen must not pretend to know the coverage it cannot compute.
check('no stats row is drawn', (await page.locator('.strategic-stats').count()) === 0);
check('no tabs are drawn', (await page.locator('.strategic-tabs').count()) === 0);

await browser.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} stale-API checks passed`);
process.exit(failed.length ? 1 : 0);
