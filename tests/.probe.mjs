/** Throwaway: dumps what the campaigns screen actually renders. */
import { chromium } from './shared/deps.mjs';

const BASE = process.env.OMD_APP_URL?.replace(/\/strategic$/, '') ?? 'http://127.0.0.1:5175';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 200)); });

await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
await page.locator('input[type="email"]').first().fill('admin@test.local');
await page.locator('input[type="password"]').first().fill('Test-Parola-2026!');
await page.locator('button[type="submit"]').first().click();
await page.waitForTimeout(2500);

console.log('URL:', page.url());

const classes = await page.evaluate(() => {
  const seen = new Map();
  for (const node of document.querySelectorAll('.content *')) {
    for (const name of node.classList) seen.set(name, (seen.get(name) ?? 0) + 1);
  }
  return [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 45);
});
console.log('CLASSES:', JSON.stringify(classes));

console.log('INPUTS:', await page.locator('input').count());
console.log('TEXT:', (await page.locator('.content').first().textContent()).replace(/\s+/g, ' ').slice(0, 500));

await browser.close();
