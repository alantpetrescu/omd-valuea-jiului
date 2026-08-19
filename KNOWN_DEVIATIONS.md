# Known deviations from the handoff package

Spec §68.9 requires this list, ideally empty.

---

## D-001 — Activation KPI external keys are scoped to their activation

**Status:** active · **Found:** Stage 2, activations import · **Impact:** low, contained

### The conflict

Two frozen artifacts in the package disagree.

`OMD_MYSQL_DATABASE_SPEC_v1.md` §F2 maps the contract field straight onto the column:

```
activations[].kpis[].id  ->  activation_kpis.external_key
```

and `MYSQL_SCHEMA_BLUEPRINT.sql` puts a global uniqueness constraint on it:

```sql
UNIQUE KEY uq_activation_kpis_external_key (external_key)
```

But `OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json` carries **78 KPI entries sharing
only 33 distinct ids**. A campaign's KPI definitions are copied into every
activation of that campaign, so for example `demo-kpi-camp-004-1` appears in both
`activation-demo-industrial-object` and `activation-demo-heritage-weekend`.

The two cannot both be satisfied as written.

### Why the literal reading is not acceptable

Importing `kpi.id` directly as `external_key` collapses 78 rows into 33 and
reassigns each surviving row to whichever activation was imported last. An
activation that should show 5 KPIs shows none, and no error is raised — the
upsert simply overwrites. Silent data loss.

### Resolution

`activation_kpis.external_key` stores a scoped key:

```
<activationExternalKey>::<kpiId>
```

- all 78 rows are preserved, attached to the correct activation;
- the existing UNIQUE constraint is respected — no schema change;
- the contract id is recovered by splitting on `::` (`contractKpiId()` in
  `backend/src/activations/activation-import.ts`), so export can reproduce the
  original payload byte-for-byte.

Nothing else in the schema, the contracts or the API is affected. Material,
campaign, template and asset external keys were checked and are globally unique
as specified; KPIs are the only collision.

### To close this deviation

The package owner should confirm one of:

1. **Scoped keys are correct** — update DB spec §F2 to state that KPI keys are
   scoped per activation. This deviation then becomes the documented behaviour.
2. **KPI ids should be globally unique** — reissue the DEMO_SEED with 78 distinct
   KPI ids. This code can then map them directly and the deviation is removed.

Option 1 needs no data change and is the recommended reading, since a KPI
definition genuinely belongs to its activation rather than existing globally.

---

## D-002 — Strategic repere are edited in Administrare, not on Repere strategice

**Status:** active · **Decided:** 18.08.2026, by the client · **Impact:** UX placement only; no data, contract or API change

### The conflict

Two statements in the package place strategic editing on the operational screen.

`README_PROGRAMMER.md` §5.1:

> `Repere strategice` rămâne modul comun; ADMIN vede acolo acțiuni de editare.

`FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md` §11.8 fixes the Admin structure and is
explicit about the exclusion:

```text
Administrare
 ├ Utilizatori
 ├ Nomenclatoare
 ├ Importuri
 └ Audit
```

> reperele strategice NU se duplică în Admin

The implementation adds a fifth tab, `Administrare → Strategie`, holding
strategy versions, pillars, programs and objectives. The `Repere strategice`
screen is read-only for every role, ADMIN included.

### Why

The client asked for it directly, after the screen was rebuilt to match the
v13.3 prototype. Two things followed from that rebuild and made the request
reasonable:

1. **Pillars and strategy versions had no home.** The prototype's screen shows
   neither, so bringing the page to parity removed the only UI that reached
   `PUT /strategy/:v/pillars/:code` and `POST /strategy/versions/:key/activate`.
   The endpoints were left unreachable. They had to go somewhere.

2. **Editing on the screen costs the parity guarantee.** With an inline editor
   the page could only ever be pixel-identical to the prototype for VIEWER and
   EDITOR; ADMIN would always see one extra block. Moving it out makes the
   screen identical for all three roles, and the visual regression suite
   (`frontend/tests/visual-parity/`) passes 22/22 with no role-specific
   exception.

This does not duplicate anything: the repere are editable in exactly one place.
The concern §11.8 guards against — two UIs writing the same fields — does not
arise.

### What was NOT changed

- No API change. The tab uses the endpoints that already existed.
- No schema change.
- The repere did **not** join the ten nomenclatoare: they are version-scoped,
  carry no `is_system` flag, and their codes are unique per version rather than
  globally, so they are a separate tab with their own semantics.
- The rules the spec cares about are unchanged: codes stay read-only, a used
  reper is deactivated rather than deleted, and writes stay scoped to a strategy
  version.

### To close this deviation

The package owner should confirm one of:

1. **The placement is accepted** — update README_PROGRAMMER §5.1 and spec §11.8
   to allow a Strategie tab in Administrare, and this becomes documented
   behaviour.
2. **Editing must return to the operational screen** — the inline editor is
   restored in the Fișă view for ADMIN, `Administrare → Strategie` is reduced to
   strategy versions and pillars only, and the parity suite gains back its
   ADMIN-only exception.

Option 1 is the recommended reading: it concentrates strategic editing in one
place and lets the operational screen stay exactly what the prototype promised.
