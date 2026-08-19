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
    return json(res, 200, {
      data: [{
        id: v.id, label: v.label, status: v.status,
        periodStartYear: v.periodStartYear, periodEndYear: v.periodEndYear, notes: null,
        campaignCount: (strategy.campaigns ?? []).length,
        pillarCount: (strategy.pillars ?? []).length,
        programCount: (strategy.programs ?? []).length,
        objectiveCount: (strategy.objectives ?? []).length,
      }],
      meta: {},
    });
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
      puts.push({ path, body: payload });
      const [, , , , , kind, code] = path.split('/');
      const bucket = kind === 'programs' ? strategy.programs : strategy.objectives;
      const target = bucket.find((entry) => entry.code === decodeURIComponent(code));
      if (target) Object.assign(target, payload);
      return json(res, 200, { data: { ok: true }, meta: {} });
    });
    return undefined;
  }

  return json(res, 404, { error: { code: 'NOT_FOUND', message: `no mock for ${path}`, requestId: 'mock' } });
}).listen(MOCK_PORT, '127.0.0.1', () => console.log(`mock api on ${MOCK_PORT} as ${role}`));
