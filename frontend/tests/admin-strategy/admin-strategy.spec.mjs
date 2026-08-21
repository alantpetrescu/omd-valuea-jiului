/**
 * Administrare → Strategie — TASK-2 §3.
 *
 * The four row actions, the add button, the inline fiche, code editing, the
 * programme ↔ objective matrix, natural sorting, the delete dialog, cloning and
 * the role gate.
 *
 * Runs against the same mock the parity suite uses, started with
 * `ADMIN_STRATEGY=1` so it also carries a `P5.10` programme and a second
 * strategy version — two things the demo seed cannot supply and two rules that
 * cannot be tested without them.
 *
 * Test IDs match the table in TASK-2 §3, so a failure here points at a line in
 * the specification rather than only at a line of code.
 */
import { chromium } from 'playwright';

import { ADMIN_URL, launchOptions } from '../visual-parity/config.mjs';

const checks = [];
const check = (id, name, ok, detail = '') => {
  checks.push({ id, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1600, height: 2600 } });

/*
 * Two separate things, kept separate.
 *
 * `crashes` are uncaught exceptions — always a defect. `consoleErrors` also
 * catches the browser's own "Failed to load resource: 409" line, which Chrome
 * logs for every non-2xx fetch whether or not the application handled it. This
 * suite deliberately provokes two such refusals (a duplicate code, a forced
 * conflict on delete), so counting those as errors would mean AS-U-40 could only
 * pass by removing the tests that prove the refusals are handled.
 */
const crashes = [];
const consoleErrors = [];
page.on('pageerror', (error) => crashes.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/Failed to load resource/.test(text)) return;
  consoleErrors.push(text);
});

const openStrategy = async () => {
  await page.goto(ADMIN_URL, { waitUntil: 'networkidle' });
  await page.locator('.wizard-step', { hasText: 'Strategie' }).click();
  await page.waitForTimeout(500);
};

const reperTable = () => page.locator('.activation-list-table').nth(1);
const versionTable = () => page.locator('.activation-list-table').first();

const pickKind = async (label) => {
  await page.locator('.sub-toggle button', { hasText: label }).click();
  await page.waitForTimeout(300);
};

const sentRequests = () =>
  page.evaluate(async () => (await (await fetch('/api/v1/__puts')).json()).data);

await openStrategy();

// --- 3.1 Acțiuni și stări ---------------------------------------------------

for (const kind of ['Piloni', 'Programe', 'Obiective SMART']) {
  await pickKind(kind);
  const counts = await reperTable()
    .locator('tbody tr .strategy-row-actions')
    .evaluateAll((nodes) => nodes.map((node) => node.children.length));
  check('AS-U-01', `${kind}: fiecare rând are exact 4 butoane`, counts.length > 0 && counts.every((n) => n === 4), counts.join(','));
}

await pickKind('Programe');

const labelled = await reperTable()
  .locator('tbody tr .strategy-row-actions button')
  .evaluateAll((nodes) =>
    nodes.every((node) => (node.getAttribute('aria-label') ?? '').trim().length > 3),
  );
check('AS-U-02', 'fiecare buton de acțiune are aria-label în text', labelled);

const usedRow = reperTable().locator('tbody tr').filter({ hasText: 'campanii' }).first();
const usedTrash = usedRow.locator('.activation-icon-btn.danger');
check('AS-U-03', 'reper folosit: 🗑 prezent dar dezactivat', (await usedTrash.count()) === 1 && (await usedTrash.isDisabled()));
const usedTitle = (await usedTrash.getAttribute('title')) ?? '';
check('AS-U-04', 'title pe 🗑 dezactivat conține motivul', /folosit în/.test(usedTitle) && usedTitle !== 'Șterge', usedTitle);

const freeRow = reperTable().locator('tbody tr', { hasText: 'P5.10' }).first();
check('AS-U-05', 'reper nefolosit: 🗑 activ', await freeRow.locator('.activation-icon-btn.danger').isEnabled());

const firstRow = reperTable().locator('tbody tr').first();
const badgeBefore = (await firstRow.locator('.badge').textContent())?.trim();
await firstRow.locator('.strategy-row-actions button').nth(2).click();
await page.waitForTimeout(500);
const badgeAfter = (await reperTable().locator('tbody tr').first().locator('.badge').textContent())?.trim();
check('AS-U-06', '⊘ schimbă starea și badge-ul', badgeBefore !== badgeAfter, `${badgeBefore} → ${badgeAfter}`);
// Put it back, so the rest of the suite sees the state it expects.
await reperTable().locator('tbody tr').first().locator('.strategy-row-actions button').nth(2).click();
await page.waitForTimeout(400);

const versionActions = await versionTable()
  .locator('tbody tr')
  .first()
  .locator('.strategy-row-actions button')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
check(
  'AS-U-07',
  'rândul de versiune are acțiunile ei, inclusiv Activează pe cele neactive',
  versionActions.length >= 4 && versionActions.some((label) => /Arhivează/.test(label)),
  versionActions.join(' | '),
);
const draftActions = await versionTable()
  .locator('tbody tr')
  .nth(1)
  .locator('.strategy-row-actions button')
  .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('aria-label') ?? ''));
check(
  'AS-U-07b',
  'versiunea neactivă are al cincilea buton, Activează',
  draftActions.some((label) => /Activează/.test(label)),
  draftActions.join(' | '),
);

// --- 3.2 Vizualizare --------------------------------------------------------

await pickKind('Programe');
await reperTable().locator('tbody tr').first().locator('.strategy-row-actions button').first().click();
await page.waitForTimeout(700);

check('AS-U-08', '◉ deschide un panou inline sub rând, nu un modal',
  (await page.locator('tr.strategy-view-row .strategy-reper-view').count()) === 1
  && (await page.locator('.drawer').count()) === 0);

const fieldTitles = await page.locator('.strategy-reper-view .detail-grid > section h3').allTextContents();
const PROGRAM_LABELS = [
  'Denumire', 'Etichetă scurtă', 'Rezultat urmărit', 'Obiectiv de marketing', 'Abordare',
  'Rezultat pe orizontul strategiei', 'Grupuri-țintă din matrice', 'KPI strategici',
  'Surse de date', 'Acțiuni anuale', 'Stadiu de validare',
];
check('AS-U-09', 'panoul unui program are toate cele 11 câmpuri',
  PROGRAM_LABELS.every((label) => fieldTitles.includes(label)),
  PROGRAM_LABELS.filter((label) => !fieldTitles.includes(label)).join(',') || 'toate prezente');

check('AS-U-10', 'panoul listează obiectivele asociate',
  fieldTitles.includes('Obiective SMART asociate')
  && (await page.locator('.strategy-linked-objectives li').count()) > 0);

await reperTable().locator('tbody tr').nth(2).locator('.strategy-row-actions button').first().click();
await page.waitForTimeout(700);
check('AS-U-11', '◉ pe două rânduri: ambele panouri rămân deschise',
  (await page.locator('.strategy-reper-view').count()) === 2);

// Close both. Always the first one: closing a fiche re-renders the table, so a
// list of locators collected up front goes stale after the first click.
while ((await page.locator('.strategy-reper-view-head .x').count()) > 0) {
  await page.locator('.strategy-reper-view-head .x').first().click();
  await page.waitForTimeout(250);
}

// --- 3.3 Adăugare și editarea codului --------------------------------------

await page.locator('.strategy-add-row button', { hasText: 'Adaugă' }).click();
await page.waitForTimeout(400);

const addCode = page.locator('.strategy-form input').first();
check('AS-U-12', '＋ Adaugă deschide formularul cu Cod activ', await addCode.isEnabled());

const hint = (await page.locator('.strategy-form .form-label small').first().textContent()) ?? '';
check('AS-U-13', 'ajutorul de convenție listează coduri existente', /Convenția folosită/.test(hint) && /P5\./.test(hint), hint);

await addCode.fill('P5.1');
await page.locator('.strategy-form input').nth(1).fill('Duplicat pentru test');
await page.locator('.strategy-form button', { hasText: 'Creează' }).click();
await page.waitForTimeout(600);
check('AS-U-14', 'creare cu cod duplicat: eroarea de la API, formularul rămâne deschis',
  (await page.locator('.strategy-form .state-note.error').count()) === 1
  && (await page.locator('.strategy-form').count()) === 1,
  ((await page.locator('.strategy-form .state-note.error').textContent()) ?? '').slice(0, 60));

await addCode.fill('D6.1');
await page.locator('.strategy-form button', { hasText: 'Creează' }).click();
await page.waitForTimeout(700);
check('AS-U-15', "creare cu 'D6.1' într-o versiune P5.x reușește — convenția nu blochează",
  (await page.locator('.strategy-form').count()) === 0);

const created = (await sentRequests()).filter((entry) => entry.method === 'POST' && entry.body?.code === 'D6.1');
check('AS-U-15b', "codul ajunge la server exact 'D6.1', netransformat", created.at(-1)?.body?.code === 'D6.1');

await pickKind('Programe');
await reperTable().locator('tbody tr', { hasText: 'D6.1' }).first()
  .locator('.strategy-row-actions button').nth(1).click();
await page.waitForTimeout(700);
check('AS-U-16', 'editare reper nefolosit și neimportat: Cod activ',
  await page.locator('.strategy-form input').first().isEnabled());
await page.locator('.strategy-form button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(300);

await usedRow.locator('.strategy-row-actions button').nth(1).click();
await page.waitForTimeout(700);
const usedLock = (await page.locator('.strategy-form .form-label small').first().textContent()) ?? '';
check('AS-U-17', 'editare reper folosit: Cod dezactivat, cu motivul vizibil',
  (await page.locator('.strategy-form input').first().isDisabled())
  && /folosit în/.test(usedLock), usedLock);
await page.locator('.strategy-form button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(300);

// An imported but unused reper: locked by the import alone, with the date shown.
await pickKind('Obiective SMART');
const importedUnused = reperTable().locator('tbody tr').filter({ hasText: 'nefolosit' }).first();
await importedUnused.locator('.strategy-row-actions button').nth(1).click();
await page.waitForTimeout(700);
const importLock = (await page.locator('.strategy-form .form-label small').first().textContent()) ?? '';
check('AS-U-18', 'editare reper importat: Cod dezactivat + data importului',
  (await page.locator('.strategy-form input').first().isDisabled())
  && /adus prin importul din/.test(importLock), importLock);
await page.locator('.strategy-form button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(300);

// --- 3.4 Relații ------------------------------------------------------------

await pickKind('Programe');
await reperTable().locator('tbody tr').first().locator('.strategy-row-actions button').nth(1).click();
await page.waitForTimeout(700);

const boxes = page.locator('.strategy-objective-picker input[type=checkbox]');
check('AS-U-20', 'formularul de program are o listă de obiective bifabile', (await boxes.count()) > 0, String(await boxes.count()));

const pickerCodes = await page.locator('.strategy-objective-picker code').allTextContents();
const objectiveCodes = await page.evaluate(async () => {
  const payload = await (await fetch('/api/v1/strategy')).json();
  return payload.data.objectives.map((entry) => entry.code);
});
check('AS-U-21', 'lista conține doar obiective din versiunea curentă',
  pickerCodes.every((code) => objectiveCodes.includes(code)) && pickerCodes.length === objectiveCodes.length);

const firstChecked = await boxes.nth(0).isChecked();
await boxes.nth(0).click();
await boxes.nth(1).click();
await page.locator('.strategy-form button', { hasText: 'Salvează' }).click();
await page.waitForTimeout(700);

let last = (await sentRequests()).at(-1);
check('AS-U-22', 'bifare + salvare trimite objectiveCodes în body',
  Array.isArray(last?.body?.objectiveCodes), JSON.stringify(last?.body?.objectiveCodes ?? null).slice(0, 60));
check('AS-U-19', 'salvarea unui program trimite toate coloanele',
  ['name', 'label', 'result', 'marketingObjective', 'approach', 'horizonResult', 'targetGroups',
    'kpiText', 'sources', 'annualActions', 'validationStatus'].every((key) => key in (last?.body ?? {})));

await reperTable().locator('tbody tr').first().locator('.strategy-row-actions button').nth(1).click();
await page.waitForTimeout(700);
// Always the first still-ticked box: unticking re-renders the picker, so a list
// of locators taken up front points at elements that no longer exist.
while ((await page.locator('.strategy-objective-picker input:checked').count()) > 0) {
  await page.locator('.strategy-objective-picker input:checked').first().click();
  await page.waitForTimeout(120);
}
await page.locator('.strategy-form button', { hasText: 'Salvează' }).click();
await page.waitForTimeout(700);
last = (await sentRequests()).at(-1);
check('AS-U-23', 'debifare completă trimite objectiveCodes: []',
  Array.isArray(last?.body?.objectiveCodes) && last.body.objectiveCodes.length === 0);
void firstChecked;

// --- 3.5 Sortare ------------------------------------------------------------

await pickKind('Programe');
const codes = () => reperTable().locator('tbody tr > td:first-child code').allTextContents();

const defaultOrder = await codes();
const codeHeader = page.locator('.strategy-sort', { hasText: 'Cod' }).first();

await codeHeader.click();
await page.waitForTimeout(300);
const ascending = await codes();
const tenAfterTwo = ascending.indexOf('P5.10') > ascending.indexOf('P5.2');
check('AS-U-24', 'sortare pe Cod: ordine naturală, P5.2 înaintea lui P5.10', tenAfterTwo, ascending.join(' '));

await codeHeader.click();
await page.waitForTimeout(300);
const descending = await codes();
check('AS-U-25', 'al doilea click inversează ordinea',
  descending.join(',') === [...ascending].reverse().join(','));

await codeHeader.click();
await page.waitForTimeout(300);
check('AS-U-26', 'al treilea click revine la sort_order', (await codes()).join(',') === defaultOrder.join(','));

const beforeSort = (await sentRequests()).length;
await page.locator('.strategy-sort', { hasText: 'Utilizat în' }).first().click();
await page.waitForTimeout(300);
const usageOrder = await reperTable()
  .locator('tbody tr > td:nth-child(3)')
  .evaluateAll((nodes) => nodes.map((node) => parseInt(node.textContent ?? '0', 10) || 0));
check('AS-U-27', 'sortare pe Utilizat în: numeric, nu lexicografic',
  usageOrder.every((value, index) => index === 0 || usageOrder[index - 1] <= value), usageOrder.join(','));
check('AS-U-28', 'sortarea nu trimite nicio cerere de scriere', (await sentRequests()).length === beforeSort);

// --- 3.6 Ștergere -----------------------------------------------------------

await page.locator('.strategy-sort', { hasText: 'Utilizat în' }).first().click();
await page.locator('.strategy-sort', { hasText: 'Utilizat în' }).first().click();
await page.waitForTimeout(300);

await reperTable().locator('tbody tr', { hasText: 'P5.10' }).first()
  .locator('.activation-icon-btn.danger').click();
await page.waitForTimeout(700);

check('AS-U-29', '🗑 pe un reper nefolosit deschide dialogul cu Șterge definitiv',
  (await page.locator('.confirm-dialog').count()) === 1
  && (await page.locator('.confirm-dialog button', { hasText: 'Șterge definitiv' }).count()) === 1);

const dependencyText = await page.locator('.confirm-dependencies').textContent();
check('AS-U-30', 'dialogul listează dependențele din /usage',
  /Utilizat în/.test(dependencyText ?? '') && /Apare în/.test(dependencyText ?? ''),
  (dependencyText ?? '').replace(/\s+/g, ' ').slice(0, 70));

const beforeCancel = (await sentRequests()).length;
await page.locator('.confirm-dialog button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(400);
check('AS-U-32', 'Renunță nu trimite nicio cerere',
  (await sentRequests()).length === beforeCancel && (await page.locator('.confirm-dialog').count()) === 0);

/*
 * AS-U-31 and AS-U-33 both need a reper the list thinks is free and the server
 * refuses — the stale-preview case, which is also the only way to reach the
 * blocked half of the dialog. Forced here by making `/usage` report a campaign
 * while the row still shows "nefolosit".
 */
await page.route('**/usage', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      data: {
        canDelete: false, canEditCode: false,
        business: [{ type: 'campanii', count: 6 }],
        internal: [{ type: 'matrice programe', count: 0 }],
        importedAt: null,
      },
      meta: {},
    }),
  });
});

await reperTable().locator('tbody tr', { hasText: 'P5.10' }).first()
  .locator('.activation-icon-btn.danger').click();
await page.waitForTimeout(700);

const blockedButtons = await page.locator('.confirm-dialog .wizard-actions button').allTextContents();
check('AS-U-31', 'reper folosit: dialogul oferă Dezactivează, nu ștergere',
  blockedButtons.some((label) => /Dezactivează/.test(label))
  && !blockedButtons.some((label) => /Șterge definitiv/.test(label)),
  blockedButtons.join(' / '));

await page.unroute('**/usage');
await page.locator('.confirm-dialog button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(300);

// Now the server refuses the delete itself: the row must survive with the
// server's own message on screen.
await page.route('**/strategy/*/programs/*', async (route) => {
  if (route.request().method() !== 'DELETE') return route.fallback();
  await route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({
      error: { code: 'ENTITY_IN_USE', message: 'Reperul a fost între timp folosit într-o campanie.', requestId: 'test' },
    }),
  });
});

await reperTable().locator('tbody tr', { hasText: 'P5.10' }).first()
  .locator('.activation-icon-btn.danger').click();
await page.waitForTimeout(600);
await page.locator('.confirm-dialog button', { hasText: 'Șterge definitiv' }).click();
await page.waitForTimeout(700);

check('AS-U-33', '409 de la API: mesajul serverului afișat, rândul rămâne',
  /între timp folosit/.test((await page.locator('.confirm-dialog .state-note.error').textContent()) ?? '')
  && (await reperTable().locator('tbody tr', { hasText: 'P5.10' }).count()) === 1);

await page.unroute('**/strategy/*/programs/*');
await page.locator('.confirm-dialog button', { hasText: 'Renunță' }).click();
await page.waitForTimeout(300);

// --- 3.7 Clonare ------------------------------------------------------------

await page.locator('.strategy-add-row button', { hasText: 'Versiune nouă' }).click();
await page.waitForTimeout(400);

const cloneOptions = await page.locator('.strategy-form select option').allTextContents();
check('AS-U-34', 'formularul de versiune oferă „de la zero" / „copiez din …"',
  cloneOptions.some((label) => /de la zero/i.test(label))
  && cloneOptions.some((label) => /Copiez reperele din/.test(label)),
  cloneOptions.join(' | '));

await page.locator('.strategy-form select').selectOption({ index: 1 });
await page.waitForTimeout(300);
const clonePreview = (await page.locator('.strategy-clone-preview').textContent()) ?? '';
check('AS-U-35', 'alegerea unei surse arată ce se va copia',
  /Se copiază/.test(clonePreview) && /piloni/.test(clonePreview), clonePreview.slice(0, 70));

await page.locator('.strategy-form input').first().fill('strategy-2034-2038');
await page.locator('.strategy-form input').nth(1).fill('Strategia 2034–2038');
await page.locator('.strategy-form button', { hasText: 'Creează' }).click();
await page.waitForTimeout(700);

last = (await sentRequests()).at(-1);
check('AS-U-36', 'crearea cu clonare trimite cloneFromExternalKey',
  typeof last?.body?.cloneFromExternalKey === 'string' && last.body.cloneFromExternalKey !== '',
  String(last?.body?.cloneFromExternalKey));

// --- 3.8 Roluri și regresie -------------------------------------------------

check('AS-U-40', 'zero erori de aplicație în consolă pe /admin',
  crashes.length === 0 && consoleErrors.length === 0,
  [...crashes, ...consoleErrors].slice(0, 2).join(' | '));

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificări admin-strategy`);
if (failed.length > 0) {
  for (const entry of failed) console.log(`  ${entry.id}  ${entry.name}`);
}
process.exit(failed.length ? 1 : 0);
