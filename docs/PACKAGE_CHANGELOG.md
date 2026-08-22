# PACKAGE CHANGELOG

## v3 / FULLSTACK v1.2

Clarificări adăugate:
- un singur login și o singură aplicație React;
- Admin este modul integrat, nu backoffice separat;
- același design system pentru Admin și zona operațională;
- matrice explicită ADMIN / EDITOR / VIEWER;
- strategie editată de Admin în modulul comun Repere strategice;
- `OMD_CAMPAIGNS_PACKAGE` este mecanism obligatoriu de initial business bootstrap;
- staging și production pot fi populate din JSON fără introducere manuală de nomenclatoare/strategie;
- production folosește DB separată și `purpose=INITIAL_IMPORT`;
- Admin labels sunt protejate la reimport;
- codurile noi valide pot fi create la import;
- Preview import arată separat impactul pe Strategie / Nomenclatoare / Campanii / Assets;
- acceptance tests pentru bootstrap și Admin shell.

Nu au fost modificate:
- schema MySQL;
- cele 4 JSON Schema;
- DEMO_SEED data;
- external keys;
- regulile Annual Plan;
- visual assets.

## v4 / FULLSTACK v1.3 / DB v1.2

Corecții critice de durabilitate:
- `strategy_versions` introdus; 40 tabele total;
- strategic codes sunt unice per versiune, nu global;
- Campaign și Activation păstrează `strategy_version_id`;
- Campaign JSON conține `strategicData.strategyVersion`;
- Activation independentă poate transporta `strategyVersionExternalKey`;
- `result_2028` DB a devenit `horizon_result_text`;
- CHECK `import_batches.purpose` este compatibil cu toate cele 4 JSON contracts;
- API compatibility policy și pagination definite din v1;
- contract/schema adapter registry definit pentru viitoare package versions;
- AssetStorage abstraction;
- external integration adapter boundary;
- safe migration rules;
- document nou `ARCHITECTURE_RISK_REVIEW_v1.md`.

Nu au fost introduse:
- microservicii;
- queue obligatoriu;
- multi-tenancy;
- plugin engine;
- multilingual tables;
- revision workflow complex.

## v5 / FULLSTACK v1.4 / DB v1.3

- Campaign JSON adds `campaignFamilyExternalKey` + `supersedesCampaignExternalKey`;
- MySQL Campaign adds `campaign_family_external_key` + `supersedes_campaign_id`;
- one Campaign family member per StrategyVersion;
- explicit `Continue in new strategic cycle`;
- successor is new DRAFT / new externalKey / same family / supersedes old;
- strategic links are reselected in target strategy;
- parent is not copied cross-strategy automatically;
- Activation/AnnualPlan/Monitoring are not duplicated;
- templates may be duplicated while physical assets are reused;
- used Campaign StrategyVersion is immutable;
- Activation derived from Campaign inherits StrategyVersion;
- Campaign selectors default to current StrategyVersion and show strategy labels.

## v6 / FULLSTACK v1.5 / DB v1.4

Deletion & Referential Integrity:
- `is_system` added to all 10 editable master catalog tables;
- protected values are backend/migration metadata, not business JSON;
- minimum protected statuses: DRAFT / ACTIVE / CLOSED;
- non-system + 0 references → physical master delete;
- referenced master → delete blocked / deactivate allowed;
- system master → protected;
- dependency preview endpoints added;
- DELETE repeats dependency checks;
- standardized 409 `ENTITY_IN_USE`, `SYSTEM_VALUE_PROTECTED`, `ASSET_IN_USE`;
- Campaign/Activation deletion eligibility defined;
- CLOSED explicitly separated from delete;
- asset usage/storage deletion policy defined;
- FK race converted to controlled 409;
- staging-only reset/reseed command defined;
- deletion unit/API/DB/E2E tests added.

## v6 FINAL — final handoff review

No schema/table/JSON-field changes.

Clarifications only:
- package v6 FINAL freezes the first official JSON `schemaVersion=1.0` contract baseline;
- exact `SystemMasterRegistry` behavior specified for protected master codes;
- DRAFT/ACTIVE/CLOSED guaranteed `is_system=1` at initial bootstrap/backfill;
- dependency counts include CLOSED and soft-deleted/restorable references;
- generic Soft Delete section explicitly subordinated to DeletionPolicy;
- manual Activation create requires Campaign ACTIVE;
- historical import path distinguished from manual operational create;
- Architecture Risk Review stale version reference corrected.
