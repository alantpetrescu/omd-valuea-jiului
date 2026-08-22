/**
 * F-C, F-V, F-M, F-S, F-H — the screens outside Administrare.
 *
 * Hybrid, not frontend, and for a reason worth stating: these screens read
 * campaigns, activations, the annual plan and monitoring, and the mock API
 * serves none of that. Teaching it to would mean writing a second backend — one
 * that answers plausibly, is exercised by nothing else, and drifts from the real
 * one in silence.
 *
 * So they run against the real PHP server and `omd_vj_test`, read-only. Nothing
 * here writes, so it can run beside the journeys without disturbing them.
 *
 * IDs match FRONTEND.md, so a failure names a line in the specification rather
 * than only a line of code.
 */
import { chromium } from '../shared/deps.mjs';

import { APP_URL, launchOptions } from '../shared/config.mjs';

const BASE = APP_URL.replace(/\/strategic$/, '');

const checks = [];
const check = (id, name, ok, detail = '') => {
  checks.push({ id, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch(launchOptions());
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

/*
 * Crashes and console errors are counted apart.
 *
 * `pageerror` is an uncaught exception and always a defect. A console error can
 * also be Chrome's own "Failed to load resource" line, which it writes for every
 * non-2xx response whether or not the application handled it.
 */
const crashes = [];
const consoleErrors = [];
const failedRequests = [];

page.on('pageerror', (error) => crashes.push(error.message));
page.on('console', (message) => {
  if (message.type() !== 'error') return;
  const text = message.text();
  if (/Failed to load resource/.test(text)) return;
  consoleErrors.push(text);
});
page.on('requestfailed', (request) => failedRequests.push(request.url()));

const go = async (path) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
};

const drawers = () => page.locator('.drawer-bg').count();

const closeAll = async () => {
  for (let guard = 0; guard < 5 && (await drawers()) > 0; guard += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
};

// --- Sesiune ------------------------------------------------------------------

{
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  const email = page.locator('input[type="email"]').first();
  if (await email.count()) {
    await email.fill('admin@test.local');
    await page.locator('input[type="password"]').first().fill('Test-Parola-2026!');
    await page.locator('button[type="submit"]').first().click();
    await page.waitForTimeout(1500);
  }

  const loggedIn = (await page.locator('.content').count()) > 0;
  check('F-00', 'sesiune deschisă ca ADMIN', loggedIn, page.url());

  if (!loggedIn) {
    await browser.close();
    console.log('\nNu s-a putut deschide o sesiune — restul verificărilor ar fi fost fără sens.');
    process.exit(1);
  }
}

// =============================================================== F-C: campanii

await go('/campaigns');

/*
 * Cards by default, rows in list view — both are the prototype's names, and the
 * toolbar toggles between them. The count has to be taken from whichever is on
 * screen, or the suite passes on an empty page whenever the default changes.
 */
const rows = page.locator('.grid .card, .row');
const rowCount = await rows.count();
check('F-C-01', 'lista de campanii randează campanii', rowCount > 0, `${rowCount} campanii`);

const search = page.locator('.toolbar .search input').first();

if ((await search.count()) && rowCount > 0) {
  await search.fill('iarna');
  await page.waitForTimeout(500);
  const filtered = await rows.count();
  check('F-C-02', 'căutarea filtrează lista', filtered < rowCount, `${filtered} din ${rowCount}`);

  /*
   * Diacritics must not decide whether a campaign is found. Most people type
   * without them most of the time, and „iarna" has to reach „Iarna, în toată
   * Valea" exactly as „iarnă" does.
   */
  await search.fill('IARNĂ');
  await page.waitForTimeout(500);
  const withDiacritics = await rows.count();

  await search.fill('iarna');
  await page.waitForTimeout(500);
  const without = await rows.count();

  check('F-C-03', 'căutarea ignoră diacriticele și majusculele',
    withDiacritics === without && without > 0, `${withDiacritics} vs ${without}`);

  await search.fill('');
  await page.waitForTimeout(500);
} else {
  check('F-C-02', 'câmpul de căutare există', false, 'nu a fost găsit');
  check('F-C-03', 'căutarea ignoră diacriticele', false, 'fără câmp de căutare');
}

/*
 * List view, then a row: selecting one fills the preview pane, and opening it
 * raises the drawer. Neither leaves `/campaigns` — the URL names the screen, not
 * the record, which is what makes the back button behave.
 */
const listToggle = page.locator('.toolbar .toggle button').last();
if (await listToggle.count()) {
  await listToggle.click();
  await page.waitForTimeout(500);
}

const listRows = page.locator('.row');
const inListView = (await listRows.count()) > 0;

if (inListView) {
  await listRows.first().click();
  await page.waitForTimeout(500);
}

check('F-C-04a', 'un rând selectat umple panoul de previzualizare',
  inListView && (await page.locator('.preview-pane').count()) > 0,
  inListView ? '' : 'vederea listă nu s-a deschis');

const urlBefore = page.url();
await page.locator('.preview-actions button, .card-actions .btn.secondary').first().click();
await page.waitForTimeout(1000);

check('F-C-04b', 'campania se deschide într-un panou, fără să schimbe adresa',
  (await drawers()) === 1 && page.url() === urlBefore, page.url());

const sections = await page.locator('.drawer section, .drawer .block, .drawer .def').count();
check('F-C-05', 'panoul campaniei are secțiuni', sections > 0, `${sections} secțiuni`);

/*
 * Headings must not carry their own numbers. The wizard numbers its steps,
 * because the user is walking through them; the fiche does not, because they are
 * just headings — and a stray „5. " is what survives a copy-paste between them.
 */
const numbered = await page
  .locator('.drawer h2, .drawer h3, .drawer h4')
  .evaluateAll((nodes) => nodes.filter((node) => /^\s*\d+\.\s/.test(node.textContent ?? '')).length);
check('F-C-10', 'subtitlurile din panou nu poartă indici', numbered === 0, `${numbered} numerotate`);

const modeToggle = page.locator('.drawer .tabs button, .drawer .sub-toggle button');
check('F-C-06', 'panoul are comutatorul de mod de citire', (await modeToggle.count()) >= 2,
  `${await modeToggle.count()} butoane`);

await closeAll();

/*
 * The scroll lock has to be released. This is the defect from 20.08: the effect
 * holding it listed `openActivation` in its dependencies, so every re-run saved
 * the already-locked value as the one to restore, and the page stayed frozen
 * with nothing on screen to explain why.
 */
const overflow = await page.evaluate(() => document.body.style.overflow);
check('F-C-09', 'după închiderea panourilor, pagina redevine derulabilă',
  overflow !== 'hidden', `body.style.overflow = "${overflow}"`);

// ========================================================= F-W: wizard campanie

await go('/campaigns/new');

// `.steps .step` here — `.wizard-step` is the Administrare tab strip, a
// different control with a confusingly similar name.
const steps = page.locator('.steps .step');
check('F-W-01a', 'wizardul afișează pașii', (await steps.count()) >= 5,
  `${await steps.count()} pași`);
check('F-W-01b', 'și indicatorul de progres',
  (await page.locator('.modal-foot .progress .track').count()) > 0);

/*
 * „Continuă" does not advance on an empty step, and it says which field is
 * missing. A wizard that lets you walk past step one and then refuses the save
 * five screens later makes you find the problem yourself.
 */
const forward = page.locator('.modal-foot button', { hasText: /Continuă/ }).first();

if (await forward.count()) {
  const stepBefore = (await page.locator('.modal-foot .progress').first().textContent()) ?? '';
  await forward.click();
  await page.waitForTimeout(500);

  const complaint = (await page.locator('.state-note.error').first().textContent().catch(() => '')) ?? '';
  const stepAfter = (await page.locator('.modal-foot .progress').first().textContent()) ?? '';

  check('F-W-02', 'wizardul nu trece mai departe cu câmpuri obligatorii goale',
    stepBefore === stepAfter, `${stepBefore.trim()} → ${stepAfter.trim()}`);
  check('F-W-03', 'și spune ce lipsește, nu doar „date invalide"',
    complaint.trim().length > 10 && !/date invalide/i.test(complaint), complaint.trim().slice(0, 80));
} else {
  check('F-W-02', 'wizardul are butonul „Continuă"', false, 'nu a fost găsit');
  check('F-W-03', 'și spune ce lipsește', false, 'fără buton');
}

/*
 * On `/edit` the form arrives full. An editor that opens blank is worse than one
 * that refuses to open: it looks ready, and saving it wipes the record.
 */
{
  const key = await page.evaluate(async () => {
    const response = await fetch('/api/v1/campaigns?pageSize=1');
    const payload = await response.json();
    return payload?.data?.[0]?.id ?? '';
  });

  if (key) {
    await go(`/campaigns/${key}/edit`);
    const title = await page.locator('input').first().inputValue().catch(() => '');
    check('F-W-05', 'pe /edit formularul vine cu datele existente', title.trim().length > 0,
      title.trim().slice(0, 60) || 'primul câmp e gol');
  } else {
    check('F-W-05', 'o campanie de editat', false, 'lista a venit goală');
  }
}

// ========================================================== F-E: editor activare

{
  const key = await page.evaluate(async () => {
    const response = await fetch('/api/v1/activations?pageSize=1');
    const payload = await response.json();
    return payload?.data?.[0]?.id ?? '';
  });

  if (key) {
    await go(`/activations/${key}/edit`);

    const title = await page.locator('input').first().inputValue().catch(() => '');
    check('F-E-01a', 'editorul de activare randează cu datele existente',
      title.trim().length > 0, title.trim().slice(0, 60) || 'primul câmp e gol');

    const save = page.locator('button', { hasText: /Salvează modificările/ });
    check('F-E-01b', 'și oferă salvarea ca modificare, nu ca activare nouă',
      (await save.count()) > 0);

    const sections = await page.locator('.activation-nav button, .activation-nav a').count();
    check('F-E-02', 'editorul are secțiunile lui, inclusiv materiale și KPI',
      sections >= 4, `${sections} secțiuni`);
  } else {
    check('F-E-01a', 'o activare de editat', false, 'lista a venit goală');
    check('F-E-01b', 'și oferă salvarea ca modificare', false, 'fără activare');
    check('F-E-02', 'editorul are secțiunile lui', false, 'fără activare');
  }
}

// =============================================================== F-V: activări

await go('/activations');

// `.activation-stats` here, `.stats` on the campaigns screen — the two pages
// keep the prototype's own names rather than a shared one.
const activationStats = await page.locator('.activation-stats > *').count();
check('F-V-01a', 'pagina de activări are carduri de statistici',
  activationStats >= 6, `${activationStats} carduri`);

const activationRows = page.locator('.activation-list-table tbody tr');
const activationCount = await activationRows.count();
check('F-V-01b', 'tabela de activări randează rânduri', activationCount > 0,
  `${activationCount} rânduri`);

check('F-V-02', 'acțiunile de pe rând sunt iconițe',
  (await page.locator('.activation-icon-btn').count()) > 0,
  `${await page.locator('.activation-icon-btn').count()} butoane`);

/*
 * The refresh button reloads in place. It used to navigate, which threw away the
 * user's filters and scroll position to fetch numbers belonging to the row they
 * were already looking at.
 */
const refresh = page.locator('[data-tooltip="Actualizează rezultate sociale"]').first();
const hasRefresh = (await refresh.count()) > 0;
check('F-V-04', 'butonul de reîmprospătare are tooltipul cerut', hasRefresh,
  hasRefresh ? '' : 'niciun buton cu acest data-tooltip');

if (hasRefresh && activationCount > 0) {
  const before = page.url();
  await refresh.click();
  await page.waitForTimeout(900);

  check('F-V-03', 'reîmprospătarea nu navighează', page.url() === before, page.url());

  // And it does not empty the table while it works: a row-level refresh that
  // blanks the list takes its own progress indicator down with it.
  check('F-V-05', 'tabela rămâne pe ecran cât se reîncarcă',
    (await activationRows.count()) === activationCount,
    `${await activationRows.count()} vs ${activationCount}`);
} else {
  check('F-V-03', 'reîmprospătarea nu navighează', false, 'fără buton sau fără rânduri');
  check('F-V-05', 'tabela rămâne pe ecran cât se reîncarcă', false, 'fără buton sau fără rânduri');
}

if (activationCount > 0) {
  await activationRows.first().locator('.activation-icon-btn').first().click();
  await page.waitForTimeout(900);

  check('F-V-06', 'o activare se deschide într-un panou', (await drawers()) > 0);
  check('F-V-07', 'panoul activării are subtaburi',
    (await page.locator('.drawer .tabs button').count()) > 0,
    `${await page.locator('.drawer .tabs button').count()} subtaburi`);

  await closeAll();
} else {
  check('F-V-06', 'o activare se deschide într-un panou', false, 'niciun rând');
  check('F-V-07', 'panoul activării are subtaburi', false, 'niciun rând');
}

// ========================================================== F-M: monitorizare

await go('/monitoring-activations');

const materials = page.locator('.monitoring-material-link');
const materialCount = await materials.count();

if (materialCount > 0) {
  await materials.first().click();
  await page.waitForTimeout(1200);

  check('F-M-01a', 'clic pe un material deschide panoul activării', (await drawers()) > 0);

  const active = (await page.locator('.drawer .tabs button.active, .drawer .tabs button[aria-selected="true"]')
    .first().textContent().catch(() => '')) ?? '';
  check('F-M-01b', 'panoul se deschide pe subtabul de materiale',
    /material/i.test(active), active.trim() || 'niciun subtab activ');

  const focused = await page.locator('.material-focus').count();
  check('F-M-02', 'materialul cerut primește clasa material-focus', focused === 1,
    `${focused} elemente`);

  if (focused === 1) {
    check('F-M-03', 'materialul focalizat este vizibil',
      await page.locator('.material-focus').first().isVisible());
  } else {
    check('F-M-03', 'materialul focalizat este vizibil', false, 'niciun material focalizat');
  }

  await closeAll();
} else {
  /*
   * Not a skip that passes. The database has no measurements, so this flow
   * cannot be exercised at all — and saying so is more useful than a green line
   * that means „there was nothing to check".
   */
  check('F-M-01a', 'materiale monitorizate în baza de test', false,
    'importă OMD_ACTIVATION_MONITORING_PACKAGE în omd_vj_test');
  check('F-M-01b', 'panoul se deschide pe subtabul de materiale', false, 'fără materiale');
  check('F-M-02', 'materialul cerut primește clasa material-focus', false, 'fără materiale');
  check('F-M-03', 'materialul focalizat este vizibil', false, 'fără materiale');
}

// ======================================================= F-S: restul ecranelor

for (const [id, path, name] of [
  ['F-S-01', '/annual', 'Plan anual'],
  ['F-S-03', '/monitoring-reputation', 'Monitorizare reputație'],
  ['F-S-04', '/strategic', 'Repere strategice'],
  ['F-S-05', '/about', 'Despre aplicație'],
]) {
  await go(path);
  const painted = await page.locator('.content').first().evaluate((node) => node.textContent.trim().length);
  check(id, `${name} randează conținut`, painted > 200, `${painted} caractere`);
}

// --- Tabul Date & import/export ---------------------------------------------

await go('/about');
const dataTab = page.locator('.about-tabs button').filter({ hasText: /Date .*import/i }).first();

if (await dataTab.count()) {
  await dataTab.click();
  await page.waitForTimeout(600);

  check('F-S-06a', 'tabul „Date & import/export" are banda de stare',
    (await page.locator('.data-portability-status').count()) > 0);

  const cards = await page.locator('.data-portability-status').count();
  check('F-S-06b', 'și cardurile de pachete', cards >= 4, `${cards} elemente de stare`);

  /*
   * The page must not scroll sideways on a narrow window. One unbroken filename
   * once widened the whole tab by 29 pixels, and the horizontal bar only showed
   * on small screens, where nobody was looking.
   */
  await page.setViewportSize({ width: 880, height: 1200 });
  await page.waitForTimeout(500);
  const spill = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('F-S-07', 'la 880px pagina nu derulează orizontal', spill <= 0, `${spill}px în plus`);
  await page.setViewportSize({ width: 1600, height: 1200 });
} else {
  check('F-S-06a', 'tabul „Date & import/export" există', false, 'nu a fost găsit');
  check('F-S-06b', 'și cardurile de pachete', false, 'fără tab');
  check('F-S-07', 'la 880px pagina nu derulează orizontal', false, 'fără tab');
}

// ================================================================ F-H: sănătate

check('F-H-01a', 'nicio excepție neprinsă pe niciun ecran', crashes.length === 0,
  crashes.slice(0, 3).join(' | '));
check('F-H-01b', 'nicio eroare de aplicație în consolă', consoleErrors.length === 0,
  consoleErrors.slice(0, 3).join(' | '));

/*
 * Fonts are why F-H-03 exists. They were missing for weeks without anyone
 * noticing: the fallbacks look close enough not to catch the eye, and the only
 * sign was a line in a console nobody read.
 */
const fontFailures = failedRequests.filter((url) => /\.(woff2?|ttf|otf)(\?|$)/i.test(url));
check('F-H-03', 'fonturile se încarcă', fontFailures.length === 0, fontFailures.slice(0, 2).join(' | '));

const otherFailures = failedRequests.filter((url) => !/\.(woff2?|ttf|otf)(\?|$)/i.test(url));
check('F-H-02', 'nicio cerere eșuată neintenționat', otherFailures.length === 0,
  otherFailures.slice(0, 3).join(' | '));

// --- Raport ------------------------------------------------------------------

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificări trecute`);

if (failed.length > 0) {
  console.log('\nEȘECURI:');
  for (const entry of failed) console.log(`  ${entry.id}  ${entry.name}`);
  process.exit(1);
}
