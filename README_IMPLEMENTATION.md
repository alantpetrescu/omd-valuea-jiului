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
- [ ] Stage 1 step 5 — API envelopes, error handling, logging
- [ ] Stage 1 step 6 — auth, permissions, audit
- [x] Stage 2 (partial) — import service for all four package types, CLI entry point
- [ ] Stage 2 — preview endpoint, HTTP import endpoints (ADMIN only), Campaign/Activation read API

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
