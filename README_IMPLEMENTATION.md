# OMD Valea Jiului — implementation notes

Live implementation of the handoff package in `D:\Florian\programmer_full_package_FINAL`.
That package is the authority; this repository is the implementation.

Authority order when documents disagree (README_PROGRAMMER §2):

1. `06_IMPLEMENTATION_SPEC/FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md`
2. `02_DATABASE/OMD_MYSQL_DATABASE_SPEC_v1.md`
3. `02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql`
4. the four JSON schemas in `03_JSON_CONTRACTS/` (copied to `contracts/`)
5. the v13.3 prototype in `01_REFERENCE_FRONTEND/`
6. the reports in `05_ARCHITECTURE_CONTEXT/`

## Stack

Required by FULLSTACK spec §3.3 before coding starts:

```text
Backend runtime:            Node.js 24 (engines: >=20)
Backend framework:          Express 4 + TypeScript 5 (CommonJS build)
DB driver / ORM:            mysql2 — raw prepared statements, no ORM
JSON Schema validator:      ajv (Draft 2020-12) — added in Stage 2
Password hashing:           Argon2id — added in Stage 1 step 6
Test framework:             to be selected (Stage 1 close-out)
Browser E2E framework:      to be selected (Stage 5)
Process manager:            to be selected at deployment
```

MySQL target: **Oracle MySQL Community Server 26.7.0** (blueprint targets 8.x; 26.7
verified to load all 40 tables and 1 view).

## Layout

```text
backend/      Express API
contracts/    the four frozen JSON Schemas, byte-identical to the handoff package
database/     migrations (Stage 1 step 3)
storage/      uploads and import staging — runtime data, not source
docs/         OpenAPI and generated documentation
```

## Environments

| Database            | Purpose                                              |
|---------------------|------------------------------------------------------|
| `omd_vj_staging`    | development and UAT; target of every acceptance value |
| `omd_vj_test`       | DB integration tests; truncated freely                |
| `omd_vj_production` | created at deploy time; never seeded with DEMO_SEED   |

Same migrations everywhere, different `.env`, separate credentials and storage
(spec §5.3).

## Setup

```bash
cd backend
npm install
cp .env.example .env     # then fill DB_PASSWORD, APP_SECRET, AUTH_SECRET
npm run dev
```

Health check: `GET http://localhost:3000/api/v1/health` → `{"status":"ok"}`.

## Progress

- [x] Stage 1 step 1 — project skeleton, env validation, health endpoint
- [x] Stage 1 step 2 — database layer (pool, typed queries, transactions)
- [x] Stage 1 step 3 — migrations from the SQL blueprint (40 tables + 1 view verified)
- [x] Stage 1 step 4 — technical seed (roles, admin, SystemMasterRegistry)
- [x] Stage 1 step 5 — API envelopes, error handling, logging
- [x] Stage 1 step 6 — auth, permissions, audit
- [x] Stage 2 (partial) — import service for all four package types, CLI entry point
- [x] Stage 2 (partial) — Campaign read API, Login page, Campanii page
- [x] Stage 2 (partial) — Campaign detail page (all 8 sections, template visuals)
- [x] Stage 2 (partial) — campaign write API (create/update, ETag concurrency, audit)
- [x] Stage 2 (partial) — campaign create/edit wizard, 8 steps
- [ ] Stage 2 — template visual upload from the wizard (see below)
- [x] Stage 2 (partial) — Activări list + detail + calendar
- [x] Stage 2 (partial) — activation write API and editor (create/edit)
- [x] Stage 3 — Plan anual (read + manual selection)
- [x] Stage 4 — Monitorizare activări and Monitorizare reputație
- [x] Stage 5 — Repere strategice (read + ADMIN edit, version activation)
- [x] Stage 5 — Administrare: users, catalogs with deletion policy, imports, audit
- [x] Stage 5 — soft delete with dependency checks, change password, About
- [ ] Stage 2 — preview/commit import endpoints (ADMIN only)

## Deployment on a tailnet

```bash
cp .env.docker.example .env.docker      # fill in TS_AUTHKEY, DB_*, secrets
docker compose --env-file .env.docker up -d --build
docker compose run --rm api node dist/database/migrate.js
docker compose run --rm api node dist/database/seed-technical.js
```

Three containers: `tailscale` (joins the tailnet, terminates HTTPS via Tailscale
Serve), `web` (nginx: SPA + `/api` proxy + `/uploads`), `api` (Express).
`web` and `api` share the tailscale network namespace, so they address each
other over `127.0.0.1` and only tailscale publishes ports.

The app is then reachable at its MagicDNS name over HTTPS, from the tailnet only
— Serve, not Funnel. Switching to Funnel would publish it to the internet.

**The database is not part of this stack.** It must be reachable from the
tailscale namespace: a host address, another tailnet node, or a managed server.
A plain compose service addressed by name will not resolve.

Generate the two secrets with `openssl rand -hex 32`. Changing `AUTH_SECRET`
invalidates every existing session.

## Test accounts

| Email | Password | Role |
|---|---|---|
| `admin@omd.ro` | `OMD-ValeaJiului-2026` | ADMIN |
| `editor@omd.ro` | `Editor-Test-2026` | EDITOR |
| `viewer@omd.ro` | `Viewer-Test-2026` | VIEWER |

The two non-admin accounts exist to exercise the permission matrix; remove them
before production. Verified: VIEWER gets 403 on write, 200 on read.

## Running it

```bash
# terminal 1
cd backend && npm run dev      # API on http://localhost:3000

# terminal 2
cd frontend && npm run dev     # UI  on http://localhost:5173
```

The Vite dev server proxies `/api` and `/uploads` to the backend, so the browser
sees a single origin — the same arrangement production uses behind a reverse
proxy, and the reason the session cookie works without CORS.

## Staging seed

All four DEMO_SEED packages import clean into an empty database, in this order:

```bash
npm run import -- "<pkg>/04_DEMO_SEEDS/OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json"
npm run import -- "<pkg>/04_DEMO_SEEDS/OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json"
npm run import -- "<pkg>/04_DEMO_SEEDS/OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json"
npm run import -- "<pkg>/04_DEMO_SEEDS/OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json"
```

39 of 40 tables populated; `audit_log` stays empty until auth exists. All golden
acceptance values verified, including Plan 2026 (6 campaigns, 10 activations,
177.500 planned, 123.400 spent, 69,5%).

## Database commands

```bash
npm run migrate           # apply pending migrations
npm run migrate:status    # list applied/pending, change nothing
npm run seed:technical    # roles + initial admin + protected-code backfill
```

Both are idempotent. `seed:technical` never resets an existing admin password.
