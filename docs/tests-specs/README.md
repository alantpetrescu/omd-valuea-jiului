# Suita de teste — specificația-mamă

**Stare:** implementată · **Data:** 22.08.2026

Documentul acesta ține **structura, regulile și indexul**. Cazurile propriu-zise
sunt în cele două sub-specificații:

- [`BACKEND.md`](BACKEND.md) — API, reguli de business, schemă, importuri
- [`FRONTEND.md`](FRONTEND.md) — funcții pure, ecrane, paritate vizuală

Testele hibride sunt definite aici, în §5, fiindcă nu aparțin niciuneia dintre
cele două.

---

## 1. Ce acoperă și ce nu

Suita verifică aplicația așa cum e livrată: **backendul PHP** și **frontendul
React**. Backendul Node nu mai e dezvoltat și nu e testat.

| nu se testează                | de ce                                                              |
| ----------------------------- | ------------------------------------------------------------------ |
| backendul Node din `backend/` | abandonat; testele lui ar fi cod pe care nimeni nu-l rulează       |
| conținutul pachetelor JSON    | sunt date ale beneficiarului, nu comportament al aplicației        |
| Apache și `.htaccess`         | serverul PHP încorporat nu le citește; §4.4 explică ce se emulează |
| trimiterea de e-mail          | aplicația nu trimite                                               |

---

## 2. Cele trei feluri de test

| fel          | ce pornește                                                                 | ce dovedește                                                                            |
| ------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| **backend**  | server PHP + `omd_vj_test`                                                  | că API-ul răspunde corect și că regulile de business chiar sunt reguli                  |
| **frontend** | Node pentru funcțiile pure; Vite + mock API pentru Administrare și paritate | că aritmetica e corectă și că ecranele de administrare arată și se comportă cum trebuie |
| **hibrid**   | Vite + server PHP + `omd_vj_test`                                           | că cele două chiar funcționează **împreună**                                            |

Al treilea nu e lux. Frontendul se testează pe un mock, backendul pe HTTP — dar
până acum nimic nu verifica dacă ce trimite unul e ce așteaptă celălalt. Un câmp
redenumit într-o parte trecea prin ambele suite fără să clipească. Prima rulare a
parcursurilor a găsit exact așa ceva: fișa unei campanii numește tipul `typeCode`,
iar contractul de scriere îl cere ca `campaignTypeCode`.

**Regula de repartizare**, ca să nu ajungem cu același caz în două locuri:

- ține de o valoare calculată sau de un răspuns HTTP → **backend**;
- ține de ce vede sau apasă omul, și poate fi decis cu date fixe → **frontend**;
- are nevoie de amândouă ca să însemne ceva → **hibrid**.

Un caz care poate fi scris ca test de backend **se scrie ca test de backend**.
Sunt mai rapide, eșuează mai precis, și nu depind de un browser.

**O corecție față de prima versiune a acestei specificații.** Ecranele
operaționale — campanii, activări, plan anual, monitorizare — erau prevăzute în
suita de frontend. Nu pot sta acolo: citesc date pe care mock-ul nu le are, iar
ca să le testăm pe el ar trebui să-l facem un al doilea backend — o implementare
pe care n-o exercită nimic altceva și care se depărtează în tăcere de cea
adevărată. Rulează în `tests/hybrid/screens.spec.mjs`, în regim de citire, și
și-au păstrat ID-urile `F-*`: ce verifică e tot forma ecranului.

---

## 3. Numerotarea

Prefixele existente rămân — sunt citate în `TASK-1`, `TASK-2` și
`SPEC_ADMIN_STRATEGIE`, iar renumerotarea ar rupe trasabilitatea fără să câștige
nimic.

| prefix    | domeniu                                   | sursă               |
| --------- | ----------------------------------------- | ------------------- |
| `AS-B-*`  | repere strategice, API                    | TASK-1 §3           |
| `AS-C-*`  | identitatea codului la nomenclatoare      | BACKEND.md §4.6     |
| `AS-D-*`  | dialect MySQL/MariaDB, seturi de migrații | BACKEND.md §1.4, §2 |
| `AS-K-*`  | cascada stadiului campanie → activări     | BACKEND.md §4.5     |
| `AS-U-*`  | interfața de administrare                 | TASK-2 §3           |
| **`B-*`** | domenii noi de backend                    | BACKEND.md §4       |
| **`F-*`** | funcții pure și ecrane                    | FRONTEND.md         |
| **`H-*`** | parcursuri hibride                        | §5 de aici          |

Un ID nu se refolosește niciodată. Dacă un caz dispare, numărul lui rămâne
consumat — altfel un eșec dintr-un log vechi trimite la alt test decât cel care
a picat atunci.

---

## 4. Structura pe disc

```
tests/
├── run.ps1                  comanda unică; rulează toate trei, în ordine
├── seed.ps1                 o dată: omd_vj_test cu migrațiile și pachetele demo
├── shared/
│   ├── harness.php          runner, client HTTP, aserțiuni, curățenie
│   ├── config.mjs           porturi, căi, stările de paritate
│   ├── deps.mjs             playwright, pngjs, pixelmatch — din frontend/
│   └── mock-api.mjs         API-ul fals pentru suita de frontend
├── backend/
│   ├── run.php              unit, database, auth, roles, api, campaigns,
│   │                        activations, catalogs, imports, monitoring,
│   │                        files, contract, dialect, cascade, regression
│   └── *.php                un fișier per domeniu
├── frontend/
│   ├── run.ps1
│   ├── unit.mjs             funcțiile pure, fără browser
│   ├── admin-*.spec.mjs     Administrare → Strategie
│   ├── role-gate.spec.mjs
│   ├── stale-api.spec.mjs
│   └── visual-parity/       stage, serve, capture, compare
└── hybrid/
    ├── run.ps1
    ├── ensure-users.php     cele trei conturi
    ├── cleanup.php          ce nu se poate șterge prin API
    ├── screens.spec.mjs     ecranele operaționale, în regim de citire
    └── journeys.spec.mjs    H-01…H-07
```

Suitele vechi s-au mutat aici. `backend-php/tests/` și `frontend/tests/` nu mai
există, iar `package.json` și cele două runbook-uri de deploy trimit la noua
comandă. Motivul e cel pe care l-am plătit deja de câteva ori: două locuri care
afirmă aceeași regulă se depărtează, iar cel care se depărtează în tăcere e cel
care nu se rulează.

`tests/shared/deps.mjs` merită o vorbă. Suitele n-au `node_modules` propriu și nu
trebuie să capete unul: al doilea lockfile înseamnă a doua listă de versiuni și o
zi în care testele rulează alt Playwright decât cel cu care e construită
aplicația. Se rezolvă din `frontend/package.json`, adică exact ce rezolvă și
aplicația.

### 4.1. Bugetul de timp

**Sub 5 minute, totul.** E pragul de la care o suită chiar se rulează după
fiecare modificare, nu doar înainte de livrare. `run.ps1` măsoară și spune când
îl depășește.

Ultima rulare completă: **186 de secunde** — 9s backend, 126s frontend (din care
79 paritatea vizuală), 51s hibrid.

De aici vine repartizarea: acoperire largă la backend, unde un caz costă
milisecunde, și un număr restrâns de parcursuri hibride, alese pentru fluxurile
care chiar se rup.

### 4.2. Baza de date

Toate testele care scriu folosesc **`omd_vj_test`**. Atât `shared/harness.php`
cât și cele două runnere PowerShell refuză să pornească pe o bază al cărei nume
nu se termină în `_test` — testele astea creează, redenumesc și șterg, iar
îndreptate spre staging ar strica muncă reală.

Se pregătește o singură dată:

```powershell
pwsh tests/seed.ps1
```

Migrațiile plus cele patru pachete demo. Fără pachetul de activări și cel de
monitorizare, o parte din suită n-ar avea ce verifica — iar un test care n-are ce
verifica **pică**, cu mesajul care spune ce lipsește. Nu trece ca „sărit": o
linie verde care înseamnă „n-am găsit nimic de făcut" e mai rea decât una roșie.

Fiecare grup care scrie își face propriile date și le șterge la final.
`Harness::cleanup()` află singur, din `information_schema`, ce tabele au chei
străine către cea pe care o șterge — relațiile sunt `ON DELETE RESTRICT` peste
tot, deci un părinte nu poate pleca până nu pleacă și copiii. O listă scrisă de
mână ar merge azi și ar fi greșită la prima tabelă nouă, adică exact eșecul pe
care nu-l observă nimeni: curățenia care încetează tăcut să curețe.

Parcursurile hibride își marchează tot ce creează cu prefixul `[QA]` în titlu, iar
`cleanup.php` șterge **numai** după marcajul acela. O versiune anterioară căuta
cuvinte ca „hibrid" — ceea ce ar fi mers până în ziua în care cineva numea așa o
campanie adevărată.

### 4.3. Izolarea

Nicio suită nu presupune ordinea în care rulează alta. Un test care are nevoie
de o campanie și-o creează; unul care are nevoie de o activare încheiată o
creează cu datele explicite, nu speră ca vreuna din fixture să fie în trecut.

**Porturile sunt verificate înainte de pornire**, nu după. Vite răspunde „Port N
is in use, trying another one..." și se mută tăcut pe următorul liber; tot ce
urmează întreabă portul pe care îl știe, primește răspuns de la ce a rămas acolo
din rularea trecută, și raportează rezultate despre o aplicație pe care n-a
pornit-o nimeni. S-a întâmplat: zece servere rămase în viață țineau `:5175`–`:5184`,
iar suita vorbea cu cel mai vechi dintre ele. Acum fiecare runner se oprește cu
numele procesului și PID-ul, iar Vite pornește cu `--strictPort`.

### 4.4. Ce nu se poate proba local

`.htaccess` nu e citit de serverul PHP încorporat. Rescrierea SPA, refuzul
execuției în `uploads/` și rutarea `/api` sunt emulate de front controller și de
proxy-ul Vite. Suita dovedește că **aplicația funcționează în spatele lor**; că
Apache le aplică la fel rămâne de verificat la instalare, iar runbook-urile spun
unde.

---

## 5. Testele hibride

Pornesc frontendul, serverul PHP real și `omd_vj_test`, apoi conduc un browser
prin parcursuri complete.

**Ce justifică un parcurs hibrid.** Un caz intră aici doar dacă eșuează _doar_
când cele două părți sunt puse împreună. Trei tipare:

1. **Contractul dintre ele** — un câmp redenumit, un cod de eroare schimbat, o
   formă de răspuns care nu mai se potrivește.
2. **Un efect care traversează** — o acțiune care schimbă alte înregistrări decât
   cea atinsă.
3. **Un fișier scris de una și servit de cealaltă** — imaginile din import.

| ID     | parcurs                                                                                                    | ce s-ar rupe fără el                                               |
| ------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `H-01` | autentificare cu parolă temporară → ecranul obligatoriu, fără scăpare → schimbarea parolei → campanii      | contractul de sesiune, redirectul forțat, și golirea flagului după |
| `H-02` | creare campanie → apare în listă → câmpurile care nu se văd sunt totuși în bază                            | maparea formularului pe cele 25 de câmpuri ale scrierii            |
| `H-03` | campanie `Activă` → `Draft` → **ambele** activări coboară; înapoi `Activă` → urcă **doar** cea neîncheiată | cascada, cu asimetria ei, văzută din API                           |
| `H-04` | vizual scris de importator → servit din `/uploads/` → cu tipul corect și octeții lui                       | fișierul scris de backend și servit ca resursă statică             |
| `H-05` | valoare de nomenclator nouă → redenumire → folosire → eticheta se schimbă, codul nu                        | regula de identitate a codului, cap-coadă                          |
| `H-06` | două sesiuni pe aceeași campanie → a doua salvare primește `409 STALE_VERSION`                             | concurența optimistă, singurul mod în care se poate proba          |
| `H-07` | `EDITOR` și `VIEWER` pe `/admin` și pe scrierile din API                                                   | poarta de rol, în interfață și în API deodată                      |

`H-03` a fost corectat față de prima versiune a specificației, care spunea
„activările ei coboară, iar cea încheiată nu". Nu e așa, și e mai bine așa cum e:
**coborârea ia tot** ce era activ — o campanie în Draft n-are nimic în desfășurare
sub ea, orice ar spune datele. Asimetria e la **revenire**: se ridică doar
activarea care mai are timp, fiindcă a pune înapoi pe „Activă" una încheiată acum
doi ani ar afirma că se lucrează la ea.

`H-06` are nevoie de două sesiuni separate, nu de două file — sesiunea stă
într-un cookie.

---

## 6. Cum se rulează

```powershell
cd D:\Florian\omd-valea-jiului

pwsh tests/seed.ps1                    # o singură dată
pwsh tests/run.ps1                     # tot, în ordine
pwsh tests/run.ps1 -SkipParity         # fără cele 22 de capturi
pwsh tests/run.ps1 -Only backend
pwsh tests/run.ps1 -Only frontend
pwsh tests/run.ps1 -Only hybrid
```

Fiecare suită acceptă și filtre proprii:

```powershell
php tests/backend/run.php auth roles
pwsh tests/frontend/run.ps1 -Only parity
pwsh tests/hybrid/run.ps1 -Only journeys
```

Ieșirea e o linie per verificare, cu ID-ul în față, și un total la final. Codul
de ieșire e 0 sau 1 — suficient pentru un `if` în orice script.

**Precondiții:** MySQL sau MariaDB cu `omd_vj_test` (vezi `seed.ps1`), PHP 8.1+,
Node 20+ cu `pnpm install` făcut în `frontend/`, browserul Playwright instalat
(`npx playwright install chromium`), și pachetul de predare
`programmer_full_package_FINAL` lângă depozit — de acolo vin prototipul v13.3 și
pachetele demo.

---

## 7. Ce înseamnă „trece"

O rulare verde înseamnă exact atât: **regulile scrise în cele două
sub-specificații se comportă cum spun ele acolo.** Nu înseamnă că aplicația e
corectă — înseamnă că ce am înțeles despre ea e încă adevărat.

De aceea fiecare caz spune _ce s-ar rupe fără el_. Un test care nu poate răspunde
la întrebarea asta e un test care va fi șters de cineva peste un an, pe bună
dreptate.

Și de aceea specificațiile astea au fost corectate **după** ce testele au fost
scrise, nu doar înainte. Cinci lucruri pe care le presupuneau s-au dovedit
neadevărate la prima rulare — ordinea importului, codul limitatorului, forma
cheii externe la creare, ce întoarce `getTemporalSituation`, și direcția cascadei.
Fiecare e acum trecut acolo unde a fost greșit, cu ce e în loc.
