# OMD MySQL DB Design – Validation Report v1.4

Data: 13 august 2026

## JSON contracts

- Campaigns schema + demo seed: PASS / 0 errors
- Activations schema + demo seed: PASS / 0 errors
- Activation Monitoring schema + demo seed: PASS / 0 errors
- Reputation Monitoring schema + demo seed: PASS / 0 errors

## Mapping coverage

- Campaigns: 166 / 166 reachable leaf paths mapped
- Activations: 71 / 71
- Activation Monitoring: 31 / 31
- Reputation Monitoring: 38 / 38
- Total: 306 / 306

## SQL blueprint static checks

- CREATE TABLE: 40
- CREATE VIEW: 1 (`v_annual_plan_effective_campaigns`)
- all referenced FK tables exist: PASS
- no forward-table FK dependency outside self references: PASS
- local/remote FK columns exist: PASS
- duplicate named constraints: 0
- PostgreSQL-specific JSONB: absent
- SERIAL: absent
- PostgreSQL RETURNING/ILIKE: absent
- business demo INSERT statements: absent

## Seed facts used in acceptance criteria

- campaigns: 6
- activations: 16
- materials: 42
- explicit annualPlans records in JSON: 2 (2027, 2028)
- expected materialized `annual_plans` in DB: 3 (2026, 2027, 2028)
- performance snapshots: 34
- reputation snapshots: 1
- campaign templates: 15
- visual assets in Campaign seed: 8
- strategy versions: 1 (`strategy-2026-2028`)
- strategic pillars/programs/objectives: 4/8/18
- custom independent activation audience confirmed: Public regional și vizitatori de weekend
- `includeAnnualPlan=true` activations: 15
- expected `annual_plan_activations` after calendar-year materialization: 16
  - 2026: 10
  - 2027: 5
  - 2028: 1
- expected missing-plan warnings: 0
- expected effective campaigns in Plan 2026: 6 (`manual UNION DISTINCT automatic`)
- explicit/manual `annual_plan_campaigns` relations: 5

## Annual Plan correction verified

The corrected model matches the prototype semantics:

- `annualPlans[]` transports manual campaign selections; it is not the exhaustive list of years visible in Planul anual;
- Activation inclusion is materialized in `annual_plan_activations`;
- a missing `annual_plans(year)` row is created deterministically from the Activation period;
- effective campaign membership is `manual selections UNION DISTINCT campaigns of included Activations`;
- automatic campaign membership is not duplicated into `annual_plan_campaigns`.

For the current demo seed this reproduces Plan 2026: 10 included Activations and 6 distinct Campaigns.

## Note

This is a design/static validation, not execution against a live MySQL server. The programmer should run the generated migrations on the exact target MySQL 8.x version and execute the acceptance suite before backend integration.

## Critical coherence corrections v1.2

- **Import purpose compatibility:** SQL `import_batches.purpose` accepts the union of the final package contracts:
  `DEMO_SEED`, `INITIAL_IMPORT`, `UPDATE`, `AD_HOC`, `BASELINE`, `QUARTERLY_IMPORT`.
- **Strategy history:** added `strategy_versions`; strategic code uniqueness is scoped by strategy version.
- **Future horizon neutrality:** JSON v1 `result2028` maps to generic DB column `horizon_result_text`.
- **Campaign/Activation context:** both persist `strategy_version_id`; independent Activation can transport `strategyVersionExternalKey`.

## Campaign lineage / strategic-cycle continuity

- `campaign_family_external_key` added to Campaign.
- `supersedes_campaign_id` self-FK added.
- Unique `(campaign_family_external_key, strategy_version_id)` prevents duplicate family definitions inside the same strategy.
- Same family may exist across multiple StrategyVersions.
- Activation context is unambiguous: StrategyVersion is inherited from Campaign.

## Deletion & Referential Integrity v1.4

- 10 editable master tables contain `is_system TINYINT(1) NOT NULL DEFAULT 0`.
- all 10 contain CHECK `is_system IN (0,1)`.
- `is_system` is technical metadata, not Campaign business JSON.
- non-system + zero references may be physically deleted.
- referenced master rows are protected by backend policy and FK RESTRICT; deactivate is supported.
- Campaign/Activation deletion remains soft/non-destructive where eligible.
- `CLOSED` is distinct from soft deletion.

## Final handoff coherence review

- current handoff establishes the first official JSON `schemaVersion=1.0` compatibility baseline;
- protected master codes are required to receive `is_system=1` transactionally through `SystemMasterRegistry` during CREATE/UPSERT;
- dependency checks explicitly include CLOSED/inactive/soft-deleted/restorable physical references;
- generic soft-delete wording is subordinate to `Deletion & Referential Integrity Policy`;
- manual Activation creation requires an ACTIVE Campaign; historical import remains a separate controlled path.
