# Task 1 — Backend: API complet pentru reperele strategice

**Depinde de:** [`SPEC_ADMIN_STRATEGIE.md`](SPEC_ADMIN_STRATEGIE.md) · **Blochează:** Task 2
**Stare:** propunere, în așteptarea aprobării

Task-ul închide golurile din §15.3, §15.4, §35.1.3 și §35.1.4: crearea și
ștergerea reperelor, editarea metadatelor unei versiuni, arhivarea, previzualizarea
dependențelor, relațiile program ↔ obiectiv, clonarea unei versiuni.

Se poate livra și verifica **fără nicio modificare de UI**.

---

## 1. Fișiere

```text
backend/src/strategy/strategy-routes.ts     extins
backend/src/strategy/strategy-service.ts    nou — reguli de business, testabile
backend/src/strategy/strategy-clone.ts      nou — clonarea unei versiuni
backend/tests/                              nou — prima suită de teste backend
```

`strategy-service.ts` ține logica pură și interogările; rutele rămân subțiri.
Motivul: regulile din §4.1 și §4.2 trebuie testabile fără HTTP.

---

## 2. Endpointuri

Toate `ADMIN`-only, toate scriu în `audit_log`, toate scoped pe versiune.
`:kind` ∈ `pillars` | `programs` | `objectives`.

### 2.1. Repere

```http
POST   /api/v1/strategy/:versionKey/:kind
PUT    /api/v1/strategy/:versionKey/:kind/:code          (există; se extinde)
DELETE /api/v1/strategy/:versionKey/:kind/:code
GET    /api/v1/strategy/:versionKey/:kind/:code/usage
POST   /api/v1/strategy/:versionKey/:kind/:code/toggle-active   (există)
```

**`POST` — creare.** Body: `code` + toate câmpurile tipului; pentru programe,
opțional `objectiveCodes`. `sort_order` = maximul curent + 1. Răspuns `201`.

**`PUT` — editare.** Body-ul poate conține opțional `newCode` (§4.1) și, pentru
programe, `objectiveCodes` (§4.4). Restul câmpurilor rămân obligatorii — `PUT`
înlocuiește toate coloanele pe care le numește.

**`DELETE`.** Ștergere fizică dacă `businessRefs = 0`. Rândurile din
`strategic_program_objectives` care aparțin reperului se șterg în aceeași
tranzacție. Verificarea de dependențe **se repetă în interiorul tranzacției** —
un preview poate fi stale (§35.1.11). Un conflict FK neașteptat se convertește
în `409`, nu `500`. Răspuns `204`.

**`GET .../usage`.**

```json
{ "data": {
  "canDelete": false,
  "canEditCode": false,
  "business": [{ "type": "campaigns", "count": 6 }],
  "internal": [{ "type": "matrice programe", "count": 3 }],
  "importedAt": "2026-08-14T09:12:00.000Z"
} }
```

`importedAt` = cea mai veche linie din `import_batch_items` pentru acel
`entity_id`, sau `null`.

### 2.2. Versiuni

```http
PUT    /api/v1/strategy/versions/:key
DELETE /api/v1/strategy/versions/:key
POST   /api/v1/strategy/versions/:key/archive
POST   /api/v1/strategy/versions                 (există; se extinde)
```

**`PUT`** — `label`, `periodStartYear`, `periodEndYear`, `notes`. `externalKey`
imutabil: e cheia pe care o caută importerul în
`strategicData.strategyVersion.externalKey`. Trimis în body → ignorat, nu eroare.

**`DELETE`** — doar `DRAFT`, fără campanii și fără activări. Reperele versiunii
și relațiile lor se șterg în aceeași tranzacție, fiindcă îi aparțin.

**`POST .../archive`** — trece versiunea în `ARCHIVED`. Refuzat cu `409` dacă
versiunea e chiar cea `ACTIVE`: invariantul „exact una activă” se menține
activând altă versiune, nu golind poziția.

**`POST` creare, extins** cu `cloneFromExternalKey` opțional (§4.3).

### 2.3. Coduri de eroare

| Cod | Când |
|---|---|
| `409 CONFLICT` | cod duplicat în aceeași versiune |
| `409 CODE_LOCKED` | `newCode` pe un reper folosit sau importat |
| `409 ENTITY_IN_USE` | ștergere a unui reper/versiuni cu referințe |
| `409 VERSION_ACTIVE` | ștergere sau arhivare a versiunii `ACTIVE` |
| `422 VALIDATION_ERROR` | cod vid / >64 caractere; `objectiveCodes` din altă versiune |
| `403 FORBIDDEN` | orice scriere de la `EDITOR` sau `VIEWER` |

`ENTITY_IN_USE` respectă contractul din §35.1.2, cu
`details.allowedAction: "DEACTIVATE"`.

---

## 3. Suita de teste

**Runner propus: `node:test`**, built-in în Node 22. Zero dependențe noi, în
linie cu restul stack-ului (mysql2 brut, fără ORM). Închide și golul din
`README_IMPLEMENTATION.md` §3.3, unde `Test framework` e încă „to be selected”.

Testele de bază de date rulează pe `omd_vj_test`, care există deja în tabelul de
medii, împotriva unei baze reale — nu mock (§47).

```bash
cd backend && npm test
```

### 3.1. Unitare — pure, fără DB

| ID | Verifică | Așteptat |
|---|---|---|
| AS-B-U01 | `naturalCompare('P5.2','P5.10')` | negativ — `P5.2` primul |
| AS-B-U02 | `naturalCompare('D6.10','D6.9')` | pozitiv — `D6.9` primul |
| AS-B-U03 | `naturalCompare('PILLAR_1','PILLAR_2')` | negativ |
| AS-B-U04 | `naturalCompare('AB','AA')` | pozitiv — coduri fără cifre |
| AS-B-U05 | `codeEditable(0, false)` | `true` |
| AS-B-U06 | `codeEditable(1, false)` | `false` |
| AS-B-U07 | `codeEditable(0, true)` | `false` |
| AS-B-U08 | validare cod: `''`, `'   '`, 65 de caractere | respinse |
| AS-B-U09 | validare cod: `'D6.1'`, `'p5.9'`, `'A-1'` | acceptate **neschimbate** |

AS-B-U09 e testul care apără regula „validează, nu transforma”.

### 3.2. Bază de date — `omd_vj_test`

| ID | Verifică | Așteptat |
|---|---|---|
| AS-B-D01 | două repere cu același cod în aceeași versiune | respins de `UNIQUE` |
| AS-B-D02 | același cod în două versiuni diferite | ambele acceptate |
| AS-B-D03 | `DELETE` pe un reper referit de o campanie | blocat de FK `RESTRICT` |
| AS-B-D04 | `DELETE` pe o versiune cu campanii | blocat de FK `RESTRICT` |
| AS-B-D05 | clonare: numărul de piloni/programe/obiective | identic cu sursa |
| AS-B-D06 | clonare: numărul de relații program↔obiectiv | identic cu sursa |
| AS-B-D07 | clonare: UUID-urile | toate diferite de ale sursei |
| AS-B-D08 | clonare: codurile | identice cu ale sursei |
| AS-B-D09 | după clonare, campaniile vechi | pointează la UUID-urile vechi |
| AS-B-D10 | `DELETE` reper → rândurile lui din `strategic_program_objectives` | dispar în aceeași tranzacție |
| AS-B-D11 | `DELETE` eșuat la mijloc | rollback complet, zero scrieri parțiale |

### 3.3. API

**Creare**

| ID | Cerere | Așteptat |
|---|---|---|
| AS-B-A01 | `POST` pilon nou, valid | `201`, apare în `GET /strategy` |
| AS-B-A02 | `POST` program nou cu `objectiveCodes` | `201`, relațiile create |
| AS-B-A03 | `POST` cu cod deja existent în versiune | `409 CONFLICT` |
| AS-B-A04 | `POST` cu cod vid | `422` |
| AS-B-A05 | `POST` cu cod de 65 de caractere | `422` |
| AS-B-A06 | `POST` cu `code: "p5.9"` | `201`, stocat exact `p5.9` |
| AS-B-A07 | `POST` cu `code: "D6.1"` într-o versiune cu `P5.x` | `201` — convenția nu se impune |
| AS-B-A08 | `sort_order` la creare | maximul curent + 1 |

**Editare**

| ID | Cerere | Așteptat |
|---|---|---|
| AS-B-A09 | `PUT` cu `newCode`, reper nefolosit și neimportat | `200`, codul schimbat |
| AS-B-A10 | `PUT` cu `newCode`, reper folosit de o campanie | `409 CODE_LOCKED` |
| AS-B-A11 | `PUT` cu `newCode`, reper adus prin import | `409 CODE_LOCKED` |
| AS-B-A12 | `PUT` cu `newCode` deja existent în versiune | `409 CONFLICT` |
| AS-B-A13 | `PUT` program cu `objectiveCodes` schimbate | relațiile înlocuite, nu adăugate |
| AS-B-A14 | `PUT` program cu un `objectiveCode` din **altă** versiune | `422`, zero scrieri |
| AS-B-A15 | `PUT` fără un câmp obligatoriu | `422`, valorile vechi neatinse |

**Ștergere**

| ID | Cerere | Așteptat |
|---|---|---|
| AS-B-A16 | `DELETE` reper cu 0 referințe | `204`, rândul dispărut |
| AS-B-A17 | `DELETE` reper folosit | `409 ENTITY_IN_USE` + `allowedAction: DEACTIVATE` |
| AS-B-A18 | `DELETE` obiectiv prezent în matricea unor programe, fără campanii | `204`, relațiile șterse |
| AS-B-A19 | preview stale: `usage` spune `canDelete`, apoi apare o campanie, apoi `DELETE` | `409` — verificarea se repetă |
| AS-B-A20 | `GET usage` pe reper folosit | `canDelete: false`, `business` populat |
| AS-B-A21 | `GET usage` pe reper importat | `canEditCode: false`, `importedAt` nenul |

**Versiuni**

| ID | Cerere | Așteptat |
|---|---|---|
| AS-B-A22 | `PUT` metadate versiune | `200`, `externalKey` neschimbat |
| AS-B-A23 | `PUT` cu `externalKey` diferit în body | ignorat, `200` |
| AS-B-A24 | `DELETE` versiune `DRAFT` fără campanii | `204`, reperele ei dispărute |
| AS-B-A25 | `DELETE` versiunea `ACTIVE` | `409 VERSION_ACTIVE` |
| AS-B-A26 | `DELETE` versiune cu campanii | `409 ENTITY_IN_USE` |
| AS-B-A27 | `POST archive` pe o versiune `DRAFT` | `200`, status `ARCHIVED` |
| AS-B-A28 | `POST archive` pe versiunea `ACTIVE` | `409 VERSION_ACTIVE` |
| AS-B-A29 | `POST versions` cu `cloneFromExternalKey`, cu una `ACTIVE` deja | `201`, status `DRAFT` |
| AS-B-A30 | `POST versions` cu clonare, pe bază fără versiuni | `201`, status `ACTIVE` |
| AS-B-A31 | `POST versions` cu `cloneFromExternalKey` inexistent | `404` |

**Permisiuni și audit**

| ID | Cerere | Așteptat |
|---|---|---|
| AS-B-A32 | `EDITOR` → oricare `POST`/`PUT`/`DELETE` de mai sus | `403` |
| AS-B-A33 | `VIEWER` → oricare scriere | `403` |
| AS-B-A34 | `EDITOR` → `GET /strategy` și `GET usage` | `200` |
| AS-B-A35 | fiecare scriere reușită | o linie în `audit_log`, acțiune `STRATEGY_CHANGE` |
| AS-B-A36 | `audit_log` la redenumire de cod | conține codul vechi și pe cel nou |

Testele de permisiuni se fac cu cereri directe, nu prin UI (§58).

### 3.4. Regresie

| ID | Verifică | Așteptat |
|---|---|---|
| AS-B-R01 | `npm run test:parity` după toate modificările | 22/22, 0 pixeli |
| AS-B-R02 | reimportul `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json` | idempotent, fără duplicate |
| AS-B-R03 | valorile golden după reimport | 4 piloni, 8 programe, 18 obiective |

AS-B-R02 e testul care leagă regula din §4.1 de motivul ei: dacă cineva relaxează
condiția de editare a codului, acest test cade.

---

## 4. Definition of done

- [ ] cele 9 endpointuri răspund conform §2, cu codurile de eroare din §2.3
- [ ] `strategy-service.ts` conține regulile, testabile fără HTTP
- [ ] `backend/tests/` rulează cu `npm test` pe `omd_vj_test`
- [ ] toate testele din §3 trec
- [ ] `README_IMPLEMENTATION.md` — `Test framework` completat cu valoarea aleasă
- [ ] `docs/API_OPENAPI.yaml` — endpointurile noi documentate, dacă fișierul
      există până atunci; altfel se notează ca restanță
- [ ] nicio modificare în `frontend/`
