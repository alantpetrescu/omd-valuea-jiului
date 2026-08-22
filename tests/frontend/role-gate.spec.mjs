/**
 * AS-U-37, AS-U-38 — `/admin` reached by someone who may not use it.
 *
 * The `Administrare` link is hidden for non-ADMIN, but the route is not: a
 * bookmark or a typed URL lands there. Before this the page rendered in full and
 * every tab's request came back 403, so the screen filled with error notes that
 * read like a broken application rather than a closed door.
 *
 * Run once per role, with the mock started as that role.
 */
import { chromium } from '../shared/deps.mjs';

import { ADMIN_URL, launchOptions } from '../shared/config.mjs';

const role = process.env.ROLE || 'VIEWER';
const checks = [];
const check = (id, name, ok, detail = '') => {
  checks.push({ id, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1440, height: 1200 } });

const crashes = [];
page.on('pageerror', (error) => crashes.push(error.message));

await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

const id = role === 'VIEWER' ? 'AS-U-38' : 'AS-U-37';
const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

if (role === 'ADMIN') {
  check('AS-U-37c', 'ADMIN vede în continuare ecranul complet',
    (await page.locator('.wizard-step').count()) === 5, String(await page.locator('.wizard-step').count()));
} else {
  check(id, `${role}: ecran care explică, fără crash`,
    /Nu ai drepturi pentru administrare/.test(body) && crashes.length === 0,
    body.slice(0, 80));
  check(`${id}b`, `${role}: nu se încearcă nicio filă de administrare`,
    (await page.locator('.wizard-step').count()) === 0
    && (await page.locator('.state-note.error').count()) === 0);
}

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificări role-gate (${role})`);
process.exit(failed.length ? 1 : 0);
