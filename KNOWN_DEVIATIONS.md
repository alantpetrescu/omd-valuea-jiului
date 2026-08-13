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
