# README PROGRAMATOR — OMD Valea Jiului

## 1. Start aici

Acest pachet este handoff-ul tehnic pentru implementarea live a:

**OMD Valea Jiului – Sistem digital de marketing**

Frontend-ul live va fi implementat în **React**.  
Backend-ul va folosi **MySQL 8.x**.

Obiectivul este ca aplicația live să reproducă funcțional și vizual prototipul v13.3, dar cu:
- autentificare reală;
- API;
- MySQL;
- file storage;
- importuri tranzacționale;
- audit;
- roluri;
- date persistente server-side.

---

## 2. Ordinea de autoritate a documentelor

Dacă există formulări diferite între fișiere, folosește această prioritate:

1. `06_IMPLEMENTATION_SPEC/FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md`
2. `02_DATABASE/OMD_MYSQL_DATABASE_SPEC_v1.md`
3. `02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql`
4. cele 4 JSON Schema din `03_JSON_CONTRACTS/`
5. prototipul v13.3 din `01_REFERENCE_FRONTEND/`
6. rapoartele din `05_ARCHITECTURE_CONTEXT/`

Fișierele din `05_ARCHITECTURE_CONTEXT/` descriu și etape intermediare istorice. Ele sunt context, nu au prioritate față de cele patru contracte JSON finale.

---

## 3. Structura pachetului

```text
01_REFERENCE_FRONTEND/
02_DATABASE/
03_JSON_CONTRACTS/
04_DEMO_SEEDS/
05_ARCHITECTURE_CONTEXT/
06_IMPLEMENTATION_SPEC/
README_PROGRAMMER.md
PACKAGE_CHECKSUMS.sha256
```

---

## 4. Ce este fiecare folder

### `01_REFERENCE_FRONTEND/`

#### `OMD-Valea-Jiului-prototip_external_json_v13_3.html`

Referința funcțională și vizuală.

Conține:
- layout;
- formulare;
- filtre;
- navigare;
- business behavior demonstrat;
- Plan anual;
- dashboards.

**Nu este frontend-ul final.**  
Frontend-ul final va fi React.

Nu copia mecanic globals `OMD.*` în React. Extrage regulile pure și reconstruiește UI-ul ca features/components/hooks, păstrând rezultatul vizual și funcțional.

#### `omd_import_packages_v1.js`

Importer browser-side folosit pentru demo.

Este **referință de comportament**, nu backend importer final.

Backend-ul trebuie să implementeze validare + preview + transaction + rollback în MySQL/storage.

---

### `02_DATABASE/`

#### `OMD_MYSQL_DATABASE_SPEC_v1.md`

Specificația logică și tehnică detaliată a DB.

Conține:
- tabele;
- relații;
- FK;
- mapping JSON → DB;
- import rules;
- audit;
- soft delete;
- monitoring;
- Plan anual.

#### `MYSQL_SCHEMA_BLUEPRINT.sql`

Blueprint MySQL 8.x.

Nu trebuie rulat orbește ca script unic de producție.

Transformă-l în migrations versionate.

Include:
- 40 CREATE TABLE;
- 1 VIEW: `v_annual_plan_effective_campaigns`.

#### `OMD_MYSQL_DATABASE_VALIDATION_REPORT_v1.md`

Raport static de verificare a proiectării și expected counts.

---

### `03_JSON_CONTRACTS/`

Cele patru contracte finale:

1. Campaigns
2. Activations
3. Activation Monitoring
4. Reputation Monitoring

Acestea sunt contractele oficiale de import/export v1.

**Acest handoff stabilește primul baseline contractual oficial `schemaVersion = 1.0`.** Versiunile interne/pre-release anterioare nu trebuie tratate ca variante contractuale v1.0 care trebuie suportate în paralel.

Din acest moment, breaking changes cer o versiune de contract nouă.

Nu inventa alte structuri de import fără nevoie.

---

### `04_DEMO_SEEDS/`

Cele patru fișiere DEMO_SEED sunt fixture-urile oficiale pentru staging/acceptance.

Ordinea de import:

```text
1. OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
2. OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json
3. OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
4. OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
```

Expected după import:

```text
Campaigns:                  6
Campaign templates:        15
Campaign visual assets:     8
Activations:               16
Activation materials:      42
Performance snapshots:     34
Reputation snapshots:       1

annual_plans DB:
2026
2027
2028
```

### `VISUAL_ASSETS_BUNDLE/`

Conține reprezentarea fizică a celor 8 assets care în Campaign DEMO_SEED sunt Base64.

```text
VISUAL_ASSETS_BUNDLE/
├── assets/campaigns/camp-002/*.jpg
├── ASSET_MANIFEST.json
├── ASSET_EXTRACTION_REPORT.md
└── OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1_external_assets.json
```

Important:

**Fișierul canonical pentru acceptance rămâne `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json` cu Base64.**

Scopul este să testăm că importerul backend poate:

```text
Base64 JSON
→ decode
→ physical file storage
→ assets DB
→ relationships
```

Bundle-ul fizic este suplimentar pentru:
- verificare;
- dezvoltare;
- debugging;
- comparație checksum;
- testarea storage-ului.

`*_external_assets.json` conține căi relative către folderul fizic. Nu presupune că un endpoint care primește doar acel JSON poate accesa folderul local al utilizatorului.

Nu este obligatoriu să construiești ZIP/folder importer în v1.

---

### `05_ARCHITECTURE_CONTEXT/`

#### `BACKEND_READINESS_REPORT.md`

Descrie refactorul prin care UI-ul prototipului a fost separat de localStorage și de regulile business.

Util pentru înțelegerea repository/service boundaries.

#### `DATA_PORTABILITY_REPORT.md`

Document istoric al etapei intermediare `OMD_DATA_PACKAGE`.

**Nu utiliza contractul monolitic din acest document ca model final.**

Modelul final este format din cele 4 package-uri independente din `03_JSON_CONTRACTS/`.

#### `EXTERNAL_JSON_IMPORT_REPORT_v13_3.md`

Verificarea end-to-end a prototipului v13.3 cu cele 4 fișiere externe.

---

### `06_IMPLEMENTATION_SPEC/`

#### `FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md`

Documentul principal pentru implementare.

Include:
- React frontend;
- API;
- backend;
- auth;
- roles;
- CRUD;
- imports;
- asset storage;
- Plan anual;
- monitoring;
- audit;
- deployment;
- staging/production;
- tests;
- acceptance criteria.

**Citește acest document integral înainte de coding.**

---

## 5. React — ce se schimbă și ce NU

Se schimbă:
- structura frontend;
- componentele;
- routing-ul;
- state/query management;
- API integration;
- lifecycle/loading/error handling.

NU se schimbă:
- DB;
- JSON contracts;
- external keys;
- business rules;
- formular fields;
- annual-plan logic;
- golden values;
- UI direction;
- API responsibilities.

Nu recrea structura `OMD.*` ca global singleton în React.

Recomandarea conceptuală:

```text
React feature/component
      ↓
hook/query
      ↓
ApiRepository / ApiClient
      ↓
REST API
```

Server state nu trebuie duplicat în `localStorage`.

---

## 5.1. Login, Admin și roluri

Există:
- **un singur login**;
- **o singură aplicație React**;
- **un singur design system**.

ADMIN nu intră într-o aplicație separată.

După login, inclusiv Adminul intră în zona operațională. ADMIN vede suplimentar în aceeași sidebar:

```text
Administrare
 ├ Utilizatori
 ├ Nomenclatoare
 ├ Importuri
 └ Audit
```

`Repere strategice` rămâne modul comun; ADMIN vede acolo acțiuni de editare.

### Roluri

```text
ADMIN  = operațional + administrare completă
EDITOR = operare Campanii/Activări/Plan, fără Admin
VIEWER = read-only
```

Backend-ul verifică rolurile; ascunderea butoanelor în React nu este mecanism de securitate.

Zona Admin trebuie să arate ca restul aplicației OMD, nu ca un backoffice generic.

---

## 5.2. Bootstrap din JSON — cerință obligatorie

Nu hardcoda nomenclatoare sau repere strategice în React/backend.

`OMD_CAMPAIGNS_PACKAGE` conține:
- `strategicData.strategyVersion`;
- `strategicData.pillars/programs/objectives`;
- `catalogs`;
- `campaigns`;
- templates/assets.

`strategyVersion` este obligatoriu în contractul final v1 și păstrează campaniile legate de orizontul strategic corect.

Prin urmare:

```text
DB business goală
   ↓
Campaign Package
   ↓
strategie + nomenclatoare + campanii + assets
```

fără introducere manuală.

### Staging

Folosește DEMO_SEED și testați/liber modificați datele simulate.

### Production

Pornește dintr-o bază production separată, goală ca date business, și importă un Campaign Package real cu:

```text
purpose = INITIAL_IMPORT
```

Nu transforma staging-ul în production.

După bootstrap, Admin poate modifica nomenclatoarele/strategia din UI.

La importuri ulterioare:
- `code` existent → se folosește DB;
- label diferit → warning;
- Admin label NU este suprascris implicit;
- code nou valid → poate fi creat la commit.

Acesta este mecanismul prin care datele reale pot înlocui rapid datele demo fără reintroducere manuală.

---

## 6. Testul principal de staging

DB goală → migrations → Admin → cele 4 imports.

Apoi verifică minimum:

### Bootstrap Campaign Package

```text
StrategyVersions: 1
Pillars: 4
Programs: 8
Objectives: 18

campaignTypes: 3
campaignStatuses: 3
audiences: 10
ctas: 9
products: 12
channels: 12
seasonalityTypes: 7
activationChannels: 5
implementationModes: 4
fundingTypes: 5

Campaigns: 6
Templates: 15
Assets: 8
```

Toate trebuie să apară după import, fără pre-seeding manual de business data.

### Plan anual 2026

```text
Campanii efective:         6
Activări în plan:         10
Buget planificat:    177.500 lei
Finanțare:                 0 lei
Cheltuială:          123.400 lei
Execuție:               69,5%
```

### Reputation

```text
Mențiuni: 1.284
Review-uri: 214
Rating: 4,42
Pozitiv: 67%
```

### Assets

```text
8 assets fizice
12 ActivationMaterials cu templateAssetId se rezolvă
0 referințe nerezolvate
```

Acceptance complet este în FULLSTACK spec.

---

## 6.1. Strategie pe termen lung

Schema nu presupune că strategia 2026–2028 este permanentă.

Reperele sunt scópate prin:

```text
strategy_versions
```

Exemplu:

```text
strategy-2026-2028
strategy-2029-2033
```

Aceleași coduri precum `OS2` pot exista în ambele versiuni cu sensuri diferite, fără ca o campanie istorică să își piardă contextul.

Regula:
- corecție editorială → edit în aceeași versiune;
- schimbare semantică / strategie nouă → versiune nouă.

---

## 6.2. Continuitatea unei campanii între strategii

```text
1 Campaign = 1 StrategyVersion
```

Dacă ideea continuă:

```text
Campaign vechi / strategy-2026-2028 / family-X
        ↓ Continue
Campaign nou / strategy-2029-2033 / family-X
supersedes = vechi
status = DRAFT
```

Nu se mută Campaign-ul vechi la strategia nouă.

`Continue in new strategic cycle`:
- externalKey nou;
- aceeași family;
- predecessor păstrat;
- conținut editorial copiat ca draft;
- programele/obiectivele strategice se aleg din nou;
- Activation/AnnualPlan/Monitoring nu se copiază;
- assets fizice pot fi reutilizate.

Activation creată din Campaign moștenește automat StrategyVersion și nu cere userului să aleagă strategia încă o dată.

---

## 6.3. Ștergere, dezactivare și integritate

### Nomenclatoare

```text
system
→ delete interzis

non-system + 0 referințe
→ delete fizic permis

non-system + referințe
→ delete blocat
→ deactivate permis
```

`is_system` este metadata tehnică și nu este importată/editată prin business JSON.

Minimum `DRAFT`, `ACTIVE`, `CLOSED` sunt valori system/protejate.

### Campaign / Activation

```text
terminată normal
→ CLOSED

creată din greșeală + neutilizată
→ soft delete posibil

are istoric/dependențe
→ delete blocat
→ 409 ENTITY_IN_USE
```

Backend-ul face dependency check și îl repetă la DELETE. FK `RESTRICT` este doar safety net.

Dependency counts includ și referințele din rânduri CLOSED/soft-deleted/restorable, nu doar entitățile vizibile în listele curente.

Protected master codes `DRAFT/ACTIVE/CLOSED` trebuie marcate automat `is_system=1` la primul bootstrap prin registry tehnic, nu manual de utilizator.

### Staging

Se livrează `reset-staging-business-data`, disponibil numai în staging, pentru a curăța datele de test și a reimporta DEMO_SEED. Nu există `reset all` în production.

Detalii complete: FULLSTACK v1.5 → **Deletion & Referential Integrity Policy**.

---

## 7. Production

În production:

- NU importa DEMO_SEED;
- pornește cu DB production separată;
- populează business data prin Campaign Package real `purpose=INITIAL_IMPORT`;
- NU cere introducere manuală pentru strategie/nomenclatoare dacă ele există în package;
- NU păstra business data în localStorage;
- NU stoca Base64 în MySQL;
- NU hardcoda Campanii/Activări/nomenclatoare demo.

Flux normal:

```text
CAMPAIGNS_PACKAGE_REAL
       ↓
Campaigns

Activation create/edit în UI
       ↓
Activations

periodic:
ACTIVATION_MONITORING_PACKAGE_REAL

separat:
REPUTATION_MONITORING_PACKAGE
```

---

## 8. Înainte de coding

Confirmă:

```text
[ ] backend stack
[ ] MySQL target version
[ ] React build tooling
[ ] Admin integrat în aceeași aplicație/login/design
[ ] initial JSON bootstrap flow confirmat
[ ] staging server
[ ] production server constraints
[ ] upload/storage path
[ ] domain/subdomain
[ ] HTTPS
[ ] migration mechanism
[ ] testing framework
[ ] toate fișierele din acest pachet primite
```

Dacă serverul beneficiarului impune constrângeri care afectează stack-ul, documentează-le înainte de implementare.

---

## 9. Ce NU trebuie reinterpretat

- `external_key` este stabil.
- fiecare Campaign aparține exact unei StrategyVersion.
- `campaignFamilyExternalKey` leagă definițiile succesive ale aceleiași linii de campanie.
- `supersedesCampaignExternalKey` indică predecessorul istoric.
- Campaign/Activation DB ID intern este separat.
- `includeAnnualPlan` se materializează în `annual_plan_activations`.
- 2026 trebuie materializat automat în Planul anual din seed.
- `annual_plan_campaigns` conține selecții manuale.
- campaniile efective = manual `UNION DISTINCT` campaniile activărilor incluse.
- monitoring este istoric pe snapshots.
- `NULL` este diferit de `0`.
- Admin edits pe master data nu sunt suprascrise implicit la import.
- Activation independentă este validă.
- custom audience este valid.
- imaginile sunt fișiere fizice în production storage, nu Base64 DB.
- nomenclatoarele non-system neutilizate pot fi șterse fizic.
- nomenclatoarele utilizate se dezactivează, nu se cascade-delete.
- valorile master system sunt protejate.
- Campaign/Activation cu istoric nu se șterg pentru a reprezenta finalizarea; se folosesc statusurile business.

---

## 9.1. Guardrails pentru dezvoltări viitoare

Programatorul trebuie să păstreze:
- API versionat `/api/v1`;
- JSON adapters pe `(packageType, schemaVersion)`;
- pagination pe list/history endpoints;
- `AssetStorage` abstraction;
- integrarea sistemelor externe prin adapters → domain services;
- migrations ca singura cale de evoluție DB;
- strategia versionată;
- codurile master semantic immutable.

Nu se adaugă câmpuri provider-specific în entitățile core.

Pentru scenarii care NU sunt în v1 și ar necesita dezvoltare separată vezi:
`06_IMPLEMENTATION_SPEC/ARCHITECTURE_RISK_REVIEW_v1.md`.

---

## 10. Criteriul de succes

Staging-ul, populat din cele patru DEMO_SEED, trebuie să reproducă funcțional prototipul v13.3. Primul Campaign import trebuie să populeze și strategia/nomenclatoarele fără intervenție manuală.

Datele trebuie să provină din:

```text
React
  ↓
API
  ↓
MySQL + physical asset storage
```

și nu din localStorage sau fixture-uri hardcodate.
