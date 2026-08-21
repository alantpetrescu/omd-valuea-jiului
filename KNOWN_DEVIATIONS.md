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
- the scoping is reversible: splitting on `::` recovers the contract id, so an
  exporter can reproduce the original payload.

The reverse helper is `contractKpiId()`, in
`backend/src/activations/activation-import.ts` and in
`backend-php/src/Activations/ActivationImport.php`. **It has no caller in either
backend**, because there is no activation exporter yet — the only export path is
`campaign-export.ts`. The round trip is therefore possible by construction but
not yet exercised, and this line previously claimed it was. Whoever writes the
activation exporter must call it; without that, exported KPI ids would carry the
`<activationExternalKey>::` prefix and no longer match the contract.

Both backends implement the scoping identically. Verified by importing the four
DEMO_SEED packages into two empty databases, one through each backend: 78 KPI
rows on both sides, and no content difference anywhere in the 41 tables.

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

---

## D-003 — The strategy admin API and its tests are PHP, not Node

**Where:** `backend-php/src/Strategy/`, `backend-php/tests/`

`TASK-1_backend-strategie.md` §1 names `backend/src/strategy/strategy-service.ts`,
`strategy-clone.ts` and a `node:test` suite under `backend/tests/`. All of it was
written against `backend-php/` instead.

**Why.** The Node backend is no longer the one being developed; the PHP port is
what the frontend runs against and what the cPanel deployment ships. Adding nine
endpoints and forty tests to a backend nobody starts would have produced code
that cannot be exercised, and left the behaviour the specification asks for
absent from the application that actually serves it.

The rules and the endpoint contract are unchanged: same nine routes, same error
codes, same `usage` payload. What moved is the language and, with it, the test
runner — `node:test` cannot drive a PHP application, so the suite is a
dependency-free PHP runner in the same spirit (no Composer, nothing to install):

```powershell
cd backend-php
php tests/run.php
```

It refuses to start against any database whose name does not end in `_test`, and
every mutating case works inside a scratch strategy version it creates and drops,
so the seeded 4 pillars / 8 programmes / 18 objectives survive the run — asserted
at the end as AS-B-R03.

**Two cases moved from the API table to the unit table.** AS-B-A30 (a first
strategy version is created `ACTIVE`) and AS-B-D11 (a delete that fails midway
rolls back) cannot be reached through HTTP on a populated database: the first
needs a database with no versions at all, which campaigns make impossible, and
the second needs the dependency check to pass while the delete then fails —
which the endpoint prevents by re-checking inside the transaction. Both are
asserted directly instead, on `statusForNewVersion()` and on real SQL.

---

## D-004 — The code of a strategic reper is now editable, under conditions

**Where:** `backend-php/src/Strategy/StrategyService.php`,
`frontend/src/features/admin/StrategyReperForm.tsx`

Earlier the code was never editable, and the UI did not show the field at all.
`SPEC_ADMIN_STRATEGIE` §4.1 replaces "never" with a rule: editable while the
reper has no business references **and** no import has ever written it.

The field is now always visible — read-only with the reason underneath when the
rule says no ("folosit în 6 campanii", "adus prin importul din 14.08.2026"). A
hidden field says nothing; a greyed one with an explanation says why.

The strictness is not caution for its own sake. The code is what the importer
matches on (§33.5): rename `P5.3` here, re-import a package that still calls it
`P5.3`, and the importer creates a second programme — the second import stops
being idempotent, which §32 and §57 require it to be.

---

## D-005 — `/admin` explains itself to non-administrators

**Where:** `frontend/src/features/admin/AdminPage.tsx`

The `Administrare` link is hidden for EDITOR and VIEWER, but the route was not
guarded. Anyone arriving by bookmark or typed URL got the full screen, every
tab's request came back `403`, and the page filled with error notes that read
like a broken application.

It now renders a single sentence saying the section is for administrators, and
makes no requests. Covered as AS-U-37 / AS-U-38.

---

## D-006 — Nomenclatoarele urmează aceeași regulă de cod ca reperele

**Where:** `backend-php/src/Shared/CodeIdentity.php`,
`backend-php/src/Admin/AdminRoutes.php`,
`frontend/src/features/admin/AdminPage.tsx`

Codul unei valori de nomenclator era imutabil necondiționat: `updateValue` scria
doar `label`, `display_label`, `hint` și `sort_order`, iar interfața arăta câmpul
`Cod` numai la creare, cu nota „nu se mai poate schimba după creare".

Se aplică acum regula din `SPEC_ADMIN_STRATEGIE` §4.1, cu o condiție în plus:

```text
codeEditable = businessRefs == 0  AND  importTouched == false  AND  isSystem == false
```

`isSystem` nu există la repere. O valoare marcată așa este comparată după cod în
logica aplicației — cele trei stadii de campanie, de pildă — deci redenumirea ei
strică un comportament, nu doar următorul import.

Regula stă într-un singur loc, `CodeIdentity`, iar `StrategyService` o cheamă de
acolo: două ecrane vecine care pun aceeași întrebare nu trebuie să aibă două
răspunsuri.

**Trei lucruri reparate pe drum, toate găsite de teste:**

- `toUpperCase()` rescria codul în timp ce utilizatorul îl tasta — exact
  transformarea pe care §3.1 o interzice. Convenția e acum sugerată sub câmp,
  construită din codurile deja existente în nomenclator.
- `nullableString('code', 100)` trunchia la 100 de caractere într-o coloană
  `VARCHAR(64)`, deci un cod lung era tăiat pe tăcute la ceva ce autorul nu
  scrisese. Validarea comună îl refuză cu `422`.
- `activation_channels` este `UNIQUE` și pe `label`; duplicatul ieșea ca `500`.
  Acum e `409`, cu mesajul care spune care câmp a intrat în coliziune — codul sau
  denumirea. Numele indexului decide; a ghici din numărul erorii ar fi dat vina
  pe câmpul greșit.

**Ce nu s-a schimbat:** etichetele de dependență din contract (`CAMPAIGN`,
`ACTIVATION`, `ACTIVATION_MATERIAL`) rămân cum sunt în răspunsul
`409 ENTITY_IN_USE` (§35.1.2); traducerea lor în română se face în interfață.

**Câmpul închis este `disabled`, nu `readonly`.** Un input `readonly` păstrează
cursorul de text, primește focus și arată exact ca unul editabil, așa că singurul
lucru care spunea că e închis era propoziția de sub etichetă. `disabled` o spune
în control, înainte ca cineva să încerce să scrie. Costul e că iese din ordinea
de tabulare — de aceea motivul e randat mereu în etichetă, vizibil fără focus,
nu într-un `title` sau într-un mesaj de validare.

---

## D-007 — Un al doilea set de migrații, pentru MariaDB

**Where:** `database/migrations-mariadb/`, `backend-php/src/Database/Dialect.php`,
`backend-php/bin/generate-mariadb-migrations.php`

Schema vine din `02_DATABASE/MYSQL_SCHEMA_BLUEPRINT.sql` și declară
`utf8mb4_0900_ai_ci` în 40 de locuri. Colația e UCA 9.0 și există exclusiv în
MySQL 8.0+. A doua gazdă rulează MariaDB 10.11.18, care o refuză cu
`1273 Unknown collation` — la conectare, înainte de prima migrație.

Aplicația citește acum versiunea serverului și alege singură setul de migrații și
colația conexiunii. Setul MariaDB e generat din cel MySQL printr-o substituție,
nu întreținut separat; `--check` și testele AS-D-03…D08 verifică la fiecare
rulare că nu s-au depărtat.

**Colația aleasă: `utf8mb4_unicode_520_nopad_ci`.** Singura de pe acel server
care e, ca originalul, insensibilă la diacritice, insensibilă la majuscule și
NO PAD. Colațiile UCA 14.0.0 din MariaDB 10.10+ ar fi fost mai apropiate, dar
lipsesc din build-ul CloudLinux — verificat în `information_schema.COLLATIONS`.

**Checksum-urile diferă între cele două familii,** fiindcă sunt fișiere diferite.
Contează doar dacă o bază migrată pe un motor ar fi verificată cu setul
celuilalt, ceea ce nu i se poate întâmpla unei singure gazde.

**Un defect găsit tot aici.** `Preflight` verifica versiunea cu
`version_compare($version, '8.0', '>=')`. MariaDB raportează `10.11.18-MariaDB`,
iar 10 e mai mare decât 8 — deci verificarea spunea `[OK]` pe exact serverul care
nu putea rula schema, iar instalarea eșua două pași mai încolo. MariaDB e
recunoscută acum după nume. Testul AS-D-02 păstrează capcana scrisă negru pe alb.

