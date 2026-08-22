# DATA PORTABILITY REPORT – OMD Valea Jiului

**Fișier sursă modificat:** `OMD-Valea-Jiului-prototip_backend_ready_v13_1(1).html`  
**Fișier rezultat:** `OMD-Valea-Jiului-prototip_data_portability_v13_2.html`  
**Etapă:** 2.5 – Data Portability  
**Contract:** `OMD_DATA_PACKAGE` / `schemaVersion: 1.0`  
**Data verificării:** 12 august 2026

## 1. Rezumat

Etapa 2.5 introduce un contract JSON independent de mecanismul curent de persistență. Implementarea nu este un dump de `localStorage` și nu introduce backend, SQL, ORM, API, parser DOCX sau CMS de nomenclatoare.

Fluxul este:

```text
UI
 ↓
OMD.DataPackageService
 ↓
Repositories
 ↓
LocalStorageRepository în prototip / ApiRepository ulterior
```

Au fost implementate:

- export JSON canonical STORED;
- JSON Schema v1;
- validator runtime;
- preview / dry-run;
- MERGE / UPSERT pe `externalKey`;
- REPLACE cu snapshot și rollback;
- verificare post-import;
- păstrarea datelor IMPORTED de monitorizare pentru materialele matching;
- UI minimal în „Despre aplicație → Date & import/export”;
- sample JSON exportat din datele demo reale.

## 2. Structura pachetului

```json
{
  "packageType": "OMD_DATA_PACKAGE",
  "schemaVersion": "1.0",
  "metadata": {},
  "strategicData": {
    "pillars": [],
    "programs": [],
    "objectives": []
  },
  "catalogs": {},
  "campaigns": [],
  "activations": [],
  "annualPlans": []
}
```

Exportul demo real conține:

- 6 campanii;
- 16 activări;
- 2 planuri anuale (2027 și 2028);
- 4 piloni;
- 8 programe strategice;
- 18 obiective strategice.

## 3. STORED / DERIVED / IMPORTED

### STORED transportat

Pachetul include datele canonical ale:

- Campaign;
- Activation;
- ActivationMaterial, fără `apiResults`;
- ActivationKpi;
- FundingSource;
- AnnualPlan.selectedCampaignIds, transformate în `selectedCampaignExternalKeys`;
- repere strategice și nomenclatoare ca snapshot de referință.

### DERIVED exclus

Nu sunt exportate ca proprietăți persistente:

- `temporalSituation`;
- `fundingTotal`;
- `budgetBalance`;
- `campaignAnnualTotals`;
- `interactions`;
- `engagementRate`;
- `ctr`;
- `cpc`;
- `cpm`;
- `campaignTitle`.

Acestea rămân responsabilitatea `OMD.services`.

### IMPORTED exclus

Nu intră în `OMD_DATA_PACKAGE v1`:

- `ActivationMaterial.apiResults`;
- datele de reputation monitoring.

Acestea vor necesita contract separat `OMD_MONITORING_PACKAGE` într-o etapă ulterioară.

## 4. Identitate și externalKey

Top-level Campaign și Activation sunt transportate cu:

```text
externalKey = id-ul canonical actual
```

Exemple:

```text
camp-001
activation-...
```

Planul anual utilizează anul ca `externalKey`.

La import, `externalKey` este mapat către `id` canonical al prototipului. În backend, `externalKey` poate rămâne identificatorul stabil de integrare, separat de viitorul UUID intern DB.

## 5. Coduri și nomenclatoare

Transportul introduce coduri stabile pentru nomenclatoarele care influențează relațiile sau logica, de exemplu:

```text
ACTIVE
DRAFT
CLOSED
UMBRELLA
THEMATIC
TACTICAL
FAMILIES
ACTIVE_YOUNG
OMD_BUDGET
PUBLIC_PROJECT
```

Denumirile sunt transportate separat ca `label`.

Pentru programe și obiective se folosesc codurile existente:

```text
P5.1 ... P5.8
OS1 ... OS18
```

### Observație pentru piloni

Modelul canonical actual conține și formulări descriptive ale pilonului care diferă ușor între campanii. Pentru a evita pierderea de informație, transportul păstrează simultan:

- `code` semantic (`PILLAR_1`, `PILLAR_2`, `PILLAR_3`, `TRANSVERSAL`);
- `label` cu textul exact din fișa canonical.

Normalizarea definitivă code/label va fi făcută în schema DB.

## 6. Strategic data și catalogs în v13.2

`strategicData` și `catalogs` sunt incluse și validate, dar rămân **read-only snapshots în v13.2**.

Motivul: în v13.1 aceste informații sunt încă livrate în bundle și nu există un `ConfigurationRepository` / `StrategicRepository`. Introducerea acum a unei persistențe artificiale numai pentru import ar anticipa schema DB și ar încălca separarea arhitecturală stabilită.

Prin urmare:

- codurile sunt validate;
- referințele Campaign sunt validate;
- diferențele de label produc warnings;
- codurile noi care nu există în runtime nu sunt aplicate;
- persistența și administrarea reală a acestor nomenclatoare trec în Etapa 3 DB/backend.

## 7. Export

Implementat:

```js
OMD.DataPackageService.exportPackage(options)
OMD.DataPackageService.stringifyPackage(packageObject)
```

Caracteristici:

- citește Campaign / Activation / AnnualPlan prin repositories;
- nu citește `localStorage`;
- clonează înainte de mapare;
- nu modifică runtime objects;
- elimină `apiResults` din materialele transportate;
- păstrează structură și ordine deterministă pentru date;
- output human-readable prin `JSON.stringify(..., null, 2)`;
- metadata include `packageId`, `generatedAt`, `source`, `application`.

UI-ul descarcă:

```text
omd-valea-jiului-data-YYYY-MM-DD.json
```

## 8. Validator

Implementat:

```js
OMD.DataPackageService.validatePackage(packageObject)
```

Verifică:

- `packageType`;
- `schemaVersion`;
- metadata;
- secțiunile obligatorii;
- tipurile principale;
- proprietăți necunoscute la nivelurile canonical relevante;
- coduri duplicate;
- `externalKey` duplicate;
- relația Campaign → parent Campaign;
- Campaign → Program / Objective;
- Activation → Campaign;
- AnnualPlan → Campaign;
- FundingSource;
- ActivationMaterial;
- ActivationKpi;
- nomenclatoare și repere strategice;
- versiuni incompatibile;
- proprietăți periculoase `__proto__`, `constructor`, `prototype`.

Validatorul nu scrie în repositories și întoarce controlat:

```json
{
  "valid": true,
  "errors": [],
  "warnings": []
}
```

Un package malformed nu produce excepție necontrolată.

## 9. Versionare

Acceptat în această etapă:

```text
schemaVersion = 1.0
```

Un major version necunoscut, de exemplu `2.0`, este respins cu mesaj de incompatibilitate.

Nu s-a introdus migrare implicită pentru versiuni viitoare.

## 10. Preview / dry run

Implementat:

```js
OMD.DataPackageService.previewImport(packageObject, { mode })
OMD.DataPackageService.importPackage(packageObject, { dryRun: true })
```

Preview-ul raportează pentru:

- Campaign;
- Activation;
- AnnualPlan;

numărul de:

- create;
- update;
- unchanged;
- removed (numai în Replace).

Nomenclatoarele și strategia raportează validarea/conflictele prin warnings/errors.

Preview-ul nu scrie date.

## 11. MERGE / UPSERT

Identificarea se face după `externalKey`.

Reguli:

- entitate absentă → CREATE;
- entitate existentă și diferită → UPDATE;
- entitate identică → UNCHANGED;
- entitățile care lipsesc din package rămân neatinse;
- nu există DELETE implicit.

Importarea aceluiași pachet de două ori este idempotentă.

## 12. REPLACE

REPLACE:

1. validează package;
2. calculează preview;
3. creează snapshot prin repositories;
4. înlocuiește Campaign / Activation / AnnualPlan;
5. verifică starea rezultată;
6. face rollback dacă orice etapă eșuează.

Nu este utilizat acces direct la `localStorage`.

Ordinea entităților din export este reconstruită la round-trip, chiar dacă repository-urile locale folosesc `unshift()` la create.

## 13. Păstrarea datelor de monitorizare

Aceasta este o protecție suplimentară importantă față de specificația minimă.

În datele demo curente există 34 de materiale cu `apiResults`.

La MERGE sau REPLACE:

- package-ul principal nu transportă aceste rezultate;
- înainte de update sunt identificate materialele existente după ID;
- `apiResults` existente sunt reatașate materialelor matching;
- rezultatele nu sunt transformate în date STORED ale package-ului.

Dacă un material este eliminat intenționat din Activation, rezultatele lui nu pot rămâne atașate unei entități care nu mai există; această situație va trebui modelată separat în backend dacă se dorește istoric de rezultate independent de material.

## 14. Rollback

Importul este logic atomic la nivelul prototipului.

Snapshot-ul conține:

- Campaign;
- Activation, inclusiv starea IMPORTED locală necesară restaurării;
- AnnualPlan.

La eroare după începerea scrierii se rulează restaurarea exclusiv prin repositories.

Testul automat a forțat intenționat o eroare în `ActivationRepository.create()` în timpul Replace și a confirmat restaurarea stării anterioare.

## 15. UI

A fost adăugat exclusiv în:

```text
Despre aplicație → Date & import/export
```

Funcții UI:

- Exportă datele;
- Selectează JSON;
- afișează nume fișier;
- versiune;
- număr Campaign / Activation / AnnualPlan;
- validare;
- errors/warnings;
- mod Merge / Replace;
- preview;
- import;
- raport final.

Fișierul este citit cu:

```js
await file.text()
```

Nu a fost introdus un `FileReader` nou.

## 16. Securitate

Implementarea:

- nu utilizează `eval()`;
- nu execută conținut din JSON;
- respinge chei de prototype pollution;
- validează proprietăți necunoscute;
- afișează mesaje prin helperul de escaping existent;
- nu injectează JSON brut în `innerHTML`;
- nu scrie nimic dacă validarea eșuează.

## 17. Teste

### JavaScript syntax

```text
node --check v13_2.js
PASS
```

### Regresie funcțională existentă

```text
27 / 27 PASS
```

### LocalStorage / legacy migration

```text
6 / 6 PASS
```

### Canonical strict / micro-refactor

```text
24 / 24 PASS
```

### Backend readiness

```text
37 / 37 PASS
```

### Data portability – service / integrity

```text
23 / 23 PASS
```

Acoperă explicit:

- export v1;
- strategic/catalog snapshots;
- excludere `apiResults`;
- validare export propriu;
- preview unchanged;
- versiune major incompatibilă;
- referință Activation → Campaign invalidă;
- zero writes pentru package invalid;
- duplicate `externalKey`;
- objective code inexistent;
- round-trip după empty state;
- idempotence;
- update după `externalKey`;
- păstrare `apiResults` la MERGE;
- păstrare `apiResults` la REPLACE;
- rollback forțat;
- UI tab;
- lipsă page errors.

### UI Data Portability

```text
4 / 4 PASS
```

Acoperă:

- `file.text()` + validare UI;
- preview UI;
- export/download UI;
- lipsa page errors.

### JSON Schema

```text
Draft 2020-12 schema: PASS
Sample JSON vs schema: PASS
```

## 18. Audit arhitectural post-implementare

În secțiunea UI:

```text
localStorage             0
window.localStorage      0
OMD.store                0
OMD.activationStore      0
new FileReader           0
readAsDataURL            0
OMD.u.id                 0
material.apiResults      0
apiResults?.             0
```

În `OMD.DataPackageService`:

```text
localStorage             0
window.localStorage      0
OMD.store                0
OMD.activationStore      0
new FileReader           0
readAsDataURL            0
```

În întregul HTML rămâne un singur `new FileReader` / `readAsDataURL`, exclusiv în `FileStorageAdapter`, conform arhitecturii v13.1.

Static markup din afara `<style>` și `<script>` este identic cu v13.1. CSS-ul existent a fost păstrat integral și au fost adăugate numai stilurile pentru noua secțiune Data Portability.

## 19. Avertisment de calitate a datelor identificat

Sample-ul real produce un singur warning:

```text
activations[9].audiences[0]: valoare custom
„Public regional și vizitatori de weekend”, fără cod de nomenclator.
```

Nu s-a modificat date demo deoarece etapa interzice acest lucru.

Pentru Etapa 3 trebuie decis dacă:

1. segmentul devine element oficial în nomenclatorul Audience; sau
2. `Activation.audiences` permite explicit și segmente custom, separat de `audience_segment_id`.

## 20. Ce trebuie preluat în Etapa 3 DB/backend

Schema DB trebuie să respecte următoarele decizii demonstrate de v13.2:

1. UUID intern DB separat de `external_key`.
2. Program/Objectiv/Pilon/Audience etc. devin entități/nomenclatoare cu `code` stabil și `label` configurabil.
3. Elementele utilizate istoric se dezactivează, nu se șterg fizic.
4. Strategic/catalog snapshots vor trece din bundle în repositories/API proprii.
5. `OMD_DATA_PACKAGE v1` rămâne contractul de import/export pentru STORED data.
6. Monitoring are contract separat și stocare separată.
7. Importul backend trebuie să fie tranzacțional și să păstreze același comportament Merge / Replace / validation / preview.
8. Trebuie introdus un `ImportBatch` persistent pentru istoric și audit.
9. Viitorul script Word → JSON trebuie să producă acest contract, nu să scrie direct în DB.

## 21. Livrabile

- `OMD-Valea-Jiului-prototip_data_portability_v13_2.html`
- `OMD_DATA_PACKAGE_SCHEMA_v1.json`
- `OMD_DATA_PACKAGE_SAMPLE_v1.json`
- `DATA_PORTABILITY_REPORT.md`
- `DATA_PORTABILITY_TEST.py`

## 22. Concluzie

Etapa 2.5 este pregătită pentru freeze înainte de proiectarea bazei de date.

Contractul demonstrează că datele canonical pot fi scoase din mecanismul local de persistență, validate, reconstruite și actualizate fără duplicate, fără a transporta date derivate sau rezultatele de monitorizare. Următoarea etapă poate proiecta schema DB pornind de la acest contract și de la modelul canonical existent, fără a mai depinde de structura `localStorage`.
