# Administrare → Strategie — specificație de referință

**Stare:** propunere, în așteptarea aprobării · **Data:** 18.08.2026

Completarea secțiunii de administrare a reperelor strategice, față de
`FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md` §15 și §35.1.4.

Documentul acesta ține **modelul și regulile**. Execuția e împărțită în două:

- [`TASK-1_backend-strategie.md`](TASK-1_backend-strategie.md) — API, reguli de
  business, teste de API și de bază de date;
- [`TASK-2_ui-strategie.md`](TASK-2_ui-strategie.md) — tabelele, cele patru
  acțiuni, formularele, teste de UI.

Task 2 depinde de Task 1. Nimic nu e implementat încă.

---

## 1. Decizii luate

| Subiect | Decizie |
|---|---|
| Editarea codului | permisă doar cât reperul e nefolosit **și** neatins de import |
| Formatul codului | liber — se validează, nu se transformă |
| Sortarea după cod | doar afișare în Admin; `sort_order` rămâne neatins |
| Versiune nouă | se poate clona dintr-o versiune existentă |
| Relații program ↔ obiectiv | editabile în fișa programului |
| Plasare | în Administrare, nu pe ecranul operațional (abaterea D-002) |

---

## 2. Modelul de consistență între versiuni

Nu se schimbă nimic aici — se documentează ce există deja, pentru că restul
specificației se sprijină pe el.

1. **Legătura e prin UUID, nu prin cod.** `campaign_programs.program_id →
   strategic_programs.id`. Codul e o etichetă locală versiunii.
2. **`UNIQUE (strategy_version_id, code)`** pe piloni, programe și obiective.
   `OS2` poate exista în două versiuni ca două rânduri distincte.
3. **Rezolvarea codurilor e scoped pe versiunea campaniei:**
   `WHERE strategy_version_id = ? AND code = ? AND is_active = 1`. La editare se
   folosește versiunea campaniei existente, nu cea activă. O campanie nu poate
   ajunge să pointeze la un reper din altă versiune, nici din UI nici prin API.
4. **FK `ON DELETE RESTRICT`** peste tot — plasa de siguranță sub verificările de
   dependențe făcute în backend.
5. **Importerul (§33.4.1)** creează reperele în versiunea nouă, nu atinge
   versiunea veche, și lasă versiunea nouă `DRAFT` cât timp există una `ACTIVE`.

Cine referențiază fiecare reper — baza verificărilor de ștergere:

| Reper | Referințe de business | Referințe interne |
|---|---|---|
| Pilon | `campaigns.pillar_id`, `activations.pillar_id` | — |
| Program | `campaign_programs.program_id` | `strategic_program_objectives.program_id` |
| Obiectiv | `campaign_objectives.objective_id` | `strategic_program_objectives.objective_id` |

**Referințele interne nu blochează ștergerea.** Relațiile din matrice aparțin
reperului și se șterg în aceeași tranzacție; dependency preview le arată separat,
ca informare, nu ca blocaj. Doar referințele de business produc
`409 ENTITY_IN_USE`.

---

## 3. Codul unui reper

**Este dată de intrare, nu identificator generat.** Nimic din aplicație nu îl
produce:

- contractul JSON: `programItem.code` este `{"type":"string","minLength":1}`;
  în toată schema nu există niciun `pattern`;
- baza de date: `code VARCHAR(64) NOT NULL`, fără default, fără trigger;
- backendul: `newExternalKey()` generează doar `camp-…`, `activation-…`,
  `material-…`, `kpi-…`, `asset-…`, `template-…`. Reperele nu trec pe acolo.

`P5.1` vine din matricea strategică a beneficiarului, prin
`strategicData.programs[].code`. E convenția documentului lor, nu a aplicației.

### 3.1. Reguli de validare

| Regulă | Sursă |
|---|---|
| nevid după `trim()` | schema JSON `minLength: 1` |
| maximum 64 de caractere | `VARCHAR(64)` |
| unic în interiorul versiunii | `UNIQUE (strategy_version_id, code)` |
| stabil odată folosit sau importat | §4.1 |

**Fără transformare automată** — fără `toUpperCase()`, fără înlocuiri de
caractere, fără normalizare. Aplicația validează, nu rescrie. Un `toUpperCase()`
ar rescrie tăcut un cod pe care autorul l-a vrut altfel.

Convenția poate diferi de la o versiune la alta: `P5.1`…`P5.8` în 2026–2028 și
`D6.1`…`D6.9` în 2029–2033 coexistă fără conflict, fiindcă unicitatea e per
versiune iar campaniile se leagă prin UUID.

### 3.2. Ajutor de convenție în UI

Sub câmpul `Cod`, la creare, un text construit din codurile existente ale
versiunii: *„Convenția folosită în această versiune: P5.1, P5.2, …”*.

Nu blochează nimic. Semnalează doar dacă cineva introduce `D6.1` într-o versiune
care folosește `P5.x` — util când lucrează mai multe persoane, inofensiv altfel.

---

## 4. Reguli de business

### 4.1. Când e codul editabil

```text
codeEditable = businessRefs == 0  AND  importTouched == false
```

`importTouched` = există o linie în `import_batch_items` cu `entity_id` = UUID-ul
reperului. Verificarea e pe UUID, nu pe cod, deci rămâne corectă când același cod
apare în mai multe versiuni.

**De ce nu mai permisiv.** Codul e cheia de matching la import (§33.5: *„code
existent → folosește recordul DB”*). Dacă `P5.3` e redenumit iar mai târziu se
importă un pachet real care încă îl conține, importerul nu-l mai găsește și
creează un al doilea program — al doilea import încetează să fie idempotent,
ceea ce §32 și §57 cer explicit.

### 4.2. Ștergere vs dezactivare

Conform matricei §35.1.4, fără interpretare:

| Situație | Ștergere | Dezactivare |
|---|---|---|
| Reper cu 0 referințe de business | da, fizică | da |
| Reper referit de campanii/activări | nu → `409` | da |
| Versiune `DRAFT` fără campanii | da, ADMIN | — |
| Versiune referită | nu → `409` | `ARCHIVE` |

### 4.3. Clonarea la versiune nouă

Copiază, într-o singură tranzacție: piloni, programe, obiective — **UUID-uri
noi**, aceleași coduri, aceleași texte, același `sort_order`, același
`is_active` — și `strategic_program_objectives`, remapate pe UUID-urile noi.

Nu se copiază campanii, activări, planuri sau monitorizare.

Versiunea nouă e `DRAFT` dacă există deja una `ACTIVE`, `ACTIVE` dacă e prima
din bază — aceeași semantică pe care o aplică importerul (§33.4.1).

### 4.4. Relații program ↔ obiectiv

- doar obiective din **aceeași versiune** (§15.3);
- se trimit ca `objectiveCodes: string[]` în body-ul programului;
- backendul înlocuiește rândurile pentru acel program, în aceeași tranzacție cu
  restul câmpurilor;
- un cod inexistent în versiune → `422`, fără scriere parțială;
- ordinea din listă devine `sort_order` în matrice.

### 4.5. Sortarea

Sortare **naturală** pe cod: `P5.10` după `P5.2`, nu între `P5.1` și `P5.2`.
Comparație pe segmente numerice, nu `localeCompare` simplu. Funcționează pentru
orice prefix — `D6.2` înaintea lui `D6.10`.

Strict de afișare, în starea componentei. `sort_order` din baza de date nu se
atinge, deci ordinea din ecranul `Repere strategice` rămâne cea din matricea
strategică.

---

## 5. Ce NU se schimbă

- Ecranul `Repere strategice` rămâne read-only pentru toate rolurile și identic
  la pixel cu prototipul v13.3.
- Contractele JSON, external keys, schema DB — nicio modificare. Toate
  endpointurile noi lucrează pe tabelele existente.
- `sort_order` nu devine editabil în aceste două task-uri.
- Regula „exact o versiune `ACTIVE`” rămâne service-level (§15.4).

---

## 6. Abateri

Nicio abatere nouă. Punctele acoperite sunt cerute de spec și lipseau: `Adaugă`
(§15.3), ștergerea reperelor nefolosite (§35.1.4), `PUT` pe versiune (§15.4),
arhivarea explicită (§15.1), editarea relațiilor program ↔ obiectiv (§15.3),
dependency preview (§35.1.3).

Clonarea versiunii (§4.3) nu e în spec, dar nu o contrazice: produce exact
starea pe care ar produce-o un import cu `strategyVersion` nou.

D-002 rămâne cum e — plasarea în Administrare, nu pe ecranul operațional.

---

## 7. Micro-decizii, cu valorile propuse

1. **Iconițe** — caractere Unicode, ca restul aplicației (`⌘ ◫ ▶ ▣ ◌ ◎`), nu o
   bibliotecă de icoane. Zero dependențe noi, aceeași greutate vizuală.
2. **Codul la creare** — validare, nu transformare (§3.1).
3. **Ștergerea unui obiectiv care apare în matricea unor programe** — permisă,
   cu relațiile șterse în aceeași tranzacție și numărul afișat în dialog.
4. **`Vizualizează`** — panou inline sub rând, nu modal. Se pot ține două fișe
   deschise pentru comparație.
5. **Ordinea implicită** — `sort_order`, ca azi. Sortarea pe coloană se aplică
   peste ea, la cerere.
