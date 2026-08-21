/**
 * Stand-in for the Express API, serving the DEMO_SEED fixture.
 *
 * Only the endpoints the Repere strategice screen touches are implemented;
 * anything else 404s so an unexpected call is loud rather than silent.
 *
 * ROLE=ADMIN|EDITOR|VIEWER decides who `GET /auth/me` reports, which is how the
 * suite separates "must look exactly like the prototype" (VIEWER, EDITOR) from
 * "may show the inline editor" (ADMIN).
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';

import { FIXTURE, MOCK_PORT } from './config.mjs';

const strategy = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const role = process.env.ROLE || 'VIEWER';

/**
 * LEGACY=1 answers the way the API did before it grew `campaigns` and
 * `audiences` — which is what a stale compiled backend serves. The screen must
 * explain that rather than crash or draw zero coverage.
 */
if (process.env.LEGACY === '1') {
  delete strategy.campaigns;
  delete strategy.audiences;
  delete strategy.version.periodStartYear;
  delete strategy.version.periodEndYear;
}

const users = {
  ADMIN: { id: 'u-admin', name: 'Admin OMD', email: 'admin@omd.ro', role: 'ADMIN', mustChangePassword: false },
  EDITOR: { id: 'u-editor', name: 'Editor OMD', email: 'editor@omd.ro', role: 'EDITOR', mustChangePassword: false },
  VIEWER: { id: 'u-viewer', name: 'Viewer OMD', email: 'viewer@omd.ro', role: 'VIEWER', mustChangePassword: false },
};

/**
 * ADMIN_STRATEGY=1 adds a second strategy version and a `P5.10` programme.
 *
 * Both exist for cases the demo seed cannot produce: cloning needs a source
 * version to choose, and natural ordering only differs from lexicographic once a
 * two-digit segment appears — `P5.1`…`P5.8` sort the same either way, so a suite
 * built on them would pass with the sorting broken.
 */
const extended = process.env.ADMIN_STRATEGY === '1';

if (extended) {
  strategy.programs = [
    ...(strategy.programs ?? []),
    {
      code: 'P5.10',
      name: 'Program adăugat pentru testul de sortare',
      label: 'P5.10',
      result: '', marketingObjective: '', approach: '', horizonResult: '',
      targetGroups: '', kpiText: '', sources: '', annualActions: '',
      validationStatus: 'în lucru',
      isActive: 1, sortOrder: 99, usageCount: 0,
    },
  ];
}

/**
 * A second version, so the clone selector has something to offer.
 *
 * Only ever read: nothing in the suite asks for its repere.
 */
const secondVersion = {
  id: 'strategy-2029-2033', label: 'Strategia 2029–2033', status: 'DRAFT',
  periodStartYear: 2029, periodEndYear: 2033, notes: null,
  campaignCount: 0, pillarCount: 0, programCount: 0, objectiveCount: 0,
};

/**
 * Which repere an import wrote, mocked.
 *
 * The real answer comes from `import_batch_items`; here it is simply "everything
 * the seed brought in except the ones this suite creates", which is exactly the
 * shape of a freshly imported database and the state the code-lock rule exists
 * for.
 */
const imported = new Set(
  [...(strategy.pillars ?? []), ...(strategy.programs ?? []), ...(strategy.objectives ?? [])]
    .filter((entry) => entry.code !== 'P5.10')
    .map((entry) => entry.code),
);

const bucketFor = (kind) =>
  kind === 'programs' ? strategy.programs : kind === 'objectives' ? strategy.objectives : strategy.pillars;

/** Recorded ADMIN writes, so the functional test can assert what was sent. */
const puts = [];

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const path = req.url.split('?')[0];

  if (path === '/api/v1/__puts') return json(res, 200, { data: puts, meta: {} });
  if (path === '/api/v1/auth/me') return json(res, 200, { data: users[role], meta: {} });
  if (path === '/api/v1/strategy' && req.method === 'GET') return json(res, 200, { data: strategy, meta: {} });

  // Enough of the Admin surface for the page to mount without noise.
  if (path === '/api/v1/admin/users') return json(res, 200, { data: [], meta: {} });

  if (path === '/api/v1/strategy/versions' && req.method === 'GET') {
    const v = strategy.version;
    const primary = {
      id: v.id, label: v.label, status: v.status,
      periodStartYear: v.periodStartYear, periodEndYear: v.periodEndYear, notes: null,
      campaignCount: (strategy.campaigns ?? []).length,
      pillarCount: (strategy.pillars ?? []).length,
      programCount: (strategy.programs ?? []).length,
      objectiveCount: (strategy.objectives ?? []).length,
    };
    return json(res, 200, { data: extended ? [primary, secondVersion] : [primary], meta: {} });
  }

  /*
   * `GET .../usage` — what points at one reper, and therefore what may be done
   * to it. The two flags are the whole reason the endpoint exists:
   * `canDelete` gates the trash, `canEditCode` gates the code field.
   */
  if (req.method === 'GET' && /\/usage$/.test(path)) {
    const parts = path.split('/');
    const kind = parts[5];
    const code = decodeURIComponent(parts[6]);
    const target = (bucketFor(kind) ?? []).find((entry) => entry.code === code);
    const used = (target?.usageCount ?? 0) > 0;
    const wasImported = imported.has(code);

    return json(res, 200, {
      data: {
        canDelete: !used,
        canEditCode: !used && !wasImported,
        business: used ? [{ type: 'campanii', count: target.usageCount }] : [],
        internal: kind === 'pillars' ? [] : [{ type: 'matrice programe', count: 1 }],
        importedAt: wasImported ? '2026-08-14 09:12:00' : null,
      },
      meta: {},
    });
  }

  if (req.method === 'POST' && /^\/api\/v1\/strategy\/[^/]+\/(pillars|programs|objectives)$/.test(path)) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (role !== 'ADMIN') {
        return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
      }
      const payload = JSON.parse(body || '{}');
      const kind = path.split('/').pop();
      const bucket = bucketFor(kind) ?? [];

      if (bucket.some((entry) => entry.code === payload.code)) {
        puts.push({ path, method: 'POST', body: payload, rejected: 'CONFLICT' });
        return json(res, 409, {
          error: { code: 'CONFLICT', message: `Codul ${payload.code} există deja în această versiune strategică.`, requestId: 'mock' },
        });
      }

      puts.push({ path, method: 'POST', body: payload });
      bucket.push({ ...payload, isActive: 1, usageCount: 0, sortOrder: bucket.length });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ data: { code: payload.code }, meta: {} }));
    });
    return undefined;
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/strategy\/[^/]+\/(pillars|programs|objectives)\//.test(path)) {
    if (role !== 'ADMIN') {
      return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
    }
    const parts = path.split('/');
    const kind = parts[5];
    const code = decodeURIComponent(parts[6]);
    const bucket = bucketFor(kind) ?? [];
    const target = bucket.find((entry) => entry.code === code);

    if ((target?.usageCount ?? 0) > 0) {
      puts.push({ path, method: 'DELETE', rejected: 'ENTITY_IN_USE' });
      return json(res, 409, {
        error: {
          code: 'ENTITY_IN_USE',
          message: 'Reperul este utilizat și nu poate fi șters. Îl poți dezactiva.',
          details: { allowedAction: 'DEACTIVATE' },
          requestId: 'mock',
        },
      });
    }

    puts.push({ path, method: 'DELETE' });
    const index = bucket.indexOf(target);
    if (index >= 0) bucket.splice(index, 1);
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'POST' && path === '/api/v1/strategy/versions') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      if (role !== 'ADMIN') {
        return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
      }
      const payload = JSON.parse(body || '{}');
      puts.push({ path, method: 'POST', body: payload });
      res.statusCode = 201;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.end(JSON.stringify({ data: { id: payload.externalKey, status: 'DRAFT' }, meta: {} }));
    });
    return undefined;
  }

  if (req.method === 'POST' && /\/versions\/[^/]+\/(archive|activate)$/.test(path)) {
    if (role !== 'ADMIN') {
      return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
    }
    puts.push({ path, method: 'POST' });
    return json(res, 200, { data: { id: path.split('/')[5], status: path.endsWith('archive') ? 'ARCHIVED' : 'ACTIVE' }, meta: {} });
  }

  if (req.method === 'DELETE' && /^\/api\/v1\/strategy\/versions\/[^/]+$/.test(path)) {
    if (role !== 'ADMIN') {
      return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
    }
    puts.push({ path, method: 'DELETE' });
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'POST' && /\/toggle-active$/.test(path)) {
    if (role !== 'ADMIN') {
      return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
    }
    const parts = path.split('/');
    const kind = parts[5];
    const code = decodeURIComponent(parts[6]);
    const bucket = kind === 'programs' ? strategy.programs : kind === 'objectives' ? strategy.objectives : strategy.pillars;
    const target = (bucket ?? []).find((entry) => entry.code === code);
    if (target) target.isActive = target.isActive ? 0 : 1;
    puts.push({ path, body: { isActive: target?.isActive } });
    return json(res, 200, { data: { code, isActive: target?.isActive === 1 }, meta: {} });
  }

  if (req.method === 'PUT' && path.startsWith('/api/v1/strategy/')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      // The real API refuses non-ADMIN writes server-side (spec 12); so does this.
      if (role !== 'ADMIN') {
        return json(res, 403, { error: { code: 'FORBIDDEN', message: 'Nu ai dreptul.', requestId: 'mock' } });
      }
      const payload = JSON.parse(body || '{}');
      puts.push({ path, method: 'PUT', body: payload });

      // Version metadata, not a reper: five path segments, not six.
      if (/^\/api\/v1\/strategy\/versions\/[^/]+$/.test(path)) {
        return json(res, 200, { data: { id: path.split('/')[5], ...payload }, meta: {} });
      }

      const [, , , , , kind, code] = path.split('/');
      const bucket = bucketFor(kind) ?? [];
      const target = bucket.find((entry) => entry.code === decodeURIComponent(code));
      if (target) {
        Object.assign(target, payload);
        if (typeof payload.newCode === 'string' && payload.newCode !== '') target.code = payload.newCode;
      }
      return json(res, 200, { data: { ok: true }, meta: {} });
    });
    return undefined;
  }

  return json(res, 404, { error: { code: 'NOT_FOUND', message: `no mock for ${path}`, requestId: 'mock' } });
}).listen(MOCK_PORT, '127.0.0.1', () => console.log(`mock api on ${MOCK_PORT} as ${role}`));
