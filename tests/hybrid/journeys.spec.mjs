/**
 * H-01…H-07 — the seven journeys that need both halves at once.
 *
 * A case earns a place here only if it fails *only* when the frontend and the
 * backend are put together. Three shapes qualify: the contract between them (a
 * renamed field, a changed error code), an effect that travels (an action on one
 * screen changing records it never named), and a file one writes and the other
 * serves.
 *
 * Everything else belongs in `tests/backend` — faster, and it fails on the line
 * that broke rather than three screens away.
 *
 * Every journey cleans up after itself. The database is `omd_vj_test`, and the
 * runner refuses to start against anything whose name does not end in `_test`.
 */
import { chromium } from '../shared/deps.mjs';

import { APP_URL, launchOptions } from '../shared/config.mjs';

const BASE = APP_URL.replace(/\/strategic$/, '');
const API = process.env.OMD_API_URL ?? 'http://127.0.0.1:8099';
const PASSWORD = 'Test-Parola-2026!';

/*
 * Every record these journeys create is named with this prefix.
 *
 * `cleanup.php` deletes on it and on nothing else. An earlier version matched
 * words like „hibrid" and „cascadă", which is the kind of pattern that works
 * until someone names a real campaign that way — and then a test run quietly
 * deletes their work.
 */
const MARK = '[QA]';

const checks = [];
const check = (id, name, ok, detail = '') => {
  checks.push({ id, name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id.padEnd(9)} ${name}${detail ? ` — ${detail}` : ''}`);
};

/** A request straight to the API, outside the browser. */
const api = async (method, path, body, cookie) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    body: text ? JSON.parse(text) : null,
  };
};

const login = async (email) => {
  const response = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const raw = response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
};

/*
 * A detail response, turned back into something `PUT` accepts.
 *
 * The two shapes are almost the same, and „almost" is the problem: the fiche
 * calls the campaign type `typeCode`, the write contract calls it
 * `campaignTypeCode`. Sending the fiche back unchanged fails validation on that
 * one field, and the message names the field the caller never set.
 *
 * This is exactly the sort of asymmetry a hybrid test exists to catch, and the
 * editor screen has to do the same translation — so if this helper ever stops
 * matching, the editor has stopped matching too.
 */
const toWritePayload = (detail) => ({
  ...detail,
  campaignTypeCode: detail.campaignTypeCode ?? detail.typeCode,
});

const browser = await chromium.launch(launchOptions());

/** A fresh browser context: its own cookie jar, which is what a session is. */
const openAs = async (email, password = PASSWORD) => {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1200 } });
  const page = await context.newPage();

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

  const emailField = page.locator('input[type="email"], input[name="email"]').first();
  if (await emailField.count()) {
    await emailField.fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"], button', { hasText: /Intr|Autentific|Conectare/i })
      .first()
      .click();
    await page.waitForTimeout(1200);
  }

  return { context, page };
};

const adminCookie = await login('admin@test.local');

// =========================================== H-01: login și parola obligatorie

{
  /*
   * A temporary account, created and deleted here.
   *
   * `must_change_password` is the flag the router keys on, and there is no way to
   * set it through the API — an administrator sets it when issuing a password.
   * Seeding it directly is the only way to walk the path a new user walks.
   */
  const email = `qa-${Date.now().toString(36)}@test.local`;
  const seeded = await api('POST', '/api/v1/admin/users', {
    name: 'Cont temporar QA',
    email,
    role: 'EDITOR',
    password: PASSWORD,
    mustChangePassword: true,
  }, adminCookie);

  if (seeded.status === 201) {
    const { context, page } = await openAs(email);

    await page.waitForTimeout(800);
    const url = page.url();

    check('H-01a', 'un cont cu parolă temporară ajunge la schimbarea parolei',
      /change-password/.test(url), url);

    /*
     * And cannot leave. Typing another route in the address bar has to come back
     * here — otherwise the flag is decoration and the temporary password stays.
     */
    await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(600);
    check('H-01b', 'nu poate ocoli ecranul scriind altă rută',
      /change-password/.test(page.url()), page.url());

    /*
     * And the flag clears once the password is actually changed — otherwise the
     * user is stuck on the screen forever, which is the failure mode nobody
     * tests because it only appears after the happy path works.
     */
// Three fields: the current password, the new one, and the repeat. Asking for
    // the current one is what stops someone changing it at an unattended screen.
    const fields = await page.locator('input[type="password"]').all();
    if (fields.length === 3) {
      await fields[0].fill(PASSWORD);
      await fields[1].fill('Parola-Noua-2026!');
      await fields[2].fill('Parola-Noua-2026!');
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(1800);

      check('H-01c', 'după schimbarea parolei, utilizatorul iese din ecranul obligatoriu',
        !/change-password/.test(page.url()), page.url());
    } else {
      check('H-01c', 'ecranul cere parola veche și pe cea nouă de două ori', false,
        `${fields.length} câmpuri de parolă`);
    }

    await context.close();

    // No DELETE route for users, by design — an account that did anything has to
    // stay for the audit trail. `cleanup.php` removes the temporary ones the
    // suite made, and only those.
  } else {
    check('H-01a', 'contul temporar a putut fi creat', false, `POST /admin/users → ${seeded.status}`);
    check('H-01b', 'nu poate ocoli ecranul scriind altă rută', false, 'fără cont');
    check('H-01c', 'după schimbarea parolei, utilizatorul iese din ecran', false, 'fără cont');
  }
}

// ============================================ H-02: campanie creată din wizard

const created = [];

{
  const { context, page } = await openAs('admin@test.local');
  await page.goto(`${BASE}/campaigns`, { waitUntil: 'networkidle' });

  const campaigns = () => page.locator('.grid .card, .row');
  const before = await campaigns().count();

  /*
   * The wizard is walked through the API rather than clicked field by field.
   *
   * Clicking all five steps would test the wizard's own validation, which is
   * `F-W-*` on the mock and cheaper there. What only the two halves together can
   * show is that a campaign created through the API appears on the screen and
   * carries every column into the database — the mapping between the form's
   * names and the table's.
   */
  const title = `${MARK} Campanie hibridă ${Date.now().toString(36)}`;
  const catalogs = await api('GET', '/api/v1/catalogs', null, adminCookie);
  const strategy = await api('GET', '/api/v1/strategy', null, adminCookie);

/*
   * `/catalogs` keys its lists by table name — `campaign_types`, not
   * `campaignTypes` — while `/strategy` uses plural nouns. Reading them here
   * rather than hard-coding codes means a renamed catalogue value changes
   * nothing about this journey.
   */
  const firstCode = (list) => (Array.isArray(list) && list.length ? list[0].code : '');
  const data = catalogs.body?.data ?? {};
  const repere = strategy.body?.data ?? {};

  const payload = {
    title,
    campaignTypeCode: firstCode(data.campaign_types),
    pillarCode: firstCode(repere.pillars),
    seasonalityTypeCode: firstCode(data.seasonality_types),
    seasonalityMonths: [6, 7],
    statusCode: 'DRAFT',
    programPrimaryCode: firstCode(repere.programs),
    objectivePrimaryCode: firstCode(repere.objectives),
    primaryAudienceCode: firstCode(data.audience_segments),
    marketingObjective: 'Obiectiv hibrid.',
    directResult: 'Rezultat hibrid.',
    insight: 'Insight hibrid.',
    valueProposition: 'Propunere hibridă.',
    centralIdea: 'Idee hibridă.',
    promise: 'Promisiune hibridă.',
    mainMessage: 'Mesaj hibrid.',
    responsible: 'Echipa QA',
  };

  const response = await api('POST', '/api/v1/campaigns', payload, adminCookie);
  check('H-02a', 'campania se creează prin API', response.status === 201,
    `${response.status} ${JSON.stringify(response.body?.error ?? {}).slice(0, 160)}`);

  const key = response.body?.data?.id;
  if (key) created.push(['campaigns', key]);

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const after = await campaigns().count();
  check('H-02b', 'campania nouă apare în listă fără nicio altă intervenție',
    after === before + 1, `${before} → ${after}`);

  const shown = await page.locator('.content').first().textContent();
  check('H-02c', 'și cu titlul scris de utilizator', (shown ?? '').includes(title));

  /*
   * The fields the screen never shows are the ones worth checking.
   *
   * A wizard that drops `responsible` between the form and the `PUT` looks
   * perfectly correct on the list, which does not display it.
   */
  const detail = await api('GET', `/api/v1/campaigns/${key}`, null, adminCookie);
  check('H-02d', 'câmpurile care nu se văd în listă au ajuns totuși în bază',
    detail.body?.data?.responsible === 'Echipa QA' && detail.body?.data?.mainMessage === 'Mesaj hibrid.',
    JSON.stringify({
      responsible: detail.body?.data?.responsible,
      mainMessage: detail.body?.data?.mainMessage,
    }));

  await context.close();
}

// ============================================ H-03: cascada, văzută din ecrane

{
  const suffix = Date.now().toString(36);
  const campaign = await api('POST', '/api/v1/campaigns', {
    ...(await (async () => {
      const catalogs = await api('GET', '/api/v1/catalogs', null, adminCookie);
      const strategy = await api('GET', '/api/v1/strategy', null, adminCookie);
      const firstCode = (list) => (Array.isArray(list) && list.length ? list[0].code : '');
      const data = catalogs.body?.data ?? {};
      const repere = strategy.body?.data ?? {};
      return {
        campaignTypeCode: firstCode(data.campaign_types),
        pillarCode: firstCode(repere.pillars),
        seasonalityTypeCode: firstCode(data.seasonality_types),
        seasonalityMonths: [6],
        programPrimaryCode: firstCode(repere.programs),
        objectivePrimaryCode: firstCode(repere.objectives),
        primaryAudienceCode: firstCode(data.audience_segments),
        marketingObjective: 'x',
        directResult: 'x',
        insight: 'x',
        valueProposition: 'x',
        centralIdea: 'x',
        promise: 'x',
        mainMessage: 'x',
      };
    })()),
    title: `${MARK} Campanie cascadă ${suffix}`,
    statusCode: 'ACTIVE',
  }, adminCookie);

  const campaignKey = campaign.body?.data?.id;
  if (campaignKey) created.push(['campaigns', campaignKey]);

  const year = new Date().getFullYear();

  const running = await api('POST', '/api/v1/activations', {
    title: `${MARK} Activare în desfășurare ${suffix}`,
    campaignExternalKey: campaignKey,
    statusCode: 'ACTIVE',
    startDate: `${year}-01-01`,
    endDate: `${year + 1}-12-31`,
  }, adminCookie);

  const finished = await api('POST', '/api/v1/activations', {
    title: `${MARK} Activare încheiată ${suffix}`,
    campaignExternalKey: campaignKey,
    statusCode: 'ACTIVE',
    startDate: `${year - 2}-01-01`,
    endDate: `${year - 2}-02-01`,
  }, adminCookie);

  const runningKey = running.body?.data?.id;
  const finishedKey = finished.body?.data?.id;
  if (runningKey) created.push(['activations', runningKey]);
  if (finishedKey) created.push(['activations', finishedKey]);

  check('H-03a', 'cele două activări au fost create',
    running.status === 201 && finished.status === 201,
    `${running.status} / ${finished.status}`);

  // The campaign goes to Draft. Nothing names the activations.
  const detail = await api('GET', `/api/v1/campaigns/${campaignKey}`, null, adminCookie);
  const moved = await api(
    'PUT',
    `/api/v1/campaigns/${campaignKey}`,
    { ...toWritePayload(detail.body.data), statusCode: 'DRAFT' },
    adminCookie,
  );
  check('H-03b0', 'campania trece în Draft', moved.status === 200,
    `${moved.status} ${JSON.stringify(moved.body?.error ?? {}).slice(0, 140)}`);

  const runningAfter = await api('GET', `/api/v1/activations/${runningKey}`, null, adminCookie);
  const finishedAfter = await api('GET', `/api/v1/activations/${finishedKey}`, null, adminCookie);

  /*
   * Going down, everything that was Active comes down — the finished one too.
   * A campaign in Draft has nothing running under it, whatever the dates say.
   */
  check('H-03b', 'ambele activări Active au coborât în Draft',
    runningAfter.body?.data?.statusCode === 'DRAFT'
      && finishedAfter.body?.data?.statusCode === 'DRAFT',
    `${runningAfter.body?.data?.statusCode} / ${finishedAfter.body?.data?.statusCode}`);

  /*
   * Coming back up is where the asymmetry lives, and it is the whole reason the
   * cascade is not a simple mirror: reactivating the campaign restores the
   * activation that still has time left, and leaves the one whose period is over
   * where it is. Putting a finished activation back to „Activă" would claim work
   * is running that ended two years ago.
   */
  const back = await api('GET', `/api/v1/campaigns/${campaignKey}`, null, adminCookie);
  const raised = await api(
    'PUT',
    `/api/v1/campaigns/${campaignKey}`,
    { ...toWritePayload(back.body.data), statusCode: 'ACTIVE' },
    adminCookie,
  );
  check('H-03c0', 'campania revine Activă', raised.status === 200, String(raised.status));

  const runningBack = await api('GET', `/api/v1/activations/${runningKey}`, null, adminCookie);
  const finishedBack = await api('GET', `/api/v1/activations/${finishedKey}`, null, adminCookie);

  check('H-03c', 'la revenire urcă doar activarea neîncheiată',
    runningBack.body?.data?.statusCode === 'ACTIVE'
      && finishedBack.body?.data?.statusCode === 'DRAFT',
    `în desfășurare: ${runningBack.body?.data?.statusCode}, încheiată: ${finishedBack.body?.data?.statusCode}`);

  // And the screen shows what the database holds.
  const { context, page } = await openAs('admin@test.local');
  await page.goto(`${BASE}/activations`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const table = (await page.locator('.activation-list-table tbody').textContent()) ?? '';
  check('H-03d', 'ecranul de activări arată activarea afectată',
    table.includes(`Activare în desfășurare ${suffix}`),
    table.includes('Activare') ? 'activarea căutată nu e în tabel' : 'tabelul e gol');

  await context.close();
}

// ========================== H-04: un fișier scris de backend, servit browserului

{
  /*
   * The one journey that is not about data at all.
   *
   * Visuals are written to disk by the importer and served as static files —
   * by Apache in production, by the application itself here. Between those two
   * there is a filesystem path, a URL path, and directory permissions, and the
   * database knows about none of them. On 21.08 all three were involved: the
   * bytes were on disk, correct, and every request answered 404 because Apache
   * could not traverse the directory holding them.
   */
  const assets = await api('GET', '/api/v1/campaigns?pageSize=50', null, adminCookie);
  const campaigns = assets.body?.data ?? [];

  let servedUrl = '';
  for (const row of campaigns) {
    const detail = await api('GET', `/api/v1/campaigns/${row.id}`, null, adminCookie);
    const mockups = detail.body?.data?.mockups ?? [];
    for (const mockup of mockups) {
      // `src`, not `url`: a public URL built from the storage key, which is
      // never handed out as such.
      const file = (mockup.assets ?? [])[0];
      if (file?.src) { servedUrl = file.src; break; }
    }
    if (servedUrl) break;
  }

  if (!servedUrl) {
    check('H-04', 'un vizual în baza de test', false,
      'nicio machetă cu fișier — importă pachetul demo în omd_vj_test');
  } else {
    const absolute = servedUrl.startsWith('http') ? servedUrl : `${API}${servedUrl}`;
    const response = await fetch(absolute);
    const type = response.headers.get('content-type') ?? '';

    check('H-04a', 'vizualul se descarcă de la adresa pe care o dă API-ul',
      response.status === 200, `${response.status} ${absolute}`);
    check('H-04b', 'și vine cu un tip de imagine, nu ca JSON de eroare',
      /^image\//.test(type), type);

    const bytes = (await response.arrayBuffer()).byteLength;
    check('H-04c', 'fișierul are conținut', bytes > 100, `${bytes} octeți`);
  }
}

// ============================ H-05: identitatea codului, din interfață în bază

{
  const code = `TEST_H05_${Date.now().toString(36).toUpperCase()}`;
  const base = '/api/v1/admin/catalogs/activation_channels';

  const made = await api('POST', base, {
    code,
    label: `Canal H-05 ${code}`,
    sortOrder: 990,
  }, adminCookie);
  check('H-05a', 'o valoare nouă de nomenclator se creează', made.status === 201, String(made.status));

  // Not used yet: the code may still be corrected.
  const renamed = await api('PUT', `${base}/${code}`, {
    newCode: `${code}_V2`,
    label: `Canal H-05 redenumit`,
  }, adminCookie);
  check('H-05b', 'cât nimic nu depinde de ea, codul poate fi corectat',
    renamed.status === 200, String(renamed.status));

  const current = `${code}_V2`;

  /*
   * Now something uses it, and the rule flips: the label stays editable, the
   * code does not. That asymmetry is the whole point — the code is the join an
   * import matches on, the label is what a person reads.
   */
  const campaignKey = created.find(([table]) => table === 'campaigns')?.[1];
  const activation = campaignKey
    ? await api('POST', '/api/v1/activations', {
        title: `${MARK} Activare H-05 ${code}`,
        campaignExternalKey: campaignKey,
        materials: [{ title: 'Material H-05', channel: `Canal H-05 redenumit` }],
      }, adminCookie)
    : { status: 0 };

  if (activation.body?.data?.id) created.push(['activations', activation.body.data.id]);

  const relabel = await api('PUT', `${base}/${current}`, {
    label: 'Canal H-05, altă etichetă',
  }, adminCookie);
  check('H-05c', 'eticheta rămâne editabilă și după folosire',
    relabel.status === 200, String(relabel.status));

  const usage = await api('GET', `${base}/${current}/usage`, null, adminCookie);
  const used = (usage.body?.data?.businessRefs ?? usage.body?.data?.usageCount ?? 0) > 0;

  const recode = await api('PUT', `${base}/${current}`, {
    newCode: `${code}_V3`,
    label: 'Canal H-05, altă etichetă',
  }, adminCookie);

  check('H-05d', used
    ? 'după folosire, codul nu mai poate fi schimbat'
    : 'codul rămâne editabil cât nimic nu-l referă',
    used ? recode.status === 409 : recode.status === 200,
    `folosit=${used}, PUT → ${recode.status}`);

  // Whatever the outcome, the value goes away again.
  for (const candidate of [`${code}_V3`, current, code]) {
    await api('DELETE', `${base}/${candidate}`, null, adminCookie);
  }
}

// ================================== H-06: două sesiuni pe aceeași înregistrare

{
  const key = created.find(([table]) => table === 'campaigns')?.[1];

  if (!key) {
    check('H-06', 'o campanie de probă pentru concurență', false, 'niciuna creată mai devreme');
  } else {
    const first = await login('admin@test.local');
    const second = await login('editor@test.local');

    const loaded = await api('GET', `/api/v1/campaigns/${key}`, null, first);
    const version = loaded.body?.data?.versionNumber;

    // The first save wins and moves the version on.
    const writable = toWritePayload(loaded.body.data);

    const one = await fetch(`${API}/api/v1/campaigns/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: first, 'If-Match': `"${version}"` },
      body: JSON.stringify({ ...writable, title: `${writable.title} (prima)` }),
    });
    check('H-06a', 'prima salvare trece', one.status === 200, String(one.status));

    /*
     * The second session still holds the version it loaded. It has to be refused
     * — otherwise it silently overwrites work it never saw, which is the exact
     * failure optimistic concurrency exists to prevent.
     */
    const two = await fetch(`${API}/api/v1/campaigns/${key}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: second, 'If-Match': `"${version}"` },
      body: JSON.stringify({ ...writable, title: `${writable.title} (a doua)` }),
    });
    const refused = await two.json();

    check('H-06b', 'a doua salvare primește 409', two.status === 409, String(two.status));
    check('H-06c', 'și codul STALE_VERSION', refused?.error?.code === 'STALE_VERSION',
      JSON.stringify(refused?.error ?? {}).slice(0, 120));
  }
}

// ================================================ H-07: rolurile, cap-coadă

for (const [role, email] of [['EDITOR', 'editor@test.local'], ['VIEWER', 'viewer@test.local']]) {
  const { context, page } = await openAs(email);

  await page.goto(`${BASE}/admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  const text = (await page.locator('.content').first().textContent()) ?? '';

  /*
   * `/admin` exists for everyone; only the link is hidden. Someone who arrives
   * with a bookmark gets an explanation, not the screen and not a crash — before
   * this rule, they got the full page and six failed requests behind it.
   */
  check(`H-07-${role}a`, `${role} primește o explicație pe /admin, nu ecranul`,
    /administrator|nu ai|nu poți|drept/i.test(text), text.trim().slice(0, 90));

  const cookie = await login(email);
  const write = await api('POST', '/api/v1/admin/catalogs/activation_channels', {
    code: `TEST_${role}`,
    label: `Canal ${role}`,
  }, cookie);

  check(`H-07-${role}b`, `${role} este refuzat și de API, nu doar de interfață`,
    write.status === 403, String(write.status));

  await context.close();
}

// ====================================================== Curățenie și raport

for (const [table, key] of created.reverse()) {
  const path = table === 'campaigns' ? 'campaigns' : 'activations';
  await api('DELETE', `/api/v1/${path}/${key}`, null, adminCookie);
}

await browser.close();

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} verificări trecute`);

if (failed.length > 0) {
  console.log('\nEȘECURI:');
  for (const entry of failed) console.log(`  ${entry.id}  ${entry.name}`);
  process.exit(1);
}
