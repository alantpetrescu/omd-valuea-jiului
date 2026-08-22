# OMD Valea Jiului — FULLSTACK IMPLEMENTATION SPEC v1.5

> **Copia de lucru.** Originalul livrat stă în
> `programmer_full_package_FINAL/06_IMPLEMENTATION_SPEC/` și nu se modifică.
> Aici se adaugă deciziile luate în timpul implementării; fiecare e marcată cu
> subcapitol propriu, ca diferența față de original să fie citibilă. Prima e
> §11.8.1.

**Aplicație:** OMD Valea Jiului – Sistem digital de marketing  
**Scop:** implementarea live a prototipului v13.3 cu frontend + backend + MySQL + storage de fișiere + autentificare + importuri JSON  
**Țintă de implementare:** aproximativ 3–4 săptămâni + stabilizare  
**Status:** specificație de handoff pentru programator / AI de coding  
**Clarificare v1.1:** frontend-ul live va fi implementat în **React**; această alegere este definitivă pentru v1.  
**Clarificare v1.2:** există o singură aplicație React și un singur login; Admin este un modul protejat în aceeași aplicație și folosește același design system. O bază fără date business trebuie să poată fi populată complet prin package-uri JSON, inclusiv strategie și nomenclatoare, fără introducere manuală.  
**Clarificare v1.3:** strategia este versionată explicit pentru a păstra istoricul între orizonturi strategice; API/JSON contracts au reguli de compatibilitate; list endpoints sunt paginabile din v1; storage-ul și viitoarele integrări externe trebuie izolate prin adaptoare.  
**Clarificare v1.4:** o Campaign aparține exact unei StrategyVersion. O campanie care continuă într-un nou ciclu strategic este duplicată ca nou Campaign DRAFT, cu aceeași `campaignFamilyExternalKey` și `supersedesCampaignExternalKey` către definiția anterioară. Activation moștenește StrategyVersion a Campaign.  
**Clarificare v1.5:** toate operațiile delete/deactivate au dependency checks obligatorii. Master data non-system neutilizată poate fi ștearsă fizic; master data utilizată se dezactivează; valorile system sunt protejate. Campaign/Activation cu istoric nu se șterg pentru a reprezenta finalizarea.  
**Baza de date:** MySQL 8.x, conform `OMD_MYSQL_DATABASE_SPEC_v1.md` și `MYSQL_SCHEMA_BLUEPRINT.sql`

---

# 0. Cum trebuie folosit acest document

Acest document este specificația de implementare full-stack.

Programatorul trebuie să primească împreună cu el următoarele fișiere.

## 0.1. Referință funcțională și vizuală

1. `OMD-Valea-Jiului-prototip_external_json_v13_3.html`
2. `omd_import_packages_v1.js`

Prototipul v13.3 este **referința vizuală și funcțională**.

Aplicația live trebuie să păstreze:
- structura ecranelor;
- navigarea;
- textele și terminologia;
- filtrele;
- formularele;
- relațiile dintre module;
- comportamentul Planului anual;
- logica de monitorizare;
- stilul vizual.

Nu se reproiectează UI-ul decât unde această specificație cere explicit o funcție nouă de administrare sau unde trecerea la backend necesită un mesaj de loading/error/conflict.

`omd_import_packages_v1.js` este **referință pentru logica demonstrată de import**, nu codul final de import în producție. În aplicația live, importurile scriu tranzacțional în MySQL și storage, nu în `localStorage`.

## 0.2. Specificația bazei de date

3. `OMD_MYSQL_DATABASE_SPEC_v1.md`
4. `MYSQL_SCHEMA_BLUEPRINT.sql`
5. `OMD_MYSQL_DATABASE_VALIDATION_REPORT_v1.md`

Ordinea de prioritate:
1. prezenta specificație full-stack;
2. specificația DB;
3. blueprint-ul SQL;
4. prototipul v13.3;
5. contractele JSON finale.

Dacă apare o contradicție reală, implementarea se oprește pe acel punct și se documentează înainte de a schimba modelul.

## 0.3. Contracte JSON

6. `OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1.json`
7. `OMD_ACTIVATIONS_PACKAGE_SCHEMA_v1.json`
8. `OMD_ACTIVATION_MONITORING_PACKAGE_SCHEMA_v1.json`
9. `OMD_REPUTATION_MONITORING_PACKAGE_SCHEMA_v1.json`

Acestea sunt contractele de integrare.

## 0.4. Date demo pentru staging / acceptance

10. `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json`
11. `OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json`
12. `OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json`
13. `OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json`

Aceste fișiere trebuie să poată reconstrui staging-ul dintr-o bază goală.

### 0.4.1. Visual assets bundle suplimentar

Pachetul de handoff include și:

```text
04_DEMO_SEEDS/VISUAL_ASSETS_BUNDLE/
├── assets/campaigns/...
├── ASSET_MANIFEST.json
├── ASSET_EXTRACTION_REPORT.md
└── OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1_external_assets.json
```

Acesta este un **material suplimentar de dezvoltare și verificare**, nu înlocuiește contractul canonical de import.

Pentru acceptance test-ul importerului backend, sursa principală rămâne:

`OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json`

care conține cele 8 imagini Base64.

Copia `*_external_assets.json` și fișierele fizice există pentru:
- verificare vizuală;
- dezvoltare;
- testarea storage-ului;
- compararea asset-urilor;
- eventual suport pentru un import bundle viitor.

Un endpoint care primește doar un singur fișier JSON NU trebuie să presupună că poate rezolva automat căi relative de pe calculatorul utilizatorului.

## 0.5. Context arhitectural recomandat

14. `BACKEND_READINESS_REPORT.md`
15. `DATA_PORTABILITY_REPORT.md`
16. `EXTERNAL_JSON_IMPORT_REPORT_v13_3.md`

---

# 1. Obiectivul implementării

Rezultatul trebuie să fie o aplicație web live în care:

```text
Browser
   ↓
Frontend v13.3 adaptat pentru API
   ↓
Backend API
   ↓
Repositories / Services
   ↓
MySQL + File Storage
```

MySQL devine **single source of truth** pentru datele business.

În aplicația live NU trebuie să existe:

```text
hardcoded demo data
→ localStorage
→ UI
```

și nici:

```text
JSON file
→ frontend
→ localStorage
```

ca mecanism permanent.

JSON-urile sunt exclusiv:
- seed pentru staging;
- import;
- export/interoperabilitate;
- transfer de date.

---

# 2. Scope v1

## 2.1. Funcționalități obligatorii

Trebuie implementate live:

1. autentificare;
2. utilizatori și roluri;
3. Campanii;
4. Repere strategice;
5. nomenclatoare editabile de Admin;
6. Activări;
7. materiale ale activărilor;
8. upload de vizualuri;
9. KPI activări;
10. finanțări;
11. Plan anual — plan operațional;
12. Plan anual — calendar;
13. Monitorizare activări;
14. Monitorizare reputație;
15. import Campaign Package;
16. import Activations Package;
17. import Activation Monitoring Package;
18. import Reputation Monitoring Package;
19. preview înainte de import;
20. istoric importuri;
21. audit minimal;
22. soft delete;
23. optimistic concurrency;
24. staging + production separate;
25. administrarea din UI a nomenclatoarelor și reperelor strategice;
26. versiuni strategice (`strategy_versions`) și păstrarea istoricului între orizonturi strategice;
27. continuitatea unei campanii între cicluri strategice prin duplicare controlată/lineage.

## 2.2. În afara scope-ului v1

NU se implementează în această etapă:

- microservicii;
- CQRS;
- event sourcing;
- real-time collaborative editing;
- WebSocket pentru actualizări live;
- OAuth / login Google/Microsoft;
- reset parolă prin email;
- workflow de aprobare complex;
- version-control complet al campaniilor;
- CMS generic;
- object storage complex dacă filesystem-ul serverului este suficient;
- parser Word → JSON în interiorul aplicației;
- API live Social Insider/Zelist dacă fluxul real rămâne import periodic;
- ingestie de review-uri individuale sau date personale;
- ZIP importer pentru assets, dacă nu încape în termen.

Contractul DB trebuie însă să rămână compatibil cu un viitor `campaign_package.zip`.

---

# 3. Principii obligatorii de implementare

## 3.1. Monolit modular

Pentru termenul de implementare, se recomandă un singur backend modular și un singur frontend.

NU se fragmentează în microservicii.

## 3.2. Same origin

Recomandat:

```text
https://subdomeniu-beneficiar.ro/
https://subdomeniu-beneficiar.ro/api/v1/...
```

Frontend-ul și API-ul trebuie servite sub aceeași origine, dacă infrastructura beneficiarului permite.

Avantaje:
- autentificare mai simplă;
- cookies HttpOnly;
- CORS minim;
- deployment mai simplu.

## 3.3. Tehnologie backend

**MySQL 8.x este obligatoriu.**

Limbajul/framework-ul backend poate fi ales de programator în funcție de serverul beneficiarului, cu condiția să suporte toate cerințele acestui document.

Exemple acceptabile:
- Node.js + TypeScript + Express/Fastify;
- PHP + Laravel/Symfony;
- alt framework matur acceptat de beneficiar.

Înainte de coding, programatorul trebuie să scrie în `README_IMPLEMENTATION.md`:

```text
Backend runtime:
Backend framework:
DB driver / ORM / query builder:
JSON Schema validator:
Password hashing:
Test framework:
Browser E2E framework:
Process manager / deployment method:
```

Nu este permisă schimbarea contractelor funcționale în funcție de framework.

## 3.4. Frontend — React

Frontend-ul live va fi implementat în **React**.

Această alegere NU schimbă:
- modelul MySQL;
- contractele JSON;
- API contractul;
- regulile de business;
- external keys;
- acceptance values;
- UI/UX-ul de referință din v13.3.

React este o schimbare de implementare a stratului UI, nu o schimbare funcțională.

## Reguli de migrare v13.3 → React

1. Prototipul v13.3 rămâne referința vizuală și funcțională.
2. CSS-ul existent trebuie reutilizat cât mai mult ca baseline; nu se face redesign.
3. Modulele globale `OMD.*` NU trebuie recreate mecanic ca obiect global în React.
4. Regulile pure din `OMD.services` trebuie mutate în module TypeScript/JavaScript testabile.
5. Accesul la backend trebuie izolat într-un strat `api/repositories/services`.
6. Componentele React nu accesează direct `fetch()` în mod repetat și neorganizat.
7. Datele business nu se persistă în `localStorage`.
8. `localStorage` poate păstra numai preferințe UI necritice.
9. Formularele trebuie să păstreze câmpurile, validările și fluxul prototipului.
10. Routing-ul client-side trebuie să suporte refresh direct pe rutele aplicației prin configurarea web serverului.

## Organizare recomandată React

```text
frontend/src/
├── app/
├── api/
├── components/
├── features/
│   ├── campaigns/
│   ├── strategy/
│   ├── activations/
│   ├── annual-plan/
│   ├── monitoring/
│   ├── admin/
│   └── auth/
├── domain/
├── services/
├── hooks/
├── styles/
└── tests/
```

Programatorul poate folosi un mecanism matur de query/cache pentru server state sau o implementare echivalentă, dar nu trebuie introdus un state-management enterprise inutil.

### Server state vs UI state

**Server state:**
- campaigns;
- activations;
- catalogs;
- strategy;
- annual plans;
- monitoring;
- users;
- imports.

Acestea provin din API și trebuie invalidate/refreshed după mutații.

**UI state:**
- modal deschis;
- tab;
- filtre locale;
- cards/list;
- expanded sections.

Acesta poate rămâne în React state/context.

Nu copia server state în mai multe store-uri paralele fără nevoie.

---

# 4. Structura recomandată a proiectului

Exemplu:

```text
/omd-valea-jiului
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── app/
│   │   ├── api/
│   │   ├── components/
│   │   ├── features/
│   │   ├── domain/
│   │   ├── services/
│   │   ├── hooks/
│   │   ├── styles/
│   │   └── tests/
│   ├── index.html
│   └── package.json
│
├── backend/
│   ├── src/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── catalogs/
│   │   ├── strategy/
│   │   ├── campaigns/
│   │   ├── activations/
│   │   ├── annual-plans/
│   │   ├── monitoring/
│   │   ├── imports/
│   │   ├── assets/
│   │   ├── audit/
│   │   └── shared/
│   └── tests/
│
├── database/
│   ├── migrations/
│   └── technical-seeds/
│
├── storage/
│   ├── uploads/
│   └── import-temp/
│
├── contracts/
│   ├── OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1.json
│   ├── OMD_ACTIVATIONS_PACKAGE_SCHEMA_v1.json
│   ├── OMD_ACTIVATION_MONITORING_PACKAGE_SCHEMA_v1.json
│   └── OMD_REPUTATION_MONITORING_PACKAGE_SCHEMA_v1.json
│
├── tests/
│   ├── fixtures/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── FULLSTACK_IMPLEMENTATION_SPEC_v1.md
│   ├── OMD_MYSQL_DATABASE_SPEC_v1.md
│   └── API_OPENAPI.yaml
│
├── .env.example
└── README.md
```

Structura exactă poate varia, dar separarea responsabilităților nu.

---

# 5. Medii

Trebuie să existe minimum:

```text
STAGING
PRODUCTION
```

## 5.1. Staging

Bază:

```text
omd_vj_staging
```

Scop:
- import DEMO_SEED;
- dezvoltare;
- UAT;
- teste de regresie;
- reset controlat.

## 5.2. Production

Bază:

```text
omd_vj_production
```

Nu se importă DEMO_SEED.

Fluxul normal production:

```text
CAMPAIGNS_PACKAGE_REAL
        ↓
Campaigns

OMD creează Activations în UI
        ↓
Activations

ACTIVATION_MONITORING_PACKAGE_REAL
        ↓
Performance snapshots

REPUTATION_MONITORING_PACKAGE
        ↓
Reputation snapshots
```

## 5.3. Reguli

- aceleași migrations în staging și production;
- configurări `.env` diferite;
- storage separat;
- loguri separate;
- DB credentials separate;
- niciun `is_demo` pe tabelele business.

---

# 6. Configurație / environment variables

Minimum:

```text
APP_ENV=staging|production
APP_BASE_URL=
APP_SECRET=

DB_HOST=
DB_PORT=
DB_NAME=
DB_USER=
DB_PASSWORD=

UPLOAD_DIR=
IMPORT_TEMP_DIR=
MAX_UPLOAD_MB=
MAX_JSON_IMPORT_MB=

AUTH_SECRET=
AUTH_TOKEN_TTL=

LOG_LEVEL=
```

Opțional:

```text
TRUST_PROXY=
ALLOWED_ORIGIN=
BACKUP_DIR=
```

Reguli:
- `.env` nu intră în Git;
- `.env.example` intră în Git fără parole;
- aplicația trebuie să refuze startul dacă variabilele critice lipsesc.

---

# 7. Database migrations

`MYSQL_SCHEMA_BLUEPRINT.sql` este blueprint, nu migration finală.

Programatorul trebuie să transforme schema în migrations versionate.

Exemplu:

```text
001_roles_users.sql
002_import_audit.sql
003_catalogs.sql
004_strategy.sql
005_campaigns.sql
006_campaign_assets.sql
007_activations.sql
008_annual_plans.sql
009_monitoring.sql
010_views.sql
```

Migrations trebuie:
- să poată construi o DB goală;
- să poată fi aplicate repetabil prin mecanismul framework-ului;
- să fie aceleași pentru staging/prod.

## 7.1. Reguli pentru evoluția DB

Pentru a evita blocarea aplicației la dezvoltări viitoare:

- migrations sunt singura cale de schimbare a schemei;
- nu se modifică manual schema în production;
- schimbările destructive folosesc modelul **expand → migrate/backfill → switch code → contract**;
- nu se șterge/redenumește o coloană folosită în aceeași release în care se introduce înlocuitorul;
- înainte de migration destructive se face backup verificabil;
- migration scripts trebuie să fie reproductibile pe staging înainte de production;
- datele istorice nu se rescriu pentru a „se potrivi” noii strategii sau noilor nomenclatoare;
- un modul viitor poate adăuga tabele/coloane/indexuri fără a modifica arbitrar tabelele altor module.

Nu se introduc Campanii/Activări demo în migration.

Singurele date tehnice permise ca seed sunt:
- rolurile ADMIN / EDITOR / VIEWER;
- eventual un utilizator Admin inițial creat controlat;
- configurări strict tehnice.

---

# 8. Identitate și DTO-uri

## 8.1. DB

În DB:

```text
id = UUID CHAR(36)
external_key = identificator stabil pentru integrare
```

## 8.2. Frontend canonical compatibility

Prototipul v13.3 utilizează ID-uri canonical de tip:

```text
camp-002
activation-demo-outdoor-spring
demo-spring-ig-reel
```

Pentru a evita rescrierea inutilă a UI:

**ApiRepository trebuie să expună frontend-ului obiectele canonical folosind external_key ca identitate funcțională.**

Backend-ul poate păstra UUID intern complet ascuns UI-ului.

Exemplu:

```text
DB:
id = 7f...
external_key = camp-002

Frontend canonical:
id = camp-002
```

Pentru API poate fi expus și:

```json
{
  "externalKey": "camp-002"
}
```

dar relațiile UI nu trebuie mutate arbitrar pe UUID.

## 8.3. External keys generate de sistem

Pentru entități create manual, serverul generează chei stabile, de exemplu:

```text
camp-<uuid>
activation-<uuid>
material-<uuid>
kpi-<uuid>
asset-<uuid>
```

Nu utiliza secvențe de tip `camp-007` în producție dacă pot apărea conflicte la import.

External key:
- immutable în operațiile normale;
- nu se regenerează la editare;
- nu se bazează pe titlu.

### Campaign family / lineage

```text
campaignFamilyExternalKey
supersedesCampaignExternalKey
```

`campaignFamilyExternalKey` grupează definițiile succesive ale aceleiași linii de campanie, dar nu înlocuiește `externalKey`.

Exemplu:

```text
camp-002 / family-camp-002 / strategy-2026-2028
camp-009 / family-camp-002 / strategy-2029-2033
```

Poate exista maximum un Campaign din aceeași family într-o StrategyVersion.

---

# 9. Repository Layer frontend

Arhitectura backend-ready existentă trebuie păstrată conceptual:

```text
UI
 ↓
Repository
 ↓
API
```

## 9.1. Repository-urile necesare

Minimum:

```text
CampaignRepository
ActivationRepository
AnnualPlanRepository
MonitoringRepository
CatalogRepository
StrategyRepository
UserRepository
ImportRepository
AssetRepository
```

## 9.2. React + HTTP asincron

În React NU trebuie reprodus artificial comportamentul sincron al vechilor LocalStorageRepository.

Stratul recomandat:

```text
React Component / Hook
        ↓
Query / Feature service
        ↓
ApiRepository / ApiClient
        ↓
HTTP API
```

Toate mutațiile sunt asincrone.

Exemple conceptuale:

```text
useCampaigns()
useCampaign(externalKey)
useCreateCampaign()
useUpdateCampaign()
useActivations()
useAnnualPlan(year)
```

Numele exacte pot varia.

### Bootstrap

Endpointul:

```text
GET /api/v1/bootstrap
```

rămâne recomandat pentru încărcarea inițială și poate hidrata cache-ul React/query.

Nu este obligatoriu ca API repository să ofere `list()` sincron.

### După mutații

```text
POST/PUT/DELETE
→ server success
→ update/invalidate relevant query cache
→ UI rerender
```

Nu crea un al doilea store permanent cu copii divergente ale datelor serverului.

NU se persistă cache-ul business în `localStorage`.

`localStorage` poate fi folosit numai pentru preferințe UI necritice, de exemplu:
- cards/list view;
- ultimul tab deschis.

---

# 10. Bootstrap API

## 10.1. Endpoint

```http
GET /api/v1/bootstrap
```

Necesită autentificare.

Returnează minimum:

```json
{
  "currentUser": {},
  "catalogs": {},
  "strategicData": {
    "strategyVersion": {},
    "pillars": [],
    "programs": [],
    "objectives": []
  },
  "campaigns": [],
  "activations": [],
  "annualPlans": []
}
```

Nu este obligatoriu să includă întreg istoricul monitoring.

Scop:
- o singură hidratare inițială;
- reutilizarea modelului canonical și a regulilor UI v13.3 în implementarea React;
- evitarea a zeci de request-uri la startup.

După mutații:
- repository-ul actualizează local obiectul cu răspunsul serverului;
- sau face `refresh()`.

---

# 11. Autentificare

## 11.1. Cerințe

Roluri:

```text
ADMIN
EDITOR
VIEWER
```

## 11.2. Endpoints

```http
POST /api/v1/auth/login
POST /api/v1/auth/logout
GET  /api/v1/auth/me
POST /api/v1/auth/change-password
```

## 11.3. Login

Request:

```json
{
  "email": "user@example.ro",
  "password": "..."
}
```

Response:
- utilizator;
- rol;
- `mustChangePassword`.

## 11.4. Token/session

Preferat:
- cookie `HttpOnly`;
- `Secure` în production;
- `SameSite=Lax` sau mai restrictiv;
- tokenul NU se păstrează în `localStorage`.

Implementarea poate folosi session sau token semnat, dar trebuie:
- expirare;
- logout;
- verificare `users.is_active`;
- verificare rol pe server la fiecare endpoint protejat.

## 11.5. Parole

- niciodată plaintext;
- niciodată MD5/SHA simplu;
- hashing modern: Argon2id sau bcrypt cu parametri siguri;
- Admin poate seta parolă temporară;
- `must_change_password=1`;
- utilizatorul este obligat să o schimbe după login.

Nu există forgot-password prin email în v1.

## 11.6. Brute force

Implementați rate limiting minimal pe login.

Exemplu:
- maximum 10 încercări / 15 minute / IP + email;
- configurabil.

## 11.7. Application shell și comportament după login

Există **o singură aplicație React** și **un singur mecanism de autentificare**.

NU se construiesc:
- un frontend public/operațional separat;
- o aplicație Admin separată;
- un al doilea login pentru Admin;
- un design backoffice separat.

Fluxul este:

```text
LOGIN
  ↓
aceeași aplicație React
  ↓
rolul userului determină
ce meniuri și acțiuni sunt vizibile/permise
```

După login, utilizatorul intră implicit în zona operațională, recomandat `Campanii`.

ADMIN nu este redirectat automat în Administrare; Adminul utilizează și funcțiile operaționale ale aplicației.

### Sidebar per rol

ADMIN:

```text
Campanii
Repere strategice
Activări
Plan anual
Monitorizare activări
Monitorizare reputație
────────────────
Administrare
```

EDITOR:

```text
Campanii
Repere strategice
Activări
Plan anual
Monitorizare activări
Monitorizare reputație
```

VIEWER:

```text
Campanii
Repere strategice
Activări
Plan anual
Monitorizare activări
Monitorizare reputație
```

Diferența VIEWER este read-only: nu vede acțiunile Create/Edit/Delete și orice write direct către API este respins.

### Topbar user menu

Topbar-ul trebuie să afișeze:
- nume/inițiale;
- rolul curent într-o formă ușor de înțeles;
- `Schimbă parola`;
- `Deconectare`.

Exemplu:

```text
AB  Ana B.
    Editor
    ─────────
    Schimbă parola
    Deconectare
```

Pentru ADMIN, rolul se afișează `Administrator`.

## 11.8. Admin UX și design system

Zona `Administrare` este **un modul al aceleiași aplicații**, nu un backoffice generic.

Trebuie să utilizeze:
- aceeași sidebar;
- aceeași topbar;
- aceleași culori;
- aceleași fonturi;
- aceleași butoane;
- aceleași tabele;
- aceleași câmpuri/form controls;
- aceleași modale/drawers;
- aceleași spacing/radius/tokens ca prototipul.

Nu este acceptabil ca zona Admin să arate ca:
- phpMyAdmin;
- un template Bootstrap generic;
- o interfață tehnică de DB;
- un produs vizual separat.

Design reference rămâne v13.3.

### 11.8.1. Adăugarea unei înregistrări se face într-un modal

**Regulă.** Fiecare buton din `Administrare` care creează o înregistrare nouă
deschide un **modal peste pagină, cu un singur pas**. Sunt patru:

| buton | listă |
|---|---|
| `＋ Utilizator nou` | Utilizatori |
| `＋ Adaugă` | Nomenclatoare |
| `＋ Versiune nouă` | Versiuni strategice |
| `＋ Adaugă pilon / program / obiectiv` | Repere strategice |

Modalul este cel din v13.3 — `.modal-bg`, `.modal`, `.modal-head`,
`.modal-kicker`, `.modal-body`, `.modal-foot` — același schelet pe care
prototipul îl folosește pentru wizardul de campanie. Aici e varianta cu un
singur pas: fără bara de progres din subsol, fără navigare între etape.

**Un singur pas, nu un wizard.** Un utilizator are patru câmpuri, o valoare de
nomenclator are patru, un reper între patru și treisprezece. Împărțirea lor pe
etape ar adăuga navigare fără să reducă nimic; wizardul de campanie există
fiindcă acolo sunt peste patruzeci de câmpuri grupate pe teme.

**Editarea folosește același modal**, deschis cu datele existente și marcat
`MOD EDITARE` — aceeași etichetă `.form-mode-label` pe care o pune wizardul de
campanie, ca cele două ecrane să spună la fel „schimbi ceva ce există". Titlul
numește înregistrarea: *Editează pilonul – PILLAR_1*.

Înainte, formularul apărea în pagină: la creare *înlocuia* butonul care îl
deschisese — butonul dispărea exact când îl foloseai, lista sărea, iar pe un
nomenclator lung formularul se deschidea deasupra zonei pe care o citeai.

### Câmpul `Cod` în modul editare

Rămâne activ sau nu **după cum e folosită înregistrarea**, nu după modul
formularului. Regula e cea din §4.1 a specificației de administrare a
reperelor, plus condiția de sistem pentru nomenclatoare:

```text
codEditabil = referințeDeBusiness == 0  ȘI  atinsDeImport == false  ȘI  esteSistem == false
```

Când răspunsul e nu, câmpul e **`disabled`**, nu `readonly` — un câmp read-only
păstrează cursorul de text și primește focus, deci arată exact ca unul editabil.
Motivul se scrie sub etichetă, mereu vizibil, fiindcă un câmp dezactivat iese din
ordinea de tabulare și explicația trebuie să se poată citi fără focus:

- *„folosit în 4 campanii, 1 activare"*
- *„adus prin importul din 14.08.2026"*
- *„este o valoare necesară funcționării aplicației"*

Starea vine de la `GET .../usage`, cerut la deschiderea formularului. Nu se
deduce din lista afișată: aceea nu știe dacă un import a scris vreodată
înregistrarea.

**Comportament obligatoriu**, comun cu drawerele:

- `Escape` închide; clic pe fundal închide, dar numai dacă apăsarea *a început*
  pe fundal — altfel selectarea unui text din formular și eliberarea mouse-ului
  în afara lui aruncă ce ai scris;
- pagina din spate nu derulează cât modalul e deschis, și derulează din nou după
  ce se închide;
- focusul intră în modal la deschidere;
- corpul derulează pe dinăuntru, cu antetul și subsolul fixe; formularele care
  își poartă propriile butoane le țin lipite jos.

**Lățime**: `min(720px, 100%)`. `.modal` din prototip e `min(1320px, 100%)`,
lățimea unui wizard cu cuprins lateral; un formular de patru câmpuri întins pe
atât se citește ca un tabel gol.

### 11.8.2. Acțiunile pe rând sunt iconițe, în toate cele trei liste

`Utilizatori`, `Nomenclatoare` și `Strategie` folosesc aceeași bară de acțiuni:
butoane de 32px cu glife Unicode — `✎` editează, `⊘` dezactivează/activează,
`🗑` șterge, `◉` vizualizează unde există fișă. Nu o bibliotecă de icoane: zero
dependențe noi și aceeași greutate vizuală ca restul aplicației.

Un buton care nu poate reuși **rămâne pe poziție, dezactivat**, cu motivul pe el.
Unul care dispare lasă impresia că funcția nu există, iar coloana sare de la un
rând la altul.

Fiecare buton poartă trei atribute, și fiecare are alt rol:

| atribut | ce face | lungime |
|---|---|---|
| `data-tooltip` | bula desenată de `.activation-icon-btn::after`, imediată | scurtă — `white-space: nowrap` |
| `title` | tooltipul nativ, apare mai târziu | aici merge motivul lung |
| `aria-label` | pentru cititorul de ecran, care nu vede niciunul dintre celelalte | descriptiv |

`data-tooltip` nu e opțional: pseudo-elementul se randează oricând, deci un buton
fără el arată la hover un dreptunghi întunecat gol.

---

### 11.8.3. Stadiul campaniei coboară la activările ei

O activare e execuția concretă a unei campanii. O activare rămasă `Activă` sub o
campanie întoarsă în `Draft` spune două lucruri contradictorii despre aceeași
muncă, iar ecranele operaționale le cred pe amândouă: calendarul desenează
activarea ca fiind în desfășurare, în timp ce fișa campaniei spune că nu e încă
aprobată.

| campania devine | activările afectate | devin |
|---|---|---|
| `DRAFT` | cele `ACTIVE` | `DRAFT` |
| `CLOSED` | cele `ACTIVE` | `CLOSED` |
| `ACTIVE` | cele `DRAFT` sau `CLOSED` **a căror perioadă nu s-a încheiat** | `ACTIVE` |

Ultimul rând e cel care are nevoie de dată. Reactivarea unei campanii nu poate
învia o activare a cărei perioadă a trecut — o săptămână din martie nu reîncepe
fiindcă cineva a redeschis campania în august. Revin doar cele care urmează sau
sunt încă în desfășurare. O dată de final lipsă înseamnă activare deschisă, nu
încheiată.

O activare aflată în `DRAFT` **și** deja încheiată rămâne exact cum e. Regula e
„devine activă unde se poate"; unde nu se poate înseamnă neschimbată, nu „îi
alegem alt stadiu".

**Nu e „Situația în calendar" din §27.** Aceea se calculează la afișare din
stadiu plus date și nu se stochează niciodată. Aici se scrie `status_id` — o
decizie luată de un om despre o campanie, propagată la înregistrările care atârnă
de ea, și, ca orice decizie stocată, un instantaneu al momentului în care a fost
luată.

Cascada rulează **în tranzacția campaniei**: ori se mută amândouă, ori niciuna.
`version_number` al fiecărei activări atinse crește, deci cine o avea deschisă
într-un editor primește `409 STALE_VERSION` la salvare — răspunsul corect, fiindcă
înregistrarea chiar s-a schimbat sub el. Fiecare mutare lasă în `audit_log` și
cauza, nu doar efectul.

### Structură Admin recomandată

```text
Administrare
 ├── Utilizatori
 ├── Nomenclatoare
 ├── Importuri
 └── Audit
```

Reperele strategice NU trebuie duplicate complet în Admin. Ecranul `Repere strategice` rămâne comun, iar ADMIN vede acolo acțiuni suplimentare de editare.

### Exemplu Utilizatori

```text
Utilizatori                                  + Utilizator nou

Nume             Email              Rol       Status
──────────────────────────────────────────────────────
Maria Popescu    maria@omd.ro       Editor    Activ
Ion Ionescu      ion@omd.ro         Viewer    Activ
Admin OMD        admin@omd.ro       Admin     Activ
```

### Exemplu Nomenclator

Acțiunile Admin sunt contextuale:
- `Șterge` numai pentru non-system cu 0 referințe;
- `Dezactivează` pentru valori business utilizate;
- badge `Sistem` pentru valori protejate;
- usage count / dependency preview înainte de confirmare.



```text
Publicuri                                      + Adaugă

Code                     Denumire             Activ    Ordine
──────────────────────────────────────────────────────────────
FAMILIES                 Familii              Da       1
ACTIVE_YOUNG             Tineri activi        Da       2
...
```

Adminul nu vede și nu editează tabele SQL direct. Toate operațiile sunt business CRUD prin API.

---

# 12. Permisiuni

Un utilizator are **un singur rol activ** în v1:

```text
ADMIN
EDITOR
VIEWER
```

Nu se implementează în v1 un permission builder granular pe fiecare câmp/modul.

## Matrice roluri

| Funcție | ADMIN | EDITOR | VIEWER |
|---|---:|---:|---:|
| Campanii — read | ✓ | ✓ | ✓ |
| Campanii — create/edit | ✓ | ✓ | — |
| Campanii — soft delete | ✓ | ✓ | — |
| Repere strategice — read | ✓ | ✓ | ✓ |
| Repere strategice — edit | ✓ | — | — |
| Activări — read | ✓ | ✓ | ✓ |
| Activări — create/edit | ✓ | ✓ | — |
| Plan anual — read | ✓ | ✓ | ✓ |
| Plan anual — edit | ✓ | ✓ | — |
| Assets — upload/use | ✓ | ✓ | — |
| Monitoring — read | ✓ | ✓ | ✓ |
| Users / roluri | ✓ | — | — |
| Nomenclatoare — edit | ✓ | — | — |
| Importuri — preview/commit | ✓ | — | — |
| Audit administrativ | ✓ | — | — |
| Restore soft-deleted | ✓ | — | — |

## ADMIN

Este utilizator operațional + administrator.

Poate:
- users CRUD logic;
- roles assignment;
- nomenclatoare activate/deactivate/edit;
- strategie CRUD logic;
- Campaign CRUD;
- Activation CRUD;
- Annual Plan;
- importuri;
- exporturi;
- monitoring;
- audit;
- restore soft-deleted unde UI oferă funcția.

## EDITOR

Este rolul operațional standard pentru persoanele care lucrează efectiv în sistem.

Poate:
- Campaign create/edit;
- Activation create/edit;
- Annual Plan;
- assets;
- vedea monitoring;
- vedea strategie/nomenclatoare.

Nu poate:
- users;
- roluri;
- modifica nomenclatoare;
- modifica strategie;
- importa pachete;
- audit administrativ.

## VIEWER

Read-only pentru modulele operaționale.

Backend-ul este autoritatea.

Ascunderea butoanelor în React este UX, nu securitate.

Exemple obligatorii:
- VIEWER → `POST /campaigns` = 403;
- EDITOR → `PUT /catalogs/...` = 403;
- EDITOR → `POST /imports/commit` = 403;
- ADMIN → operațiile permise = success.

---

# 13. User administration UI

Trebuie adăugat un modul minimal vizibil doar ADMIN.

Recomandat:

```text
Administrare
 ├ Utilizatori
 ├ Nomenclatoare
 ├ Importuri
 └ Audit
```

Nu este necesar un design sofisticat, dar designul trebuie să fie coerent cu aplicația principală. Nu se folosește un template administrativ vizual separat.

## Utilizatori

Listă:
- nume;
- email;
- rol;
- activ/inactiv;
- ultimul login.

Acțiuni:
- creează;
- editează nume;
- schimbă rol;
- activează/dezactivează;
- setează parolă temporară.

Delete fizic user:
- NU este necesar.

---

# 14. Nomenclatoare — UI Admin

Adminul trebuie să poată edita în v1:

- Campaign Types;
- Campaign Statuses;
- Audiences;
- CTAs;
- Products catalog;
- Channels catalog;
- Seasonality Types;
- Activation Channels;
- Implementation Modes;
- Funding Types.

UI generic acceptabil:

```text
[Nomenclator]
Code | Label | Display label | Hint | Activ | Ordine
```

Reguli:
- `code` devine read-only după ce elementul este utilizat;
- label/hint/display order editabile;
- **sensul business al unui code nu se reutilizează**;
- dacă sensul se schimbă, se creează un code nou și vechiul record devine inactiv;
- `is_system` este metadata tehnică read-only;
- non-system + zero referințe → physical delete permis;
- non-system + referințe → delete blocat, deactivate permis;
- system → delete protejat; deactivate protejat dacă workflow-ul depinde de valoare;
- elementele inactive rămân afișabile în istoric;
- elementele inactive nu sunt selectabile în recorduri noi, decât dacă business rule cere explicit.

Această regulă este esențială pentru ca rapoartele istorice să nu își schimbe semnificația după câțiva ani.

---

# 15. Strategie — UI Admin

Ecranul existent „Repere strategice” rămâne modul comun de consultare.

Strategia este **versionată**.

## 15.1. StrategyVersion

Exemplu curent:

```text
strategy-2026-2028
Cadrul strategic OMD Valea Jiului 2026–2028
2026–2028
ACTIVE
```

UI trebuie să afișeze discret versiunea curentă.

Când există o singură versiune, selectorul poate fi minimal. Când apar versiuni istorice, utilizatorul poate consulta o versiune arhivată fără a altera Campaign-urile istorice.

Pentru ADMIN se adaugă:
- vizualizare versiuni;
- creare versiune nouă;
- activare versiune;
- arhivare versiune veche;
- editarea reperelor din versiunea DRAFT/ACTIVE conform regulilor de mai jos.

Nu se șterge o StrategyVersion referită.

## 15.2. Regula critică de istoric

În aceeași `strategy_version`, Admin poate face:
- corecții de text;
- clarificări;
- ordine;
- activare/dezactivare.

Admin **nu trebuie să repurposeze semantic** un cod existent.

Dacă, de exemplu, `OS2` din strategia 2026–2028 are alt sens în strategia 2029–2033:

```text
NU:
update OS2 din versiunea veche cu sensul nou

DA:
create strategy-2029-2033
create OS2 în noua versiune
```

Campaniile istorice rămân legate de obiectivul din versiunea veche.

## 15.3. CRUD repere

Pentru ADMIN:

```text
Editează pilon
Editează program
Editează obiectiv
Adaugă
Dezactivează
```

Reguli:
- `code` este stabil în interiorul versiunii;
- name/label/texte editabile pentru corecții;
- objective relations ale Program editabile;
- `is_active` pentru dezactivare;
- audit obligatoriu;
- dacă elementul este deja referit de Campaign nu se șterge;
- relațiile Program ↔ Objective trebuie să rămână în aceeași StrategyVersion.

## 15.4. Strategy API

Minimum:

```http
GET  /api/v1/strategy/versions
GET  /api/v1/strategy/versions/:externalKey
POST /api/v1/strategy/versions
PUT  /api/v1/strategy/versions/:externalKey
POST /api/v1/strategy/versions/:externalKey/activate
```

ADMIN writes only.

Aplicația poate avea un singur ACTIVE în v1; această regulă este service-level, nu o presupunere structurală imposibil de schimbat.

---

# 16. Standard API

Prefix:

```text
/api/v1
```

Content type:

```text
application/json; charset=utf-8
```

## 16.1. Success response

Poate fi:

```json
{
  "data": {},
  "meta": {}
}
```

Listele sunt paginabile din v1:

Request:

```text
?page=1&pageSize=50
```

Response:

```json
{
  "data": [],
  "meta": {
    "total": 16,
    "page": 1,
    "pageSize": 50,
    "hasMore": false
  }
}
```

Reguli:
- default `pageSize=50`;
- maximum recomandat `pageSize=200`;
- monitoring/history endpoints trebuie să folosească pagination server-side;
- UI nu trebuie să presupună că un list endpoint întoarce toate înregistrările;
- `bootstrap` este o excepție controlată și nu include întreg istoricul monitoring.

## 16.1.1. API compatibility policy

Prefixul `/api/v1` este contract.

În cadrul v1:
- pot fi adăugate câmpuri noi opționale;
- nu se redenumesc/elimină câmpuri existente fără perioadă de compatibilitate;
- semantica unui câmp existent nu se schimbă arbitrar;
- breaking change → `/api/v2` sau adapter de compatibilitate explicit;
- OpenAPI este versionat împreună cu codul.

Frontend-ul React trebuie să ignore câmpurile necunoscute pe care nu le folosește, nu să eșueze la apariția lor.

## 16.2. Error response

Folosește aceeași formă peste tot:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Datele nu sunt valide.",
    "details": [],
    "requestId": "..."
  }
}
```

Statusuri:

```text
400 BAD_REQUEST
401 UNAUTHENTICATED
403 FORBIDDEN
404 NOT_FOUND
409 CONFLICT
413 PAYLOAD_TOO_LARGE
422 VALIDATION_ERROR
500 INTERNAL_ERROR
```

Mesajele 500 nu expun stack trace utilizatorului.

---

# 17. Campaign API

## Endpoints minimum

```http
GET    /api/v1/campaigns
GET    /api/v1/campaigns/:externalKey
POST   /api/v1/campaigns
PUT    /api/v1/campaigns/:externalKey
DELETE /api/v1/campaigns/:externalKey
POST   /api/v1/campaigns/:externalKey/continue
GET    /api/v1/campaigns/:externalKey/lineage
```

Opțional Admin:

```http
POST /api/v1/campaigns/:externalKey/restore
```

## GET list filters

Minimum:

```text
q
type
status
pillar
strategyVersion
campaignFamilyExternalKey
```

În React:
- implicit StrategyVersion = ACTIVE;
- implicit status = DRAFT + ACTIVE;
- strategiile istorice/CLOSED sunt accesibile prin filtre;
- fiecare Campaign afișează badge-ul StrategyVersion;
- lineage poate afișa `Continuă din...` / `Continuată de...`.

Două Campaign-uri cu același titlu din cicluri diferite rămân vizual neambigue.

Dacă frontend-ul filtrează din cache, backend filters pot fi implementate minimal în v1, dar endpoint-ul trebuie să permită extensia.

## DTO

Backend-ul trebuie să poată reconstrui forma canonical utilizată de v13.3.

Fiecare Campaign aparține exact unei `strategy_version`. La import, versiunea vine din `strategicData.strategyVersion`; la creare manuală se folosește implicit versiunea ACTIVE, cu posibilitatea unei selecții explicite dacă UI o cere.

Nu trimite către UI structura brută a celor 10+ tabele relationale.

Mapping:

```text
relational DB
   ↓
CampaignService
   ↓
canonical Campaign DTO
   ↓
ApiCampaignRepository
   ↓
UI
```

## Create

Server:
- validează;
- generează UUID;
- generează external_key;
- rezolvă FK;
- scrie child relations;
- audit;
- returnează canonical Campaign.

## Update

Actualizarea Campaign este atomică.

Child collections ale Campaign editate explicit pot fi reconciliate în aceeași tranzacție.

---


# 17.1. Campaign lifecycle și „Continuă în noul ciclu strategic”

## Regula de bază

```text
1 Campaign = exact 1 StrategyVersion
```

Nu există un Campaign legat simultan la două strategii.

Dacă ideea de campanie continuă:

```text
Campaign vechi
strategy-2026-2028
        ↓ Continue
Campaign nou
strategy-2029-2033
```

## Endpoint

```http
POST /api/v1/campaigns/:externalKey/continue
```

Request:

```json
{
  "targetStrategyVersionExternalKey": "strategy-2029-2033"
}
```

Rezultat:
- externalKey nou;
- aceeași `campaignFamilyExternalKey`;
- `supersedesCampaignExternalKey` = source;
- StrategyVersion = target;
- status = `DRAFT`;
- source Campaign rămâne neschimbată.

## Ce se copiază

Ca punct de pornire:
- titlu și idee creativă;
- mesajele;
- ton/insight/value proposition;
- seasonality;
- audiences/CTA ca selecții inițiale dacă sunt încă active;
- descriptive products/channels;
- storytelling/fixed/adaptable/limits;
- conținut editorial;
- KPI definitions ca draft;
- template definitions.

## Ce NU se copiază ca adevăr strategic

Se resetează și trebuie selectat în noua strategie:
- programPrimary;
- programSecondary;
- objectivePrimary;
- objectiveSecondary;
- parentCampaign dacă parent-ul vechi este în altă StrategyVersion.

`marketingObjective` și `directResult` pot fi preluate ca draft, dar trebuie revizuite înainte de ACTIVE.

## Ce NU se duplică niciodată

- Activations;
- ActivationMaterials;
- AnnualPlan relations;
- monitoring snapshots;
- import history;
- audit history.

## Templates / assets

Template rows noi primesc external keys noi.

Fișierele asset identice pot fi reutilizate prin aceleași `assets.id`/checksum/storage; nu se multiplică binarul fără motiv.

## Activare

Successorul rămâne DRAFT până când relațiile strategice din StrategyVersion țintă sunt completate.

Campaign DRAFT/CLOSED nu oferă implicit `Creează activare`.

## Immutability

- Campaign DRAFT și complet neutilizată poate fi mutată în altă StrategyVersion;
- după ACTIVE sau utilizare în Activation/AnnualPlan, StrategyVersion devine immutable;
- trecerea la alt ciclu se face prin `continue`.

## Parent versus supersedes

```text
parentCampaign
= arhitectura campaniilor în același ciclu strategic

supersedesCampaign
= continuitatea aceleiași linii de campanie între cicluri
```

---

# 18. Optimistic concurrency

Obligatoriu minimum pentru:
- Campaign;
- Activation;
- AnnualPlan.

DB folosește `version_number`.

Recomandare API: HTTP ETag.

Exemplu:

```http
GET /api/v1/campaigns/camp-002
ETag: "7"
```

Update:

```http
PUT /api/v1/campaigns/camp-002
If-Match: "7"
```

SQL conceptual:

```sql
UPDATE campaigns
SET ..., version_number = version_number + 1
WHERE external_key = ?
  AND version_number = 7;
```

Dacă 0 rows:

```http
409 CONFLICT
```

Response:

```json
{
  "error": {
    "code": "STALE_VERSION",
    "message": "Campania a fost modificată de alt utilizator. Reîncarcă datele înainte de salvare."
  }
}
```

Frontend:
- NU suprascrie automat;
- arată mesaj;
- oferă „Reîncarcă”.

---

# 19. Campaign assets / templates

Campaniile conțin template-uri și assets.

Backend trebuie să reconstruiască:
- mockups;
- template-uri;
- canvaUrl;
- asset references.

DB:
- `campaign_templates`;
- `campaign_template_assets`;
- `assets`.

Fișierele fizice nu sunt base64 în DB.

---

# 20. Activation API

Minimum:

```http
GET    /api/v1/activations
GET    /api/v1/activations/:externalKey
POST   /api/v1/activations
PUT    /api/v1/activations/:externalKey
DELETE /api/v1/activations/:externalKey
```

Opțional Admin:

```http
POST /api/v1/activations/:externalKey/restore
```

Filters utile:

```text
q
campaign
status
year
channel
implementationMode
fundingType
```

### Campaign selector pentru Activation

În `Activare nouă`:
- Campaign selector pornește filtrat pe StrategyVersion ACTIVE;
- implicit sunt selectabile doar Campaign ACTIVE;
- label-ul include strategia, de exemplu:

```text
Muntele nu are un singur sezon · Strategia 2029–2033
```

Dacă Activation este pornită din detail-ul unei Campaign:
- Campaign este fixată;
- StrategyVersion este preluată automat;
- userul nu alege din nou cadrul strategic.

Dacă request-ul trimite o StrategyVersion conflictuală cu Campaign, backend-ul respinge request-ul.

Pentru **creare manuală/operațională** prin UI/API:
- Campaign selectată trebuie să aibă status `ACTIVE`;
- Campaign DRAFT/CLOSED nu poate fi folosită pentru o Activation nouă;
- validarea este în backend, nu doar prin filtrarea selectorului React.

Importerul administrativ poate importa date istorice deja produse, inclusiv Activation legată de un Campaign care între timp este CLOSED, dar nu poate modifica StrategyVersion istorică a Campaign.

Activation:
- are `strategy_version_id`;
- dacă este legată de Campaign, versiunea este moștenită automat și trebuie să fie aceeași cu Campaign;
- dacă este independentă, `strategyVersionExternalKey` rezolvă versiunea strategică;
- poate avea `campaign_id=NULL`;
- Activation independentă este validă;
- custom audience este valid;
- materialele/KPI/finanțarea se salvează tranzacțional cu Activation.

---

# 21. Activation audience custom

Frontend trebuie să permită:

```text
audience din nomenclator
SAU
custom label
```

Backend business rule:

```text
exact una:
audience_segment_id
custom_label
```

Exemplul demo:

```text
Public regional și vizitatori de weekend
```

trebuie păstrat fără a crea automat un Audience global.

---

# 22. Activation Material API

Materialele sunt child resources ale Activation.

Poate fi implementat:
- prin update atomic al Activation;
sau
- prin endpoints dedicate.

Dacă se aleg endpoints dedicate:

```http
POST   /api/v1/activations/:activationKey/materials
PUT    /api/v1/activation-materials/:materialKey
DELETE /api/v1/activation-materials/:materialKey
```

Indiferent de variantă:
- material external_key stabil;
- soft delete dacă există monitoring;
- template reference validată;
- own asset suportat;
- material fără imagine suportat.

---

# 23. File upload

## Endpoint

```http
POST /api/v1/assets
Content-Type: multipart/form-data
```

Minimum input:
- file;
- context (`CAMPAIGN_TEMPLATE`, `ACTIVATION_MATERIAL`, etc.).

## Reguli

- whitelist MIME pentru imagini utilizate în aplicație;
- limită mărime configurabilă;
- numele fizic generat de server;
- nu folosi direct filename-ul userului;
- previne `../` path traversal;
- checksum recomandat SHA-256;
- metadata în DB;
- fișierul fizic în storage.

Exemplu storage:

```text
/storage/uploads/2026/08/<uuid>.jpg
```

Frontend primește:

```json
{
  "externalKey": "asset-...",
  "url": "/uploads/2026/08/..."
}
```

## 23.1. Storage abstraction — obligatoriu

Backend-ul trebuie să izoleze filesystem-ul într-o interfață de tip:

```text
AssetStorage
  put()
  exists()
  open/read()
  delete()
  publicUrl()/signedUrl()
```

În v1 implementarea poate fi `LocalFilesystemStorage`.

`assets.storage_path` este tratat ca **storage key opac**, nu ca path absolut hardcodat în business services și nu ca URL public.

Astfel, migrarea viitoare către S3/MinIO/Azure Blob sau alt object storage nu cere rescrierea Campaign/Activation services.

---

# 24. Assets demo: Base64 canonical + bundle fizic

Există intenționat **două reprezentări** ale acelorași 8 campaign assets.

## A. Contractul canonical de acceptance

```text
OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
```

Conține `data:image/...;base64,...`.

Acesta este fișierul principal pentru testarea importerului backend și trebuie suportat obligatoriu.

Importerul backend trebuie:

1. valideze JSON;
2. identifice `data:image/...;base64,...`;
3. decodeze într-un director temporar;
4. valideze fișierul rezultat;
5. calculeze checksum;
6. pregătească `assets` DB;
7. mute fișierul către storage;
8. scrie relațiile;
9. finalizeze tranzacția;
10. curețe temporarele.

Pentru atomicitate practică:

```text
decode → temp
BEGIN DB transaction
DB operations
move temp → final paths
COMMIT
```

La eroare:
- ROLLBACK DB;
- șterge fișierele mutate în această operație;
- cleanup temp.

Un crash poate lăsa fișier orphan.
Implementați un cleanup simplu pentru fișiere temporare/orphan mai vechi de o perioadă configurată.

## B. Bundle fizic suplimentar

```text
04_DEMO_SEEDS/VISUAL_ASSETS_BUNDLE/
├── assets/campaigns/camp-002/*.jpg
├── ASSET_MANIFEST.json
├── ASSET_EXTRACTION_REPORT.md
└── OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1_external_assets.json
```

Acesta conține:
- cele 8 imagini deja extrase;
- SHA-256;
- dimensiuni;
- Campaign → Template → Asset mapping;
- referințele ActivationMaterial;
- o copie JSON în care `src` indică fișiere relative.

### Regula de utilizare

**Nu există două seturi de business data.**

Originalul Base64 și bundle-ul fizic reprezintă aceleași assets, cu aceleași IDs.

Pentru acceptance:
- importă originalul Base64;
- verifică faptul că backend-ul produce 8 fișiere și 8 rows `assets`.

Bundle-ul fizic se folosește pentru:
- comparație;
- dezvoltare;
- verificare vizuală;
- testarea storage-ului;
- troubleshooting.

`OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1_external_assets.json` NU trebuie trimis singur către endpointul standard de import dacă acel endpoint nu primește și folderul/bundle-ul fizic. Căile relative nu sunt accesibile automat serverului după upload-ul unui singur JSON.

Suportul pentru import JSON + folder/ZIP este opțional pentru v1 și nu trebuie introdus doar pentru acest demo.

### Verificare asset bundle

Programatorul trebuie să poată verifica:
- 8 assets fizice;
- checksum conform `ASSET_MANIFEST.json`;
- 12 ActivationMaterials cu `templateAssetId` nenul se rezolvă;
- 0 referințe nerezolvate;
- niciun external key schimbat.

---

# 25. Annual Plan — model funcțional obligatoriu

Acest punct trebuie implementat exact.

## 25.1. Două surse de apartenență

Campaniile pot apărea într-un Plan anual prin:

### A. selecție manuală

```text
annual_plan_campaigns
```

### B. Activation inclusă

```text
annual_plan_activations
```

Campaniile efective:

```text
manual campaign selections
UNION DISTINCT
campaign_id al activărilor incluse
```

Nu copia automat campania în `annual_plan_campaigns`.

## 25.2. Plan creat automat

Dacă Activation:

```text
includeAnnualPlan = true
start = 2026-03-20
end   = 2026-05-15
```

și `annual_plans(2026)` nu există:

```text
create annual_plans(2026)
external_key = "2026"
```

apoi:

```text
annual_plan_activations
2026 ↔ activation
```

Nu produce warning.

## 25.3. Cross-year

Activation:

```text
20.11.2027 → 15.01.2028
```

inclusă în Plan:

```text
annual_plan_activations:
2027 ↔ activation
2028 ↔ activation
```

## 25.4. Editare perioadă

Dacă o Activation nu mai intersectează un an:
- elimină relația veche pentru acel an;
- păstrează recordul `annual_plans`.

## 25.5. Debifare

Dacă `includeAnnualPlan` devine false:
- elimină `annual_plan_activations` ale Activation;
- nu șterge Planul anual;
- nu afectează selecțiile manuale.

---

# 26. Annual Plan API

Minimum:

```http
GET /api/v1/annual-plans
GET /api/v1/annual-plans/:year
PUT /api/v1/annual-plans/:year/campaigns
```

`GET /:year` trebuie să permită reconstruirea ecranului:
- campanii efective;
- activări;
- perioadă;
- status;
- implementare;
- buget;
- finanțare;
- cheltuială;
- calendar.

`PUT /:year/campaigns` modifică doar selecția manuală.

Request:

```json
{
  "selectedCampaignExternalKeys": [
    "camp-002",
    "camp-005"
  ]
}
```

Nu include automat campaniile Activation în această listă.

---

# 27. Derived data

Nu persista ca source of truth:

```text
temporalSituation
fundingTotal
budgetBalance
campaignAnnualTotals
interactions
engagementRate
CTR
CPC
CPM
campaignTitle
```

Pentru v1:
- calculele existente `OMD.services` pot rămâne în frontend pentru afișare;
- backend-ul nu stochează rezultatele;
- dacă backend-ul are nevoie de aceleași valori pentru query/report, implementează formulele într-un service dedicat și testează-le cu aceleași expected values.

Evitați formule duplicate în mai multe module.

---

# 28. Monitoring activări

Model final:

```text
ActivationMaterial
   ↓
material_performance_snapshots
```

NU:

```text
material.apiResults
```

## API

Minimum:

```http
GET /api/v1/monitoring/activations
GET /api/v1/monitoring/materials/:materialExternalKey/history
```

Filters:
- campaign;
- activation;
- channel;
- date/period.

Pentru compatibilitatea dashboardului poate exista:

```http
GET /api/v1/monitoring/activations/latest
```

care întoarce cel mai recent snapshot per material.

`ApiMonitoringRepository` adaptează rezultatul la forma de care are nevoie UI.

## Regula 0 vs NULL

Obligatoriu:

```text
0    = metrică măsurată și valoare zero
NULL = metrică indisponibilă / nesupplied / N/A
```

Nu converti NULL la 0 în DB sau import.

---

# 29. Monitoring reputation

Independent de Campaign/Activation.

Minimum API:

```http
GET /api/v1/monitoring/reputation/latest
GET /api/v1/monitoring/reputation/history
```

Filters:
- scope type;
- scope external key;
- date.

Dashboard-ul trebuie să poată afișa:
- mentions;
- reviews;
- average rating;
- sentiment;
- themes;
- sources.

Nu importa review texts sau date personale în v1.

---

# 30. Import architecture

Importul backend este complet separat de browser-side importer.

## Tipuri

```text
OMD_CAMPAIGNS_PACKAGE
OMD_ACTIVATIONS_PACKAGE
OMD_ACTIVATION_MONITORING_PACKAGE
OMD_REPUTATION_MONITORING_PACKAGE
```

## Endpoints

Recomandat:

```http
POST /api/v1/imports/preview
POST /api/v1/imports/commit
GET  /api/v1/imports
GET  /api/v1/imports/:id
```

ADMIN only.

## 30.0. Contract/schema registry

### Baseline contractual v1.0

**Acest package v6 FINAL stabilește primul baseline contractual oficial pentru `schemaVersion = "1.0"` al celor patru package types.**

Fișierele/prototipurile interne anterioare handoff-ului care au folosit temporar tot stringul `1.0` sunt considerate pre-release și nu definesc obligații de backwards compatibility.

Din momentul acestui handoff:
- forma actuală a celor patru JSON Schema v1.0 se consideră frozen baseline;
- orice schimbare breaking ulterioară necesită o versiune de contract nouă;
- câmpuri opționale pot fi adăugate compatibil numai conform politicii de versionare;
- nu se modifică retrospectiv semantica unui câmp v1.0.

Importerul nu trebuie să aibă un singur parser „hardcoded” care este modificat destructiv când apare o versiune nouă.

Organizare recomandată:

```text
(packageType, schemaVersion)
        ↓
validator
        ↓
transport adapter
        ↓
canonical import DTO
        ↓
application/domain import service
```

Exemplu viitor:

```text
CAMPAIGNS / 1.0 → CampaignsV1Adapter
CAMPAIGNS / 2.0 → CampaignsV2Adapter
```

Când apare v2:
- v1 nu se rescrie în loc;
- v1 poate rămâne reimportabil;
- ambele adaptoare produc același canonical/domain model sau un model evoluat explicit;
- versiunea necunoscută este respinsă cu mesaj controlat.

## 30.1. Preview

`multipart/form-data`:
- JSON file.

Server:
1. citește bytes;
2. calculează SHA-256;
3. parse;
4. identifică `packageType`;
5. alege schema corespunzătoare;
6. JSON Schema validation;
7. business validation;
8. reference validation;
9. calcul create/update/unchanged;
10. warnings;
11. fără DB writes.

Response exemplu:

```json
{
  "data": {
    "packageType": "OMD_CAMPAIGNS_PACKAGE",
    "packageId": "...",
    "schemaVersion": "1.0",
    "checksum": "...",
    "valid": true,
    "summary": {
      "campaigns": {
        "create": 6,
        "update": 0,
        "unchanged": 0
      },
      "masterData": {
        "campaignTypesCreate": 3,
        "campaignStatusesCreate": 3,
        "audiencesCreate": 10,
        "ctasCreate": 9,
        "productsCreate": 12,
        "channelsCreate": 12,
        "seasonalityTypesCreate": 7,
        "activationChannelsCreate": 5,
        "implementationModesCreate": 4,
        "fundingTypesCreate": 5
      },
      "strategy": {
        "pillarsCreate": 4,
        "programsCreate": 8,
        "objectivesCreate": 18
      }
    },
    "warnings": [],
    "errors": []
  }
}
```

## 30.2. Commit

Pentru simplitate și evitarea stării temporare:
- frontend retrimite același fișier;
- trimite `expectedChecksum` primit la preview.

Server:
- recalculează hash;
- dacă diferă → 409;
- revalidează;
- BEGIN;
- creează `import_batch`;
- importă;
- verifică;
- COMMIT;
- completează import batch;
- audit.

Dacă orice operație eșuează:
- ROLLBACK;
- status FAILED/ROLLED_BACK;
- nu rămâne import parțial.

---

# 31. Ordinea importurilor

```text
1. CAMPAIGNS
2. ACTIVATIONS
3. ACTIVATION MONITORING
4. REPUTATION MONITORING
```

Reputation este independent și poate fi importat separat.

Activation Monitoring trebuie să respingă:
- activation inexistentă;
- material inexistent;
- material care nu aparține Activation indicate.

---

# 32. Merge / idempotence

Default production:

```text
MERGE / UPSERT
```

Matching după `external_key`.

Reguli:
- absent → create;
- existent diferit → update;
- identic → unchanged;
- lipsa din package nu înseamnă delete.

Reimportarea aceluiași package:
- nu produce duplicate;
- trebuie să fie idempotentă.

Monitoring:
- externalKey nou = snapshot nou;
- același externalKey = update/controlat al aceluiași snapshot;
- nu șterge istoricul altor perioade.

---

# 33. Master data + strategie la import Campaigns

`OMD_CAMPAIGNS_PACKAGE` este și mecanismul de **initial business bootstrap**.

Conține simultan:

```text
strategicData
  strategyVersion
  pillars
  programs
  objectives

catalogs
  campaignTypes
  campaignStatuses
  audiences
  ctas
  products
  channels
  seasonalityTypes
  activationChannels
  implementationModes
  fundingTypes

campaigns
  campaigns
  templates
  assets
```

## 33.1. Cerință obligatorie: populare fără introducere manuală

Atât STAGING, cât și PRODUCTION trebuie să poată porni de la:

```text
DB cu schema/migrations
+ roles/users tehnice
+ ZERO date business
```

și să ajungă la o aplicație utilizabilă prin import de package-uri JSON, fără introducere manuală a:
- publicurilor;
- programelor;
- obiectivelor;
- pilonilor;
- statusurilor;
- tipurilor de campanie;
- canalelor;
- produselor;
- CTA-urilor;
- sezonalității;
- modurilor de implementare;
- tipurilor de finanțare;
- campaniilor.

Aceasta este o cerință funcțională, nu doar un efect al DEMO_SEED.

## 33.2. Staging bootstrap

```text
omd_vj_staging — DB business goală
      ↓
OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
      ↓
strategyVersion + strategy + catalogs + campaigns + assets
      ↓
OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json
      ↓
activations + materials + plan
      ↓
monitoring packages
```

Staging poate fi resetat și repopulat pentru testare.

Utilizatorii pot modifica datele demo din UI fără impact asupra production.

## 33.3. Production initial import

Production NU se obține prin „curățarea” staging-ului.

Se pornește cu o bază production separată și goală ca date business:

```text
omd_vj_production
      ↓
OMD_CAMPAIGNS_PACKAGE_REAL_INITIAL_v1.json
purpose = INITIAL_IMPORT
      ↓
catalogs reale
strategyVersion reală
strategy reală
campaigns reale
assets reale
```

Numele concret al fișierului poate varia; contractul rămâne `OMD_CAMPAIGNS_PACKAGE` / schemaVersion `1.0`.

După importul inițial:
- master data trăiește în DB;
- strategy trăiește în DB;
- Admin o poate edita din UI;
- Campaigns sunt operaționale;
- Activations pot fi create direct de OMD.

## 33.4. Semantica pe DB goală

Dacă nu există încă business master data:

```text
strategyVersion absent
→ CREATE StrategyVersion (ACTIVE dacă este prima)

code absent în acea strategyVersion
→ CREATE strategic record
```

Se creează toate elementele din `strategicData` și `catalogs` necesare package-ului.

Nu este necesară introducerea manuală înainte de import.

## 33.4.0. Campaign family / lineage la import

Fiecare Campaign Package v1 are:

```text
campaignFamilyExternalKey
supersedesCampaignExternalKey
```

Validare:
- family obligatorie;
- maximum un Campaign/family/StrategyVersion;
- predecessorul, dacă există, trebuie să fie rezolvabil;
- predecessorul trebuie să aibă aceeași family;
- self-reference și lineage cycle sunt invalide;
- importul nu mută predecessorul pe strategia nouă.

Un package real viitor poate aduce direct succesorii unei campanii în noua StrategyVersion.

## 33.4.1. Strategie nouă / schimbarea orizontului

Dacă un package viitor conține:

```text
strategyVersion.externalKey = strategy-2029-2033
```

importerul:
1. NU modifică obiectivele 2026–2028 ca să le transforme în cele noi;
2. creează/actualizează repere în noua StrategyVersion;
3. lasă versiunea nouă DRAFT dacă există deja o versiune ACTIVE, până la activare explicită de Admin;
4. noile Campaign din package se leagă de noua versiune;
5. Campaign istorice rămân pe vechea versiune.

## 33.5. Semantica după bootstrap

DB deja utilizată:

```text
code existent
→ folosește recordul DB
```

Dacă package label diferă de DB:

```text
warning în Preview
NU overwrite implicit
```

Exemplu:

```text
DB:
ACTIVE_YOUNG
"Tineri activi / outdoor"

Package:
ACTIVE_YOUNG
"Tineri activi"
```

Rezultat:
- Campaign poate utiliza `ACTIVE_YOUNG`;
- Preview semnalează diferența;
- label-ul Admin rămâne `Tineri activi / outdoor`.

Admin changes nu se pierd prin import ulterior.

## 33.6. Coduri noi în package

Dacă package-ul conține un code care nu există în DB:

```text
nou code
→ Preview: CREATE
→ Commit: CREATE
```

Nu cere Adminului să creeze manual nomenclatorul înainte.

Business validation trebuie totuși să confirme că:
- structura este validă;
- code-ul este permis de contract;
- referințele Campaign sunt coerente.

## 33.7. Import UI — vizibilitate explicită

`Administrare → Importuri` trebuie să arate separat impactul asupra:

```text
Strategie
Nomenclatoare
Campanii
Assets
Activări
Monitoring
```

Pentru Campaign Package, Preview trebuie să poată afișa de exemplu:

```text
Strategie
  Piloni:      +4 / ~0
  Programe:    +8 / ~0
  Obiective:  +18 / ~0

Nomenclatoare
  Publicuri:              +10
  CTA-uri:                 +9
  Produse:                +12
  Canale:                 +12
  ...

Campanii
  Create: 6
  Update: 0
```

Astfel utilizatorul înțelege că importul poate popula și configura baza, nu doar campaniile.

---

# 34. Export

Pentru data portability, backend-ul trebuie proiectat să poată reconstrui contractele JSON.

Minimum recomandat:

```http
GET /api/v1/exports/campaigns
GET /api/v1/exports/activations
GET /api/v1/exports/activation-monitoring
GET /api/v1/exports/reputation-monitoring
```

Dacă termenul obligă la prioritizare:
- importurile sunt obligatorii;
- exporturile monitoring pot fi implementate după core CRUD, dar înainte de recepție dacă funcția este vizibilă în UI.

Exportul nu trebuie să expună:
- password hashes;
- internal UUID fără nevoie;
- audit intern;
- secrete;
- filesystem paths interne.

---

# 35. Audit

Backend-ul scrie `audit_log` pentru minimum:

```text
LOGIN relevant administrativ (opțional în audit business)
CREATE
UPDATE
SOFT_DELETE
RESTORE
IMPORT
MASTER_DATA_CHANGE
STRATEGY_CHANGE
USER_CHANGE
```

Pentru CREATE/UPDATE/DELETE business:
- user;
- entity;
- external key;
- old/new values relevante;
- timestamp;
- source MANUAL/IMPORT/SYSTEM;
- import batch dacă este cazul.

Nu loga parole sau tokenuri.

Admin UI audit minimal:
- dată;
- user;
- acțiune;
- entitate;
- external key;
- source.

Detail poate afișa diff JSON.

---


# 35.1. Deletion & Referential Integrity Policy

Această secțiune are prioritate față de formulările generice de tip „soft delete”.

## 35.1.1. Flux obligatoriu

```text
React
→ API
→ Authorization
→ DependencyService
→ DeletionPolicy
→ Transaction
→ Repository
→ DB
```

React poate cere un preview, dar backend-ul repetă obligatoriu dependency check-ul în momentul DELETE.

## 35.1.2. Error contract

Pentru entitate utilizată:

```http
409 Conflict
```

```json
{
  "error": {
    "code": "ENTITY_IN_USE",
    "message": "Elementul nu poate fi șters deoarece este utilizat în sistem.",
    "details": {
      "entityType": "AUDIENCE_SEGMENT",
      "externalKey": "FAMILIES",
      "dependencies": [
        { "type": "CAMPAIGN", "count": 12 },
        { "type": "ACTIVATION", "count": 3 }
      ],
      "allowedAction": "DEACTIVATE"
    }
  }
}
```

Pentru valoare system:

```http
409 Conflict
```

```json
{
  "error": {
    "code": "SYSTEM_VALUE_PROTECTED",
    "message": "Valoarea este necesară funcționării aplicației și nu poate fi ștearsă."
  }
}
```

Alte coduri utile:
- `DELETE_NOT_ALLOWED`;
- `HISTORICAL_DATA_PROTECTED`;
- `ASSET_IN_USE`.

## 35.1.3. Dependency preview

Minimum:

```http
GET /api/v1/admin/catalogs/:catalog/:code/usage
GET /api/v1/campaigns/:externalKey/dependencies
GET /api/v1/activations/:externalKey/dependencies
GET /api/v1/assets/:externalKey/dependencies
```

Response:

```json
{
  "data": {
    "canDelete": false,
    "canDeactivate": true,
    "isSystem": false,
    "dependencies": [
      { "type": "CAMPAIGN", "count": 12 }
    ]
  }
}
```

Preview-ul este informativ. DELETE repetă check-ul pentru a evita race conditions.

### Ce înseamnă „referință”

Dependency count include **toate rândurile fizice care păstrează referința**, inclusiv:
- entități ACTIVE;
- entități CLOSED;
- entități soft-deleted care pot fi restaurate;
- relații istorice;
- date care nu mai apar în lista UI implicită.

Nu se face dependency query doar cu `deleted_at IS NULL`.

Dacă o relație este un owned technical child fără valoare istorică și policy permite curățarea ei, aceasta trebuie eliminată explicit și tranzacțional înainte de delete-ul părintelui; nu se ignoră la calcul doar pentru că nu este vizibilă în UI.

## 35.1.4. Matrice obligatorie

| Situație | Delete fizic | Soft delete | Deactivate / Close | Rezultat |
|---|---:|---:|---:|---|
| Master non-system, 0 referințe | DA | — | DA | confirmare |
| Master non-system, >0 referințe | NU | NU | DA | `409 ENTITY_IN_USE` |
| Master system | NU | NU | numai dacă business rule permite | `409 SYSTEM_VALUE_PROTECTED` |
| Pillar/Program/Objective neutilizat | DA | — | DA | dependency check |
| Pillar/Program/Objective utilizat | NU | NU | DA | `409 ENTITY_IN_USE` |
| StrategyVersion DRAFT neutilizată | DA, ADMIN | — | — | dependency check |
| StrategyVersion referită | NU | NU | ARCHIVE | `409 ENTITY_IN_USE` |
| Campaign DRAFT accidentală, neutilizată | NU din UI | DA | — | confirmare |
| Campaign cu Activation/Plan/child/successor/history | NU | NU | `CLOSED` | `409 ENTITY_IN_USE` |
| Campaign terminată normal | NU | NU | `CLOSED` | nu se folosește Delete |
| Activation DRAFT fără istoric protejat | NU | DA | — | transactional cleanup |
| Activation cu Plan/monitoring/history | NU | NU | `CLOSED` | `409 ENTITY_IN_USE` |
| ActivationMaterial fără monitoring | NU | DA | — | confirmare |
| ActivationMaterial cu snapshots | NU | DA/Hide cu snapshots păstrate | — | history preserved |
| Asset neutilizat | DA coordonat DB+storage | opțional | — | confirmare |
| Asset utilizat | NU | eventual inactive/soft delete | — | `409 ASSET_IN_USE` |
| Monitoring snapshot | NU | NU | — | append-only |
| AnnualPlan | NU arbitrar | NU | edit relations | service rules |

## 35.1.5. `is_system`

Cele 10 tabele master editabile au:

```text
is_system TINYINT(1) NOT NULL DEFAULT 0
```

Reguli:
- nu vine din business JSON;
- nu este editabil de Admin;
- importerul nu are voie să accepte/trusteze un `is_system` din payload;
- backend/migration/protected-code registry îl controlează.

### `SystemMasterRegistry` — comportament obligatoriu

Implementarea trebuie să aibă o singură sursă tehnică pentru codurile protejate, de exemplu conceptual:

```text
campaign_statuses:
  DRAFT
  ACTIVE
  CLOSED
```

La CREATE/UPSERT de master data:

```text
is_system = SystemMasterRegistry.contains(catalog, code)
```

Astfel, la primul Campaign bootstrap pe o DB business goală:
- `DRAFT` este creat cu `is_system=1`;
- `ACTIVE` este creat cu `is_system=1`;
- `CLOSED` este creat cu `is_system=1`.

La startup/migration trebuie să existe și un backfill/idempotent check care corectează aceste protected codes la `is_system=1` dacă DB provine dintr-o etapă intermediară.

Importerul nu decide protecția după label și nu poate retrograda un protected code la `is_system=0`.

Minimum v1:

```text
DRAFT  → system
ACTIVE → system
CLOSED → system
```

Admin UI poate afișa badge `Sistem`.

## 35.1.6. Delete master data

```http
DELETE /api/v1/admin/catalogs/:catalog/:code
```

Backend:

```text
load
→ if is_system: 409 SYSTEM_VALUE_PROTECTED
→ count all references
→ if references > 0: 409 ENTITY_IN_USE
→ physical DELETE
→ audit
```

Nu există cascade care să elimine automat valoarea din Campaign/Activation.

## 35.1.7. Deactivate master data

```http
POST /api/v1/admin/catalogs/:catalog/:code/deactivate
```

Pentru o valoare utilizată, UI:

> „Valoarea este utilizată în 12 campanii și 3 activări. Dezactivarea păstrează datele existente, dar valoarea nu va mai putea fi selectată în înregistrări noi.”

## 35.1.8. Campaign

Delete eligibility verifică minimum:
- Activations;
- AnnualPlan;
- child Campaigns;
- successor Campaigns;
- istoric dependent.

Mesaj UI:

> „Campania nu poate fi ștearsă deoarece are 8 activări și este inclusă în 2 planuri anuale. Dacă activitatea campaniei s-a încheiat, schimbă statusul în «Încheiată».”

Campaign DRAFT neutilizată → soft delete.

Campaign terminată → `CLOSED`, nu deleted.

## 35.1.9. Activation

Activation accidentală/DRAFT:
- verifică AnnualPlan și monitoring;
- dacă este eligibilă → soft delete;
- owned children fără istoric pot fi curățate în aceeași tranzacție.

Activation cu istoric → delete blocat, folosește `CLOSED`.

## 35.1.10. Assets

Înainte de `AssetStorage.delete()`:
1. usage check;
2. DB transaction/state change;
3. storage delete;
4. rollback/compensation la eroare.

Asset referit nu este șters fizic.

## 35.1.11. Race conditions / FK

- dependency preview poate deveni stale;
- DELETE repetă dependency check;
- FK `RESTRICT` rămâne safety net;
- conflict FK neașteptat se convertește în `409 ENTITY_IN_USE`, nu 500 generic.

## 35.1.12. Staging cleanup

Se livrează un command operațional:

```text
reset-staging-business-data
```

Condiții:
- rulează numai cu `APP_ENV=staging`;
- golește controlat datele business de test;
- păstrează schema/migrations/structura tehnică necesară;
- permite reimportul celor 4 DEMO_SEED;
- refuză execuția în production.

NU se expune endpoint production `reset all`.

---

# 36. Soft delete

Această secțiune NU acordă drept generic de ștergere; se aplică exclusiv după regulile din **35.1 Deletion & Referential Integrity Policy**.

Campaign:
- soft delete numai dacă `DeletionPolicy` declară Campaign eligibilă;
- dacă există istoric/dependențe, delete este blocat și finalizarea normală se face prin `CLOSED`.

Activation:
- soft delete numai dacă este eligibilă conform dependency checks;
- Activation cu istoric se închide prin `CLOSED`.

ActivationMaterial:
- soft delete conform policy;
- dacă are monitoring, snapshots rămân obligatoriu intacte.

Status `CLOSED`:
- NU este delete.

Frontend:
- entitățile soft-deleted nu apar implicit în liste;
- Admin poate avea filtru „Șterse” / Restore dacă încape în v1.

Nu folosi cascade delete pe istoricul monitoring.

---

# 37. Error handling în UI

Trebuie adăugate stări explicite:

```text
loading
success
validation error
network error
permission error
concurrency conflict
```

Nu lăsa butonul Save să pară că a reușit dacă API a eșuat.

La save:
- disable temporar butonul;
- indicator „Se salvează…”;
- succes → închide/refresh;
- eroare → păstrează formularul și datele introduse.

La 401:
- redirect login.

La 403:
- mesaj „Nu ai drepturi pentru această operație.”

La 409 concurrency:
- mesaj specific și opțiune refresh.

---

# 38. Securitate minimă obligatorie

## 38.1. HTTP

Production:
- HTTPS obligatoriu.

## 38.2. SQL

- prepared statements / ORM parametrizat;
- niciun SQL construit prin concatenare directă cu input user.

## 38.3. XSS

Tot conținutul user/import afișat în HTML trebuie escapе-uit.

Păstrează helper-ele de escaping existente sau echivalent.

## 38.4. JSON import

Respinge recursiv chei periculoase:

```text
__proto__
prototype
constructor
```

Nu utiliza:
- `eval`;
- dynamic code execution.

## 38.5. Upload

- MIME whitelist;
- extensie controlată;
- size limit;
- filename server-side;
- path traversal impossible.

## 38.6. CSRF / Origin

Pentru cookie auth:
- SameSite cookie;
- verificare Origin/CSRF pentru mutații conform framework-ului ales.

## 38.7. Secrets

- numai environment;
- niciodată în frontend bundle;
- niciodată în Git.

---

# 39. Logging și observabilitate

Minimum server logs:
- timestamp;
- level;
- request ID;
- method;
- route;
- status;
- duration;
- authenticated user ID/external reference unde este sigur;
- errors.

Nu loga:
- password;
- auth token;
- întreg JSON cu date sensibile dacă nu este necesar.

Endpoint:

```http
GET /api/v1/health
```

Response minim:

```json
{
  "status": "ok"
}
```

Opțional:
- DB connectivity separat în `/health/ready`.

---

# 40. Backup și restore

Înainte de production go-live trebuie documentat:

## MySQL

- backup automat zilnic;
- retenție stabilită cu beneficiarul;
- backup înainte de migrations importante.

## Uploads

- backup al folderului uploads;
- sincron cu politica DB.

## Restore test

Cel puțin o dată înainte de recepție:
- restore DB staging din backup;
- restore uploads;
- aplicația pornește;
- assets se afișează.

---

# 41. Deploy

Programatorul trebuie să livreze instrucțiuni exacte pentru serverul beneficiarului.

Minimum:

```text
1. prerequisites
2. clone/copy application
3. environment configuration
4. create DB
5. run migrations
6. create initial Admin
7. configure upload permissions
8. configure web server/reverse proxy
9. start backend
10. health check
11. staging seed
12. production initialization
```

Dacă se folosește Node:
- process manager/service system.

Dacă se folosește PHP:
- FPM/webserver configuration.

Nu presupune că programatorul va avea acces root permanent; documentează ce trebuie făcut de administratorul serverului.

---

# 42. UI routes obligatorii

Rutele funcționale existente trebuie păstrate semantic:

```text
#campaigns
#strategic
#activations
#annual
#monitoring-activations
#monitoring-reputation
#about
```

Nou, dacă este necesar:

```text
#admin
```

În React este preferabil routing client-side cu URL-uri reale sau hash routing, în funcție de infrastructură.

Dacă se folosesc rute de tip `/campaigns`, `/activations`, etc., web serverul trebuie configurat cu SPA fallback către `index.html`, astfel încât refresh-ul direct să nu producă 404.

Nu este obligatoriu să se păstreze hash routing-ul prototipului, dar navigarea și deep-linking-ul trebuie să funcționeze.

---

# 43. Staging seed procedure

Trebuie să existe o procedură documentată, ideal CLI:

```text
reset staging business data
run migrations
create/ensure technical roles + admin
confirm business tables are empty
```

Apoi prin UI sau API:

```text
1. OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
2. OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json
3. OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
4. OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
```

Nu crea un endpoint public `reset production`.

Staging reset trebuie blocat sau absent în production.

---

# 43.1. Teste specifice frontend React

Pe lângă E2E, trebuie testate minimum:

- render route principal fără runtime errors;
- loading state;
- API error state;
- permission-based rendering;
- form submit success/error;
- 409 stale-version UI;
- query/cache invalidation după create/update/delete;
- direct URL refresh pe rute;
- escaping al datelor importate;
- unmount/remount fără pierderea datelor server-side.

Nu este necesară acoperire procentuală artificială mare; testele trebuie concentrate pe fluxurile critice.

---

# 44. TEST STRATEGY — obligatoriu

Testarea nu se limitează la „pagina se deschide”.

Trebuie implementate minimum 5 nivele:

```text
A. contract tests
B. unit tests
C. DB/integration tests
D. API tests
E. browser E2E / UAT tests
```

---

# 45. A. Contract tests — JSON

Pentru fiecare pereche:

```text
SCHEMA
DEMO_SEED
```

test:

```text
validate → 0 errors
```

Obligatoriu:

1. Campaigns schema + seed PASS;
2. Activations schema + seed PASS;
3. Activation Monitoring schema + seed PASS;
4. Reputation Monitoring schema + seed PASS.

Folosește JSON Schema Draft 2020-12 validator.

Test negativ:
- schemaVersion 2.0 → reject;
- packageType greșit → reject;
- additional unknown top-level property → reject conform schema.

---

# 46. B. Unit tests — business rules

Minimum:

## Date / temporal

- overlap year;
- cross-year;
- activation outside year;
- temporal situation.

## Funding

```text
fundingTotal = SUM funding sources
budgetBalance = budget - funding/spend conform formula existentă
```

## Monitoring

- interactions;
- engagement rate;
- CTR;
- CPC;
- CPM;
- divide-by-zero;
- NULL metrics.

## Deletion policy

- master non-system + 0 refs → physical delete;
- master non-system + refs → `ENTITY_IN_USE`;
- master system → `SYSTEM_VALUE_PROTECTED`;
- deactivate referenced master → success, historical resolution preserved;
- Campaign unused DRAFT → soft delete;
- Campaign with Activation/AnnualPlan/child/successor → blocked;
- Campaign CLOSED is not deleted;
- Activation DRAFT with no protected history → soft delete;
- Activation with monitoring/plan → blocked;
- stale dependency preview cannot bypass DELETE re-check;
- FK race → controlled 409.

## Campaign lineage

- new Campaign → family key stabilă, supersedes NULL;
- continue → externalKey nou;
- continue → aceeași family;
- continue → predecessor setat;
- continue → target StrategyVersion;
- source neschimbat;
- un singur family member per StrategyVersion;
- lineage cycle respins;
- relațiile program/objectiv vechi nu se copiază cross-strategy;
- Activations/AnnualPlan/Monitoring nu se duplică;
- assets fizice pot fi reutilizate;
- Activation derivată moștenește StrategyVersion.

## Annual Plan

- include=true → year relation;
- include=false → no relation;
- cross-year → 2 relations;
- date change → obsolete relation removed;
- manual campaign + automatic campaign → DISTINCT once.

## Catalog / strategy bootstrap import

- empty DB + Campaign Package → StrategyVersion created;
- empty DB + Campaign Package → all catalogs created;
- empty DB + Campaign Package → pillars/programs/objectives created in that StrategyVersion;
- same strategic code can exist in two different StrategyVersions;
- Campaign remains bound to its original StrategyVersion after a newer one is activated;
- semantic strategy change is represented by new StrategyVersion, not overwrite;
- same code + same label → unchanged;
- same code + different label → warning;
- Admin label is not overwritten;
- new valid code in package → preview CREATE + commit CREATE;
- reimport same package → idempotent;
- strategy/catalog bootstrap does not require manual pre-seeding.

---

# 47. C. Database integration tests

Rulează împotriva unei baze MySQL de test, nu mock.

Minimum:

1. fresh migrations PASS;
2. all FK created;
3. duplicate external_key rejected;
4. campaign parent FK valid;
5. independent Activation with campaign_id NULL accepted;
6. custom audience accepted;
7. invalid audience state (both standard + custom) rejected by service/check;
8. money DECIMAL round-trip;
9. monitoring NULL remains NULL;
10. monitoring 0 remains 0;
11. soft delete does not remove monitoring;
12. AnnualPlan year UNIQUE;
13. annual plan effective VIEW returns DISTINCT;
14. optimistic version update succeeds once;
15. stale version update fails;
16. audit record is written;
17. import rollback leaves no partial business rows.
18. empty business DB + Campaign Package creates all expected strategic/master rows.
19. reimport after Admin label edit preserves DB label and returns warning.
20. new master code from a valid package is created transactionally.
21. `strategy_versions` permits same objective/program code in different versions and rejects duplicate code inside same version.
22. Campaign/Activation strategy_version FK is valid and consistent.
23. import_batch accepts Campaign/Activation purposes `INITIAL_IMPORT` and `UPDATE`.
24. import_batch accepts Monitoring purposes `BASELINE` and `QUARTERLY_IMPORT`.
25. same campaign family can exist in different StrategyVersions.
26. duplicate `(campaign_family_external_key, strategy_version_id)` is rejected.
27. self supersede is rejected.
28. predecessor with different family is rejected by service.
29. lineage cycle is rejected.
30. StrategyVersion mutation of used Campaign is rejected.
31. all 10 editable master tables have valid `is_system IN (0,1)`.
32. unreferenced non-system master physical delete succeeds.
33. referenced master delete is blocked and FK remains safety net.
34. protected system master cannot be deleted.
35. no destructive cascade is introduced on core historical relations.

---

# 48. D. API tests

## Auth

1. valid login → 200;
2. invalid password → 401;
3. disabled user → 401/403;
4. VIEWER POST Campaign → 403;
5. EDITOR Campaign save → success;
6. EDITOR users endpoint write → 403;
7. ADMIN master data write → success;
8. must-change-password flow.

## Campaign

1. list;
2. get;
3. create;
4. update;
5. soft delete;
6. get deleted default hidden;
7. stale If-Match → 409.

## Activation

1. create linked;
2. create independent;
3. custom audience;
4. material with template asset;
5. material own upload;
6. material without image;
7. KPI;
8. funding;
9. annual inclusion sync.

## Imports

1. preview valid;
2. preview invalid → 0 writes;
3. checksum mismatch commit → 409;
4. commit success;
5. repeat commit → no duplicates;
6. invalid cross-reference → rollback;
7. master label conflict warning;
8. assets cleanup on failed import;
9. empty business DB Campaign preview reports strategy/catalog creates;
10. Campaign commit bootstraps strategy/catalogs without manual pre-seeding;
11. Admin-edited label + reimport → warning + DB value preserved;
12. new valid master code → preview create + commit create.
13. list endpoint pagination returns `total/page/pageSize/hasMore`;
14. `pageSize` above configured maximum is rejected/clamped consistently;
15. StrategyVersion create/activate is ADMIN-only.
16. `POST /campaigns/:key/continue` creates DRAFT successor with same family.
17. continue does not duplicate Activation/AnnualPlan/Monitoring.
18. Viewer continue → 403.
19. duplicate continuation into same StrategyVersion → 409/422.
20. Activation request with Campaign + conflicting StrategyVersion → reject.
21. catalog usage endpoint returns dependency counts.
22. referenced catalog DELETE → 409 `ENTITY_IN_USE`.
23. protected status DELETE → 409 `SYSTEM_VALUE_PROTECTED`.
24. unreferenced non-system catalog DELETE → success.
25. Campaign with Activation DELETE → 409 + suggestion CLOSED.
26. eligible DRAFT Campaign delete → soft delete.
27. Activation with monitoring DELETE → 409.
28. DELETE repeats dependency check after preview.
29. bootstrap of DRAFT/ACTIVE/CLOSED persists `is_system=1`.
30. master usage endpoint counts references from soft-deleted/restorable rows.
31. manual Activation create with DRAFT/CLOSED Campaign → controlled validation error.
32. historical import may reference a Campaign now CLOSED without changing historical StrategyVersion.

---

# 49. E. End-to-end seed acceptance test

Acesta este testul principal înainte de UAT.

## Step 1 — DB goală

După migrations:
- 0 Campaign;
- 0 Activation;
- 0 monitoring business;
- only technical users/roles.

## Step 2 — Campaign import

Import:

```text
OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
```

Expected:

```text
Campaigns: 6
Campaign templates: 15
Visual assets: 8

Strategy versions: 1
Strategic pillars: 4
Strategic programs: 8
Strategic objectives: 18

Catalogs:
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
```

Niciuna dintre aceste date business nu trebuie introdusă manual înainte de import.

Assets base64:
- decode to files;
- DB must not contain base64 blob;
- 8 asset files exist physically.

## Step 3 — Activation import

Import:

```text
OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json
```

Expected:

```text
Activations: 16
Materials: 42

annualPlans explicit in JSON: 2
annual_plans in DB after materialization: 3
years: 2026, 2027, 2028

manual annual_plan_campaigns: 5

annual_plan_activations total: 16
2026: 10
2027: 5
2028: 1
```

Nu există warning „2026 plan missing”.

Custom audience:
- „Public regional și vizitatori de weekend”
- preserved.

## Step 4 — Activation monitoring

Import:

```text
OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
```

Expected:

```text
performance snapshots: 34
```

Representative golden record:

```text
material: demo-brand-ig-1
impressions: 17721
reach: 5399
clicks: 217
spend: 412
```

## Step 5 — Reputation

Import:

```text
OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json
```

Expected latest:

```text
mentions: 1284
reviews: 214
average rating: 4.42
positive: 67%
```

Themes:
- 4.

Sources:
- 4.

---

# 49.1. Golden bootstrap test — master data și strategie

Acest test validează fluxul dorit pentru tranziția DEMO → REAL.

## A. Bootstrap din DB business goală

1. pornește cu DB business goală;
2. importă Campaign DEMO_SEED;
3. verifică toate counts de strategie și catalogs;
4. deschide în React:
   - Campaign create/edit;
   - Audience selectors;
   - Channel selectors;
   - Strategy page;
5. confirmă că toate opțiunile provin din DB/API.

PASS numai dacă nu a fost necesară nicio introducere manuală de master data.

## B. Protejarea modificărilor Admin

1. Admin schimbă în staging label-ul unui Audience existent;
2. reimportă același Campaign Package;
3. Preview trebuie să raporteze conflict/warning de label;
4. Commit nu suprascrie label-ul Admin;
5. Campaign references continuă să se rezolve după `code`.

## C. Code nou

1. creează o copie de test validă a Campaign Package cu un catalog code nou;
2. Preview îl marchează CREATE;
3. Commit îl creează;
4. selectorul React îl vede după refresh/invalidation.

---

# 50. Golden UI test — Plan anual 2026

Acesta este un acceptance test obligatoriu, deoarece validează simultan:
- Activation import;
- AnnualPlan materialization;
- manual/automatic campaign logic;
- budgets;
- actual spend;
- derived execution.

În:

```text
Plan anual → Anul 2026 → Plan operațional
```

trebuie să apară:

```text
Campanii selectate/effective: 6
Activări în plan: 10
Buget planificat: 177.500 lei
Finanțare identificată: 0 lei
Cheltuială efectivă: 123.400 lei
Execuție bugetară: 69,5%
```

Toleranță de afișare:
- separator mii poate varia conform formatterului;
- procentul trebuie rotunjit la o zecimală ca în prototip.

Valoare matematică:

```text
123400 / 177500 * 100
= 69.5211...
→ UI 69,5%
```

Cele 10 activări din 2026 trebuie să aparțină la 6 Campaign DISTINCT.

---

# 51. Golden UI test — Campaign

Campaign:

```text
externalKey = camp-002
```

Titlu obligatoriu:

```text
Muntele nu are un singur sezon
```

Verifică:
- listă;
- preview;
- detail;
- strategic links;
- template visuals;
- create Activation from Campaign.

---

# 52. Golden UI test — assets

Expected:

```text
8 campaign asset files
```

și minimum:

```text
12 Activation materials
```

trebuie să rezolve vizualul:
- propriu;
sau
- prin template asset.

Nu este acceptabil ca după mutarea la backend toate imaginile să dispară.

---

# 53. Golden UI test — monitoring

## Activation monitoring

Dashboard trebuie să găsească 34 materiale/snapshot-uri relevante conform filtrelor.

Verifică explicit:

```text
demo-brand-ig-1
17721 impressions
5399 reach
217 clicks
412 RON spend
```

## Reputation

Dashboard:

```text
1.284 mențiuni
214 review-uri
4,42 rating
67% pozitiv
```

---

# 54. UI regression test per modul

Compară live staging cu prototipul v13.3.

Minimum routes:

1. Campanii;
2. Repere strategice;
3. Activări;
4. Plan anual / operațional;
5. Plan anual / calendar;
6. Monitorizare activări;
7. Monitorizare reputație;
8. Despre aplicație.

Verifică:
- font hierarchy;
- colors;
- spacing;
- cards/list;
- drawers/modals;
- filters;
- button labels;
- no broken overflow;
- no horizontal layout break la rezoluția desktop de referință.

Nu cere pixel-perfect la diferențe minore de rendering font, dar structura trebuie să fie echivalentă.

---

# 55. Browser E2E tests recomandate

Recomandat Playwright sau echivalent.

Minimum automated flows:

## E2E-01 Login

```text
login admin
→ campaigns visible
```

## E2E-02 Campaign create/edit

```text
New Campaign
→ save Draft
→ reopen
→ edit
→ save
→ persisted after browser refresh
```

## E2E-03 Campaign conflict

```text
browser A opens campaign
browser B edits/saves
browser A saves old version
→ 409 message
→ no silent overwrite
```

## E2E-04 Activation linked

```text
Campaign detail
→ Create Activation
→ save
→ appears in Activation list
```

## E2E-05 Independent Activation

```text
New Activation
→ no Campaign
→ save
→ remains valid
```

## E2E-06 Material upload

```text
Activation
→ upload image
→ save
→ refresh
→ image still displayed
```

## E2E-07 Annual Plan

```text
Activation include in plan
→ Annual Plan year appears
→ Activation visible
→ Campaign effective visible once
```

## E2E-08 Admin catalogs

```text
change label in staging
→ UI refresh
→ new label visible
```

## E2E-09 Import conflict

```text
Admin changes catalog label
→ preview Campaign package with old label
→ warning
→ commit
→ Admin label remains
```

## E2E-10 Role Viewer

```text
login viewer
→ same operational application
→ no Admin menu
→ no edit buttons / disabled
→ direct write API returns 403
```

## E2E-11 Admin integrated shell

```text
login admin
→ lands in operational app
→ Admin menu visible in same sidebar
→ open Administrare
→ same design system / topbar / sidebar
→ return to Campaigns without second login
```

## E2E-12 Editor shell

```text
login editor
→ operational modules visible
→ Admin menu absent
→ Strategy edit actions absent
→ Campaign/Activation edit allowed
```

## E2E-13 Strategy version history

```text
Admin creates strategy-2029-2033
→ adds/reimports OS2 with new meaning in new version
→ activates new version
→ old Campaign still displays/link-resolves OS2 from strategy-2026-2028
→ new Campaign defaults to strategy-2029-2033
```


## E2E-14 Continue Campaign

```text
camp-002 / family-camp-002 / strategy-2026-2028
→ Continue in new strategic cycle
→ strategy-2029-2033
```

Expected:
- new Campaign externalKey;
- same family;
- supersedes = camp-002;
- new StrategyVersion;
- status DRAFT;
- old Campaign unchanged;
- no Activation/AnnualPlan/Monitoring duplication;
- strategic links require review.

## E2E-15 Activation fără ambiguitate

```text
old Campaign CLOSED / old strategy
new Campaign ACTIVE / current strategy
→ New Activation
→ selector defaults current strategy
→ choose new Campaign
→ StrategyVersion inherited
```

## E2E-16 Strategy immutability

```text
used Campaign
→ attempt StrategyVersion change
→ controlled error
→ UI suggests Continue in new strategic cycle
```


## E2E-17 Deletion policy — nomenclator

```text
Admin creates TEST_AUDIENCE
→ 0 references
→ Delete
→ physical row removed
```

```text
FAMILIES is referenced
→ Delete
→ 409 ENTITY_IN_USE
→ UI shows usage
→ Deactivate
→ history still displays FAMILIES
→ new selectors hide FAMILIES
```

```text
campaign status ACTIVE
→ Delete
→ 409 SYSTEM_VALUE_PROTECTED
```

## E2E-18 Deletion policy — Campaign

```text
unused DRAFT Campaign
→ Delete
→ soft delete
```

```text
Campaign with Activations/AnnualPlans
→ Delete blocked
→ UI recommends CLOSED
→ CLOSED preserves history
```

## E2E-19 Staging reset

```text
APP_ENV=staging
→ reset-staging-business-data
→ business test data cleared
→ reimport 4 DEMO_SEED
→ golden acceptance PASS
```

Same command in production → hard fail.


---

# 56. Import negative tests

Obligatoriu:

1. malformed JSON;
2. wrong packageType;
3. unsupported schemaVersion;
4. duplicate Campaign externalKey;
5. Activation references missing Campaign;
6. Performance references missing Activation;
7. Performance references material from another Activation;
8. invalid money string;
9. invalid date;
10. prototype pollution key;
11. oversized file;
12. corrupted base64;
13. invalid asset MIME;
14. duplicate performance snapshot externalKey.

Expected:
- controlled error;
- no partial writes.

---

# 57. Idempotence tests

Import fiecare seed de două ori.

După a doua rundă:

```text
Campaigns still 6
Activations still 16
Materials still 42
Performance snapshots still 34
Reputation snapshots still 1
Annual plans still 3
```

Nu apar duplicate assets nejustificate.

Dacă asset checksum este identic, importerul trebuie fie:
- să reutilizeze asset;
sau
- să actualizeze controlat aceeași external_key.

---

# 58. Permission security tests

Nu testa doar UI.

Cu request direct:

```text
VIEWER → POST campaign → 403
VIEWER → PUT annual plan → 403
EDITOR → POST user → 403
EDITOR → PUT catalog → 403
EDITOR → POST import commit → 403
ADMIN → toate cele de mai sus conform drepturilor → allowed
```

---

# 59. XSS/security tests

Introduce în staging un label/test field:

```html
<img src=x onerror=alert(1)>
```

Expected:
- text afișat escaped;
- niciun script executat.

Upload filename:

```text
../../test.jpg
```

Expected:
- nume fizic generat de server;
- fără scriere în afara upload dir.

JSON with:

```text
__proto__
constructor
prototype
```

Expected:
- reject.

---

# 60. Performance / practical limits

Nu este nevoie de load testing enterprise.

Minimum practical test:
- bootstrap sub câteva secunde pe serverul țintă;
- Campaign/Activation save fără timeout;
- importurile demo se finalizează controlat;
- 100–500 snapshot-uri suplimentare nu rup dashboard-ul.

Pagination server-side este definită din v1 pentru monitoring/history.

Dacă volumul ajunge foarte mare (de ordinul sutelor de mii/milioanelor de snapshot-uri), pot fi adăugate ulterior:
- pre-aggregări;
- partitioning;
- warehouse/BI;
- background jobs.

Aceste optimizări nu trebuie să schimbe contractul funcțional de bază.

---

# 61. Test report obligatoriu înainte de UAT

Programatorul trebuie să livreze:

```text
TEST_REPORT.md
```

Cu:

```text
Test ID
Description
Environment
Expected
Actual
PASS/FAIL
Evidence / screenshot / log
```

Minimum:
- toate acceptance tests din prezentul document;
- versiune MySQL;
- versiune backend runtime;
- commit/release testat.

---

# 61.1. Extensibility guardrails pentru module și integrări viitoare

Aceste reguli nu cer construirea acum a modulelor viitoare, dar trebuie respectate în arhitectura v1.

## A. Modular monolith, nu shared spaghetti

Fiecare feature backend deține:
- controller/route;
- application service;
- repository/data access;
- business validation.

Un modul nou nu trebuie să scrie direct în tabelele altui modul ocolind service-ul proprietar.

## B. Integrări externe prin adaptoare

Viitoare integrări Social Insider, Zelist, CRM, Google Analytics, platforme de review etc. trebuie să urmeze:

```text
External API
   ↓
Provider Adapter
   ↓
normalized canonical DTO
   ↓
existing application/import service
   ↓
DB
```

Interzis:

```text
Provider-specific code
→ direct SQL în core tables
```

O integrare directă poate crea un `import_batch`/ingestion trace sintetic chiar dacă nu există un fișier fizic, pentru audit și idempotence.

## C. Provider-specific fields

Nu adăuga în `campaigns`, `activations` sau alte entități core coloane de tip:
- `socialinsider_x`;
- `zelist_y`;
- `tripadvisor_z`.

Datele provider-specific rămân în adapter/raw trace unde este necesar, iar core-ul primește model normalizat.

## D. Background jobs

V1 nu are nevoie obligatoriu de queue.

Dar joburile programate viitoare trebuie să poată apela aceleași application services ca request-urile HTTP. Business logic nu se scrie numai în controllers.

## E. API și JSON versioning

- REST: `/api/v1`, breaking changes prin versiune nouă;
- import packages: registry `(packageType, schemaVersion)`;
- vechile adaptoare nu se șterg doar pentru că apare un format nou.

## F. Storage

Business services depind de `AssetStorage`, nu de path-uri OS.

## G. Istoric strategic/master

- strategie nouă → StrategyVersion nouă;
- sens nou pentru nomenclator → code nou;
- nu se rescrie istoria.

## H. Extensii de schemă

Preferă coloane/tabele explicite pentru date ce trebuie filtrate, agregate sau relaționate.
JSON rămâne potrivit pentru conținut editorial flexibil, nu pentru orice nouă informație business.

---

# 62. API documentation

Trebuie livrat:

```text
API_OPENAPI.yaml
```

sau echivalent OpenAPI 3.x.

Trebuie să conțină:
- auth;
- users;
- catalogs;
- strategy;
- campaigns;
- activations;
- annual plans;
- assets;
- monitoring;
- imports;
- audit.

Nu este suficient ca endpointurile să existe doar în cod fără contract.

---

# 63. Ordinea recomandată de implementare

## Sprint / Etapa 1 — fundație

1. repo;
2. env;
3. MySQL;
4. migrations;
5. roles/users;
6. auth;
7. health;
8. logging;
9. bootstrap skeleton.

**Exit criterion:** Admin login + DB migrations + API health.

## Etapa 2 — master + Campaign

1. catalogs;
2. strategy;
3. Campaign API;
4. Campaign ApiRepository;
5. Campaign UI live;
6. templates/assets;
7. upload;
8. Campaign Package importer.

**Exit criterion:** import 6 Campaigns + visuals; Campaign screens match prototype.

## Etapa 3 — Activations + Plan anual

1. Activation API;
2. materials;
3. KPI;
4. funding;
5. custom audience;
6. independent activation;
7. Annual Plan;
8. calendar;
9. Activations Package importer.

**Exit criterion:** 16 Activations / 42 materials / Plan 2026 golden values.

## Etapa 4 — Monitoring

1. performance snapshots;
2. importer;
3. monitoring dashboard;
4. reputation snapshots;
5. importer;
6. reputation dashboard.

**Exit criterion:** 34 + 1 snapshots and golden dashboard values.

## Etapa 5 — Admin + audit + hardening

1. users UI;
2. catalogs edit UI;
3. strategy edit;
4. import history;
5. audit;
6. permissions;
7. concurrency;
8. backup/deployment;
9. full E2E.

**Exit criterion:** acceptance suite PASS.

---

# 64. Definition of Done — staging

Staging este considerat complet numai dacă:

- DB se construiește din migrations;
- Admin se poate autentifica;
- cele 4 JSON DEMO_SEED se importă;
- primul Campaign import populează StrategyVersion, toate nomenclatoarele și reperele strategice fără introducere manuală;
- istoricul strategic este versionat și testat;
- Campaign continuation/lineage este testată;
- Activation moștenește StrategyVersion fără ambiguitate;
- counts sunt corecte;
- UI reproduce prototipul;
- Plan 2026 are valorile golden;
- assets apar;
- CRUD persistă după refresh;
- roles funcționează;
- Admin este modul integrat în aceeași aplicație React și același login/design system;
- optimistic concurrency funcționează;
- soft delete funcționează;
- audit funcționează;
- import invalid nu scrie;
- import repetat este idempotent;
- browser console nu are errors;
- test report este PASS.

---

# 65. Definition of Done — production

Production este considerat pregătit dacă:

1. migrations aplicate;
2. DB fără demo business data;
3. Admin production creat;
4. HTTPS;
5. storage write permissions;
6. backup activ;
7. health PASS;
8. login PASS;
9. real Campaign Package poate fi previewed/imported;
10. production business DB poate fi bootstrap-uit din `OMD_CAMPAIGNS_PACKAGE` cu `purpose=INITIAL_IMPORT`, fără introducere manuală de master/strategy;
10a. primul import creează StrategyVersion și Campaign-urile sunt legate de ea;
11. staging acceptance este deja PASS;
12. DEMO_SEED nu este importat accidental;
13. `.env` production securizat.

---

# 66. Livrabile obligatorii de la programator

Programatorul trebuie să predea:

```text
1. source code frontend
2. source code backend
3. DB migrations
4. .env.example
5. README deployment
6. README local/staging setup
7. API_OPENAPI.yaml
8. JSON schemas incluse în proiect
9. import service
10. test suite
11. TEST_REPORT.md
12. backup/restore instructions
13. staging URL
14. production deployment instructions
```

Recomandat:
- tagged release / commit hash pentru versiunea recepționată.

---

# 67. Reguli „NU FACE”

1. Nu introduce Campaign/Activation demo în migrations.
2. Nu păstra business data în localStorage.
3. Nu stoca base64 în MySQL.
4. Nu schimba externalKey la editare.
5. Nu folosi titlul drept FK.
6. Nu suprascrie monitoring istoric.
7. Nu transforma `NULL` în `0`.
8. Nu transforma Campaign automat din Annual Plan în selecție manuală.
9. Nu șterge fizic Campaign/Activation cu istoric.
10. Nu permite frontend-ului să fie autoritatea de securitate.
11. Nu permite import parțial.
12. Nu suprascrie label-urile Admin la un import normal.
13. Nu rescrie UI-ul fără motiv.
14. Nu adăuga funcționalități enterprise care nu sunt în scope.
15. Nu importa DEMO_SEED în production.

---

# 68. Reguli pentru AI-ul care va scrie codul

Dacă această specificație este dată unui AI de coding:

1. citește integral:
   - FULLSTACK spec v1.5;
   - DB spec;
   - SQL blueprint;
   - cele 4 JSON schemas;
   - v13.3 HTML;
2. nu genera schema DB din nou de la zero;
3. folosește migrations bazate pe blueprint;
4. nu modifica contractele JSON;
5. implementează vertical, modul cu modul;
6. după fiecare modul rulează testele aferente;
7. nu trece la următorul modul dacă regression suite pentru modulul curent eșuează;
8. orice abatere de la model trebuie documentată înainte de implementare;
9. păstrează lista `KNOWN_DEVIATIONS.md`, ideal goală;
10. la final rulează full seed acceptance.
11. frontend-ul este React; nu recrea vechile globals `OMD.*` ca arhitectură de producție.
12. păstrează prototipul v13.3 ca referință vizuală și de business, nu ca structură obligatorie de componente.
13. Admin este modul al aceleiași aplicații React, nu aplicație separată.
14. nu hardcoda nomenclatoarele/strategia în React; ele trebuie să provină din API/DB după bootstrap.
15. o DB business goală trebuie să poată fi populată prin Campaign Package fără pre-seeding manual.
16. nu presupune că strategic codes sunt unice global; rezolvă-le în `strategy_version`.
17. nu introduce provider-specific logic în core domain/repositories.
18. list APIs trebuie implementate paginabil chiar dacă seed-ul este mic.
19. `storage_path` este storage key opac; nu răspândi path-uri locale în business logic.
20. un Campaign record nu aparține niciodată la două StrategyVersions.
21. continuitatea se face prin Campaign nou + aceeași family + supersedes.
22. `continue` nu copiază Activation/AnnualPlan/Monitoring.
23. Activation cu Campaign moștenește StrategyVersion din Campaign.
24. nu folosi DELETE CASCADE pentru a evita dependency checks.
25. master non-system neutilizat poate fi șters fizic; master utilizat se dezactivează.
26. `is_system` este tehnic și nu se importă din business JSON.
27. `CLOSED` nu înseamnă soft-deleted.
28. delete user-facing face dependency re-check în backend și întoarce 409 business, nu 500 FK.

---

# 69. Acceptance matrix final

| Zonă | Test cheie | Expected |
|---|---|---|
| Auth | Admin login | PASS |
| Campaigns | Demo import | 6 |
| Templates | Demo import | 15 |
| Visual assets | Files decoded | 8 |
| Strategy | Pillars/Programs/Objectives | 4 / 8 / 18 |
| Activations | Demo import | 16 |
| Materials | Demo import | 42 |
| Annual Plan | DB years | 2026 / 2027 / 2028 |
| Annual Plan | 2026 activations | 10 |
| Annual Plan | 2026 effective campaigns | 6 |
| Annual Plan | 2026 planned | 177.500 lei |
| Annual Plan | 2026 actual | 123.400 lei |
| Annual Plan | 2026 execution | 69,5% |
| Performance | snapshots | 34 |
| Reputation | snapshots | 1 |
| Reputation | mentions | 1.284 |
| Reputation | reviews | 214 |
| Reputation | rating | 4,42 |
| Reputation | positive | 67% |
| Import | repeat same package | no duplicates |
| Import | invalid reference | rollback |
| Concurrency | stale save | 409 |
| Roles | Viewer write | 403 |
| Master bootstrap | Empty DB + Campaign package | all catalogs populated |
| Strategy bootstrap | Empty DB + Campaign package | 1 version + 4 / 8 / 18 |
| Strategy evolution | New horizon | old Campaign links preserved |
| Campaign continuity | Continue to new strategy | new DRAFT / same family / supersedes old |
| Activation context | Campaign-derived | strategy inherited, no ambiguity |
| Master delete | non-system / 0 refs | physical delete |
| Master delete | referenced | 409 + deactivate option |
| System master | delete/deactivate | protected |
| Campaign delete | historical dependencies | blocked + CLOSED |
| FK race | concurrent reference | controlled 409 |
| Admin shell | Single login/app | same React design system |
| Master data | Admin edit | persists |
| Master import conflict | Admin label | warning + not overwritten |
| Assets | restart/refresh | images still load |
| API lists | Pagination | stable meta contract |
| Import purposes | all 4 package families | DB CHECK compatible |
| Console | main routes | 0 JS errors |

---

# 70. Handoff checkpoint înainte de începerea codingului

Programatorul trebuie să confirme în scris doar următoarele:

```text
[ ] stack backend ales
[ ] versiune MySQL target
[ ] server staging disponibil
[ ] server production / constrângeri cunoscute
[ ] filesystem upload path disponibil
[ ] HTTPS/domain/subdomain plan
[ ] migrations mechanism ales
[ ] test framework ales
[ ] toate fișierele sursă primite
```

Acestea sunt decizii de infrastructură, nu trebuie folosite pentru a redeschide modelul funcțional.

---

# 71. Concluzie

Implementarea corectă nu este:

```text
„ia HTML-ul și pune MySQL în spate”
```

ci:

```text
v13.3 = contract vizual/funcțional
DB spec = contract de persistență
4 JSON schemas = contract de interoperabilitate
DEMO_SEED = test fixture oficial

        ↓

Frontend canonical
        ↓
ApiRepository
        ↓
Backend services/importers
        ↓
MySQL + assets storage
```

Criteriul principal de succes este că staging-ul, populat exclusiv prin cele patru JSON-uri DEMO_SEED, reproduce funcțional datele și comportamentul prototipului v13.3, în timp ce datele sunt persistate real în MySQL/storage și toate operațiile utilizatorilor trec prin backend.

În plus, mecanismul de bootstrap trebuie să demonstreze că aceeași arhitectură poate porni o bază production fără date business și o poate popula imediat din package-uri reale: strategie, nomenclatoare, campanii și assets, fără introducere manuală.
