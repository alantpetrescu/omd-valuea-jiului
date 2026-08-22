# BACKEND READINESS REPORT – OMD Valea Jiului

**Fișier de intrare:** `OMD-Valea-Jiului-prototip_canonical_v12_1(2).html`  
**Fișier rezultat:** `OMD-Valea-Jiului-prototip_backend_ready_v13.html`  
**Etapă:** separare UI / persistență / reguli de business, înainte de backend  
**Data verificării:** 12 august 2026  
**Limită respectată:** nu a fost creat backend, nu a fost proiectată schema SQL și nu a fost modificat modelul funcțional canonical.

---

## 1. Rezumat executiv

Etapa 2 a fost implementată ca refactor intern al prototipului self-contained.

Obiectivul a fost ca interfața să nu mai depindă de mecanismul actual de persistență și de formule locale duplicate. În v13:

- UI-ul nu mai accesează direct `localStorage`;
- UI-ul nu mai accesează `OMD.store` sau `OMD.activationStore`;
- UI-ul consumă repositories;
- regulile comune de business sunt centralizate în `OMD.services`;
- datele demonstrative sunt grupate în `OMD.fixtures`;
- generarea ID-urilor este izolată în `OMD.IdService`;
- operațiunile de imagine/base64 sunt izolate în `OMD.FileStorageAdapter`;
- accesul UI la `material.apiResults` a fost eliminat și mutat în `MonitoringRepository`;
- Planul anual își citește/salvează selecțiile prin `AnnualPlanRepository`;
- modelul canonical din v12.1 a rămas neschimbat;
- comportamentul vizibil v12.1 → v13 este identic în scenariile de regresie testate.

Prototipul poate rămâne într-un singur HTML pentru testare, dar are acum limite interne clare care permit înlocuirea repositories locale cu repositories API fără rescrierea ecranelor.

---

## 2. Corecția finală de puritate canonicală făcută înainte de etapa 2

Înaintea refactorului backend-ready au fost eliminate cele două resolvere tolerante identificate în auditul v12.1.

### v12.1

`OMD.catalogs.programId()` și `OMD.catalogs.objectiveId()` puteau extrage un ID dintr-un text mai lung, de exemplu:

```text
P5.2 – Programul pentru Campanii Multicanal...
OS3 – Creșterea vizibilității...
```

### v13

Runtime catalogs acceptă numai ID canonical existent:

```js
OMD.catalogs.programId('P5.2')        // P5.2
OMD.catalogs.programId('P5.2 – ...')  // ''

OMD.catalogs.objectiveId('OS3')       // OS3
OMD.catalogs.objectiveId('OS3 – ...') // ''
```

Conversia text legacy → ID există numai în `OMD.legacy` prin resolverele legacy interne.

Test direct:

- runtime `programId` strict: **PASS**;
- runtime `objectiveId` strict: **PASS**;
- `OMD.legacy.migrateCampaign()` continuă să migreze textul legacy la ID canonical: **PASS**.

În plus, `OMD.legacy.migrateMaterial()` nu mai depinde de `OMD.store` sau de repository. Contextul necesar migrării este transmis explicit adapterului.

**Rezultat:** `OMD.legacy` nu are acces la `OMD.store`, `OMD.activationStore` sau `OMD.repositories`.

---

## 3. Organizarea conceptuală internă v13

Codul self-contained este organizat conceptual în următoarele layere:

```text
DOMAIN
   ↓
CATALOGS / CANONICAL HELPERS
   ↓
LEGACY ADAPTER
   ↓
SERVICES
   ↓
FIXTURES
   ↓
REPOSITORIES
   ↓
UI MODULES
   ↓
APPLICATION / ROUTING
```

Dependența importantă pentru etapa următoare este:

```text
UI
 ↓
Repository contract
 ↓
LocalStorageRepository        [v13]

poate deveni:

UI
 ↓
Repository contract
 ↓
ApiRepository                 [backend]
```

UI-ul nu trebuie rescris pentru această substituție.

---

## 4. Repository layer introdus

### 4.1 Repository contracts

Au fost declarate explicit contractele:

```text
CampaignRepository
ActivationRepository
AnnualPlanRepository
MonitoringRepository
```

Pentru entitățile CRUD, contractul conține:

```text
list()
get(id)
create(data)
update(id, data)
save(data)
remove(id)
```

### 4.2 LocalStorageCampaignRepository

Implementarea curentă:

```text
OMD.LocalStorageCampaignRepository
OMD.repositories.campaign
```

Responsabilități:

- citește `omd-vj-campaigns-v5`;
- migrează prin `OMD.legacy.migrateCampaign()`;
- păstrează numai Campaign canonical;
- notifică subscriberii;
- persistă canonical în localStorage;
- folosește `OMD.fixtures.seedCampaigns()` când nu există date salvate.

### 4.3 LocalStorageActivationRepository

Implementarea curentă:

```text
OMD.LocalStorageActivationRepository
OMD.repositories.activation
```

Responsabilități:

- citește `omd-vj-activations-v4`;
- păstrează mecanismul existent de demo data version;
- migrează activările și materialele la model canonical;
- oferă suplimentar `byCampaign(campaignId)`;
- persistă canonical;
- folosește `OMD.fixtures.demoActivations()` pentru seed.

### 4.4 LocalStorageAnnualPlanRepository

Implementarea curentă:

```text
OMD.LocalStorageAnnualPlanRepository
OMD.repositories.annualPlan
```

Cheie:

```text
omd-vj-annual-plans-v1
```

Persistă exclusiv selecția manuală de campanii pe ani, conform modelului anterior.

Planul anual nu mai citește sau scrie direct localStorage.

### 4.5 MonitoringRepository

Implementarea curentă:

```text
OMD.MonitoringRepository
OMD.repositories.monitoring
```

Responsabilități:

- expune rezultatele de performance ale materialelor;
- citește `apiResults` în interiorul repository-ului;
- poate atribui / șterge rezultatele unui material fără ca UI-ul să cunoască forma de stocare;
- oferă ultima dată de actualizare;
- expune fixture-ul reputațional;
- oferă providerul demonstrativ de metrici printr-un punct unic.

Dashboard-ul de monitorizare nu mai citește direct `material.apiResults`.

---

## 5. Accesări directe eliminate

Audit static asupra secțiunii `UI MODULES` din v13:

| Acces / dependență | Număr în UI |
|---|---:|
| `localStorage` | **0** |
| `OMD.store` | **0** |
| `OMD.activationStore` | **0** |
| `new FileReader` | **0** |
| `readAsDataURL` | **0** |
| `OMD.u.id` | **0** |
| `material.apiResults` | **0** |
| accesări `apiResults?.` | **0** |
| `OMD_DATA.campaigns` ca sursă de entități în UI | **0** |

Toate accesările `localStorage` rămase sunt în implementations ale repositories.

### Fațade de compatibilitate

În v13 există încă:

```js
OMD.store = OMD.repositories.campaign;
OMD.activationStore = OMD.repositories.activation;
```

Acestea sunt păstrate exclusiv ca fațadă tranzitorie pentru testele și integrările istorice. Modulele UI nu le folosesc.

Ele pot fi eliminate după ce toate test fixtures/external scripts au fost mutate la noile repository contracts.

---

## 6. Business services comune

Au fost centralizate în:

```text
OMD.services
```

### Servicii obligatorii implementate

```text
getTemporalSituation()
overlapsYear()
calculateFundingTotal()
calculateBudgetBalance()
calculateCampaignAnnualTotals()
calculateInteractions()
calculateEngagementRate()
calculateCTR()
calculateCPC()
calculateCPM()
formatMoney()
formatDate()
formatPeriod()
```

Suplimentar există helper-ele comune:

```text
toNumberOrNull()
parseDate()
overlapsMonth()
getTemporalSituationClass()
formatDateTime()
```

### Module care reutilizează serviciile

Aceleași formule sunt folosite acum de:

- Activări;
- lista Activări;
- Plan anual;
- Calendar;
- Monitorizare performanță.

Nu mai există implementări independente pentru situația temporală, finanțare, sold bugetar, CTR, engagement rate, CPC și CPM.

`fmtOperationalPeriod()` a fost păstrat separat deoarece reprezintă intenționat o formatare managerială abreviată diferită de `formatPeriod()`.

---

## 7. STORED / DERIVED / IMPORTED

Clasificarea este declarată și în cod prin `OMD.domain.dataClassification`.

### STORED

Sunt persistate datele introduse/configurate de utilizator:

- Campaign canonical;
- Activation canonical;
- ActivationMaterial canonical;
- ActivationKpi;
- FundingSource;
- selecțiile manuale `AnnualPlan.selectedCampaignIds`;
- referințele materialelor către template-uri;
- datele operaționale ale materialelor și activărilor.

### IMPORTED

Date provenite din surse externe/import:

- `ActivationMaterial.apiResults`;
- datele de monitorizare reputațională/import periodic.

`apiResults` poate continua momentan să fie persistat în obiectul materialului, dar UI îl accesează prin `MonitoringRepository`. Backend-ul va putea muta ulterior aceste date într-o structură proprie fără modificarea dashboard-ului.

### DERIVED

Nu sunt persistate ca valori independente:

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

Acestea sunt calculate din date STORED/IMPORTED.

---

## 8. Fixtures / demo data

Datele demonstrative au fost mutate conceptual în:

```text
OMD.fixtures
```

Sunt expuse explicit:

```text
seedCampaigns()
demoActivations()
demoMaterials()
generateDemoMetrics()
annualPlans()
seedReputationData()
```

și aliasul intern `reputation()`.

### Separarea față de business logic

Secțiunea `SERVICES` nu conține nicio referință la `OMD.fixtures`.

Business rules nu depind de generatorul demonstrativ.

Implementarea locală ActivationRepository folosește fixture-urile doar pentru inițializarea prototipului.

### Date păstrate

După reset/seed:

- Campanii demo: **6**;
- Activări demo: **16**.

Valorile și relațiile sunt aceleași ca în v12.1.

---

## 9. IdService

Generatorul de ID pentru entități noi este izolat în:

```text
OMD.IdService.create(prefix)
```

UI-ul nu mai generează ID-uri prin `OMD.u.id`.

Implementarea de prototip continuă să folosească browserul pentru generare și păstrează comportamentul anterior.

### Producție

În backend, ID-urile persistente trebuie furnizate de server, recomandat UUID.

ID-urile demo existente nu au fost modificate.

---

## 10. FileStorageAdapter

Operațiile de citire/procesare a imaginilor sunt izolate în:

```text
OMD.FileStorageAdapter
```

Metode curente:

```text
readImage()
campaignImageAsset()
materialImage()
```

În prototip, implementarea continuă să producă data URLs/base64 și acestea sunt persistate prin repository odată cu entitatea.

UI-ul nu mai utilizează direct:

```text
FileReader
readAsDataURL
canvas compression implementation
```

### Producție

Adapterul poate fi înlocuit cu:

```text
upload multipart → backend/file storage → URL/asset ID
```

fără schimbarea fluxului UI de selectare a imaginii.

---

## 11. Performance data

În v12.1, dashboard-ul și alte zone puteau citi direct:

```js
material.apiResults
```

În v13, accesul trece prin:

```text
OMD.repositories.monitoring.getMaterialResults(material)
```

Scrierea/ștergerea rezultatelor trece prin același repository.

Prin urmare, dashboard-ul nu mai trebuie să știe dacă rezultatele provin din:

- proprietatea locală `apiResults`;
- un import trimestrial;
- un endpoint API;
- o tabelă de performance separată.

Acest detaliu devine responsabilitatea implementării `MonitoringRepository`.

---

## 12. Cod mort eliminat

Eliminarea s-a făcut numai pentru elemente pentru care auditul static a demonstrat absența oricărei referințe reale în aplicație.

### Funcții / helper-e eliminate

- `OMD.u.season` – helper legacy nereferit;
- `OMD.seasonality.legacyText()` – export nereferit;
- helperul intern `normalizeMaterial()` din vechiul activation store – nereferit;
- helperul fixture `latestResultsUpdate(materials)` din vechiul generator – nereferit;
- `kpiSourceCards()` – nereferit;
- `kpiSourceMatrix()` – nereferit;
- `temporalClass()` – nereferit;
- `displaySituation()` – nereferit;
- `resultStatus()` – nereferit;
- helperul fixture `normalizeActivation()` rămas fără utilizare după introducerea repository-ului;
- `aggregateImplementation()` local din Annual – devenit nereferit după centralizarea în `calculateCampaignAnnualTotals()`.

### Constante eliminate

- `uniq` – nereferit;
- `weakKpis` – calculat, dar niciodată utilizat;
- `displayList` – nereferit;
- `FUNDING_SHORT` – nereferit;
- `decimalFmt` – nereferit.

### Nomenclatoare eliminate

- `OMD_DATA.config.seasons` – definit, dar fără nicio citire în aplicație; fusese înlocuit funcțional de `seasonalityTypes` + `seasonalityMonths`.

### CSS

CSS-ul a fost analizat separat.

Nu a fost eliminat niciun selector CSS deoarece markup-ul aplicației este generat dinamic în multe module și nu a existat suficientă dovadă statică pentru a declara selectori compleți ca fiind definitiv morți fără risc de regresie.

**CSS-ul v13 este byte-identic cu CSS-ul v12.1.**

Aceasta este intenționat o decizie conservatoare conform cerinței „nu elimina cod doar pentru că pare vechi”.

---

## 13. Funcții duplicate eliminate / centralizate

Au fost eliminate implementările locale duplicate pentru:

- situația temporală;
- overlap pe an;
- overlap calendaristic lunar;
- total finanțare;
- sold bugetar;
- totaluri anuale pe campanie;
- interacțiuni;
- engagement rate;
- CTR;
- CPC;
- CPM;
- formatare monedă;
- formatare dată;
- formatare perioadă;
- clasificarea CSS a situației temporale.

Modulele pot avea aliasuri locale pentru lizibilitate, de exemplu:

```js
const temporalSituation = OMD.services.getTemporalSituation;
```

Acestea nu sunt implementări duplicate; referă aceeași funcție comună.

---

## 14. Zone rămase intenționat pentru backend

Refactorul NU implementează încă următoarele componente:

### Persistență

De înlocuit ulterior:

```text
LocalStorageCampaignRepository
LocalStorageActivationRepository
LocalStorageAnnualPlanRepository
```

cu implementări API.

### ID

`IdService` generează încă ID-uri în browser. În producție serverul va furniza UUID.

### File storage

`FileStorageAdapter` folosește încă data URL/base64. În producție va utiliza upload real și storage server-side/object storage.

### Performance

`MonitoringRepository` citește momentan rezultatele importate din material. În backend poate deveni repository către endpoint/tabelă dedicată performance.

### Reputation

Dashboardul reputațional folosește încă fixture-uri demonstrative; importul trimestrial real va alimenta repository-ul dedicat.

### Catalogs

Nomenclatoarele sunt încă livrate în bundle-ul self-contained. Pot deveni endpointuri/config server-side ulterior fără schimbarea modelului Campaign.

---

## 15. Teste finale

### 15.1 Sintaxă

```text
node --check v13.js
PASS
```

### 15.2 Suita funcțională existentă

```text
27 / 27 PASS
```

Acoperă:

- încărcare;
- Campaign create/edit/open;
- Activation create/edit;
- activare independentă;
- materiale;
- KPI și rezultate;
- Plan anual;
- Calendar;
- Monitorizare activări;
- Monitorizare reputație;
- drill-down;
- migrare legacy.

### 15.3 Migrare localStorage

```text
6 / 6 PASS
```

### 15.4 Canonical strict / micro-refactor

```text
24 / 24 PASS
```

Include în continuare:

- whitelist strict;
- eliminare câmpuri necunoscute;
- sezonalitate canonical-only;
- legacy fixture complet;
- E2E Campaign create/edit.

### 15.5 Backend-readiness tests noi

```text
37 / 37 PASS
```

Verifică explicit:

- lipsa localStorage în UI;
- lipsa vechilor stores în UI;
- repositories și contractele lor;
- services comune;
- resolvere program/objective strict canonical;
- legacy adapter text → ID;
- IdService;
- FileStorageAdapter;
- fixtures separate;
- STORED/DERIVED/IMPORTED;
- MonitoringRepository;
- numărul de Campaign/Activation;
- calculele comune;
- lipsa page errors.

---

## 16. Regresie vizuală și funcțională v12.1 → v13

Au fost efectuate patru comparații browser-to-browser între fișierul atașat v12.1 și v13.

### Rute principale

Identice pentru:

- Campanii;
- Repere strategice;
- Activări;
- Plan anual;
- Monitorizare activări;
- Monitorizare reputație;
- Despre aplicație.

Rezultat:

```text
all_same = true
source_errors = []
target_errors = []
```

### Toate cele 6 campanii + activări reprezentative

```text
all_same = true
```

### Vizualizare completă „Cap-coadă” – toate cele 6 campanii

```text
all_same = true
```

### Filtre și click/navigation

Comparate explicit:

- Activări → filtru Campanie;
- Activări → filtru Campanie + Stadiu;
- Plan anual → filtru Campanie;
- Plan anual → Calendar;
- Monitorizare → filtru Campanie;
- Monitorizare → Campanie + Canal;
- click deschidere Activare;
- click deschidere Campaign.

Rezultat:

```text
all_same = true
source_errors = []
target_errors = []
```

---

## 17. Verificarea layout-ului

Comparând fișierele v12.1 și v13:

```text
CSS: identic
markup static din afara <script>: identic
```

Hash SHA-256 CSS verificat:

```text
4dbf708f5587787ec3e2e5f564a6c9ddf0c7962dc8ae33836d7ddf9cc382bdfe
```

Nu au fost modificate:

- layout-ul;
- textele vizibile;
- culorile;
- fonturile;
- structura HTML statică;
- navigarea;
- filtrele;
- valorile demonstrative afișate.

---

## 18. Concluzie

`OMD-Valea-Jiului-prototip_backend_ready_v13.html` este pregătit pentru etapa următoare de backend din perspectiva separării responsabilităților.

Punctul esențial este că UI-ul nu mai știe cum sunt persistate Campaign, Activation, AnnualPlan sau datele de performance.

Pentru trecerea la backend, etapa următoare poate înlocui:

```text
LocalStorage*Repository
```

cu:

```text
Api*Repository
```

și:

```text
FileStorageAdapter base64
```

cu:

```text
FileStorageAdapter upload backend
```

fără rescrierea modulelor de UI.

Modelul canonical rămâne stabil, iar această etapă nu a introdus backend sau schema SQL.
