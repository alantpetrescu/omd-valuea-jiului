# Instalare pe cPanel — descoperavaleajiului.ro/app

> **Una din două instalări.** Aceasta e a doua, pe MariaDB și PHP 8.4. Pentru
> `visitvaleajiului.ro`, care rulează MySQL 8 și PHP 8.1, folosește
> [`DEPLOY-CPANEL-visitvaleajiului.md`](DEPLOY-CPANEL-visitvaleajiului.md).
> Codul e identic; diferă gazda.

| | |
|---|---|
| cont cPanel | `descoper` |
| domeniu | `descoperavaleajiului.ro` |
| bază de date | `descoper_omd_vj_staging`, utilizator `descoper_omd_app` |
| PHP | **8.4.24** |
| server de baze | **MariaDB 10.11.18-cll-lve** |
| set de migrații | **`database/migrations-mariadb/`** |

Frontendul ajunge la `https://descoperavaleajiului.ro/app`, API-ul la
`/api/v1/...`, imaginile la `/uploads/...`.

**Cele trei lucruri care diferă față de prima instalare**, și care sunt exact
cele care au consumat timp la a doua:

1. serverul e MariaDB, deci rulează alt set de migrații (pasul 1.5);
2. numele contului **nu** e ce sugerează prefixul bazelor de date (pasul 4);
3. utilizatorul bazei trebuie *adăugat pe bază*, nu doar creat (pasul 2).

---

## 0. Înainte să începi

| | |
|---|---|
| Acces cPanel | File Manager, MultiPHP Manager, MultiPHP INI Editor, MySQL Databases, phpMyAdmin |
| Terminal | **nu e necesar** — instalarea se face dintr-un URL protejat |
| Node.js pe gazdă | **nu e necesar** — frontendul se construiește pe calculatorul tău |
| Pe calculatorul tău | Node 20+, pnpm, PHP 8.1+ și proiectul |
| Pachetele JSON | cele 4 fișiere din `04_DEMO_SEEDS/` |

Domeniul trebuie să aibă **Force HTTPS Redirect** activat. E o precondiție, nu o
recomandare: instalatorul refuză să ruleze pe HTTP simplu, ca tokenul să nu
circule în clar.

---

## 1. Versiunea de PHP

**cPanel → MultiPHP Manager** → selectează `descoperavaleajiului.ro` → **8.4** →
Apply.

Nu e nimic de adaptat în cod. Suita de teste (`pwsh tests/run.ps1`, cu
`tests/seed.ps1` rulat o dată înainte) a fost rulată pe **8.1.34** și pe
**8.5.9**, cu `error_reporting=E_ALL`: 137 de verificări trecute pe amândouă,
fără nicio depreciere. 8.5 fiind mai nouă decât 8.4, tot ce s-a depreciat în 8.2,
8.3 și 8.4 ar fi apărut acolo.

Verificat anume: zero parametri implicit nullable — depreciați în 8.4 —, zero
interpolări `${…}`, zero proprietăți dinamice, zero funcții scoase din limbaj.
Ajută și că nu există dependențe: fără Composer, fără `vendor/`, doar biblioteca
standard.

### Extensiile

```
pdo_mysql    mbstring    json    filter
```

Toate patru sunt active implicit pe practic orice cPanel, iar `?action=check` de
la pasul 6 spune exact ce lipsește. Dacă raportează vreuna lipsă, singura soluție
e un tichet la gazdă — pe conturile CloudLinux fără „Select PHP Version" nu ai ce
bifa singur.

Nu ai nevoie de `openssl` sau `fileinfo`. Criptografia folosită (`random_bytes`,
`hash_hmac`, `password_hash`) e în nucleul PHP.

### MultiPHP INI Editor — reține unde e

Nu e obligatoriu acum. Importul e cel mai greu pas, iar dacă expiră, acolo ridici
limitele: **MultiPHP INI Editor → domeniul → Editor de bază**,
`max_execution_time = 300`, `memory_limit = 256M`.

---

## 1.5. MariaDB — setul de migrații

**Aici e diferența de fond față de prima instalare.**

Schema a fost scrisă pentru MySQL 8: fiecare tabel declară `utf8mb4_0900_ai_ci`,
o colație UCA 9.0 care există numai acolo. MariaDB o refuză cu
`1273 Unknown collation` — **chiar la conectare**, deci aplicația nici măcar nu
apucă să spună cu ce server vorbește.

De aceea există două seturi de migrații:

| server | director | colație |
|---|---|---|
| MySQL 8.0+ | `database/migrations/` | `utf8mb4_0900_ai_ci` |
| **MariaDB — cazul tău** | `database/migrations-mariadb/` | `utf8mb4_unicode_520_nopad_ci` |

**Nu trebuie să alegi.** Aplicația citește versiunea serverului și decide singură:
ce colație vorbește conexiunea, din ce director citește `migrate`, în ce colație
își creează tabelul de urmărire. `?action=check` îți arată alegerea pe rândul
**Set de migrații** — verifică-l înainte de `migrate`.

Ce trebuie totuși să faci: **generează setul înainte de a împacheta arhiva.**

```powershell
cd D:\Florian\omd-valea-jiului\backend-php
php bin/generate-mariadb-migrations.php
```

Setul e derivat din cel MySQL printr-o singură substituție, nu întreținut
separat — migrațiile MySQL poartă în antet suma SHA-256 a blueprint-ului și
mențiunea să nu fie editate în loc. Suita de teste verifică la fiecare rulare că
cele două n-au apucat să se depărteze (`AS-D-03…D08`).

### De ce tocmai `utf8mb4_unicode_520_nopad_ci`

`utf8mb4_0900_ai_ci` e insensibilă la diacritice, insensibilă la majuscule și
**NO PAD** — spațiile de la final contează. Pe MariaDB 10.11 o singură colație le
are pe toate trei:

| colație | UCA | spații finale |
|---|---|---|
| `utf8mb4_general_ci` (implicită) | — | PAD SPACE |
| `utf8mb4_unicode_ci` | 4.0.0 | PAD SPACE |
| `utf8mb4_unicode_520_ci` | 5.2.0 | PAD SPACE |
| `utf8mb4_unicode_nopad_ci` | 4.0.0 | NO PAD |
| **`utf8mb4_unicode_520_nopad_ci`** | **5.2.0** | **NO PAD** |

MariaDB 10.10 a adăugat colațiile UCA 14.0.0 (`utf8mb4_uca1400_*`), care ar fi
fost și mai apropiate — dar **lipsesc din build-ul CloudLinux**, chiar la
10.11.18. Citit din `information_schema.COLLATIONS` pe serverul tău, nu presupus.

NO PAD nu e un amănunt: sub PAD SPACE, `'P5.1 '` și `'P5.1'` sunt egale pentru un
index UNIQUE. Motivarea completă e în `src/Database/Dialect.php`.

> Dacă vrei să vezi singur ce colații ai:
>
> ```sql
> SELECT COLLATION_NAME, IS_DEFAULT FROM information_schema.COLLATIONS
>  WHERE CHARACTER_SET_NAME = 'utf8mb4' ORDER BY COLLATION_NAME;
> ```
>
> `PAD_ATTRIBUTE` e o coloană care există doar în MySQL 8 — pe MariaDB
> interogarea eșuează dacă o ceri.

---

## 2. Utilizatorul bazei de date

**cPanel → MySQL Databases → secțiunea „Add User To Database"**:
`descoper_omd_app` → `descoper_omd_vj_staging` → **ALL PRIVILEGES**.

Nu doar SELECT/INSERT/UPDATE/DELETE. Migrațiile execută 41 de `CREATE TABLE`, un
`CREATE VIEW` și 79 de constrângeri `CHECK`, deci contul are nevoie și de
`CREATE`, `ALTER`, `INDEX`, `REFERENCES`, `DROP`.

**A crea utilizatorul nu îl adaugă pe bază.** Sunt două acțiuni separate în
aceeași pagină, iar sărirea celei de-a doua a costat un pas întreg la instalarea
asta. Simptomul e specific și merită reținut:

| eroare | ce înseamnă |
|---|---|
| `1044 Access denied ... **to database**` | parola e corectă, utilizatorul **nu e adăugat pe bază** |
| `1045 Access denied for user` | parolă greșită, sau utilizatorul nu există |

Notează parola — intră în `.env` la pasul 5.

### Colația bazei, nu doar a tabelelor

cPanel creează baza cu colația implicită a serverului, care pe MariaDB e
**`latin1_swedish_ci`**. `?action=check` o raportează ca `[WARN]`.

Nu blochează instalarea: fiecare tabel din migrații își declară explicit
`utf8mb4` și colația lui, iar coloanele o moștenesc de la tabel. Dar rămâne o
capcană — orice tabel creat ulterior fără charset explicit ar ieși `latin1`, iar
un `JOIN` între el și restul ar da „Illegal mix of collations", eroare care sună
a orice altceva decât a cauza ei.

Se rezolvă cu o singură comandă, în **phpMyAdmin → SQL**, înainte de `migrate`:

```sql
ALTER DATABASE `descoper_omd_vj_staging`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_520_nopad_ci;
```

Sau, fără SQL: phpMyAdmin → baza → **Operations** → *Collation* → aceeași
valoare → Go.

Schimbă doar valoarea implicită pentru ce se creează de acum înainte; nu atinge
tabele existente, deci e sigură oricând.

---

## 3. Construiește frontendul, local

```powershell
cd D:\Florian\omd-valea-jiului\frontend
$env:APP_BASE_PATH = '/app/'
pnpm install --frozen-lockfile
pnpm run build
```

`APP_BASE_PATH` e ce face aplicația să funcționeze într-un subdirector: Vite
rescrie fiecare URL de resursă cu el, iar routerul îl citește înapoi din
`import.meta.env.BASE_URL`. Fără el, aplicația caută `/assets/...` la rădăcina
domeniului și vezi o pagină albă.

Verifică înainte să urci:

```powershell
Select-String -Path dist\index.html -Pattern 'src=|href='
```

Toate căile trebuie să înceapă cu `/app/`.

> Rulează în **PowerShell**, nu în Git Bash. Git Bash convertește `/app/` într-o
> cale Windows și build-ul iese cu URL-uri de forma `/Program Files/Git/app/...`.

---

## 4. Structura pe gazdă

### Întâi află numele real al contului

```
cPanel → pagina principală → bara laterală → General Information → Home Directory
```

**Nu-l deduce din prefixul bazelor de date.** Prefixul e doar primele opt
caractere ale numelui de utilizator, deci `descoper_` poate veni de la un cont
numit `descoperavaleajiului`. La instalarea asta, presupunerea a produs un
`require` către un director inexistent, PHP a murit înainte de orice cod al
nostru, iar rezultatul a fost un **500 cu corp gol** — care nu spune nimic.

Restul documentului scrie `/home/descoper`; înlocuiește cu ce arată cPanel.

```
/home/descoper/
├── omd/                          <- NOU, în afara public_html
│   ├── backend-php/
│   ├── contracts/
│   ├── database/
│   │   ├── migrations/           (MySQL — nefolosit aici)
│   │   └── migrations-mariadb/   <- setul care rulează
│   └── storage/
│       ├── import-inbox/         <- CREEAZĂ TU; pachetele JSON, temporar
│       ├── import-temp/          (se creează singur)
│       └── rate-limit/           (se creează singur)
└── public_html/
    ├── app/                      <- frontendul construit
    ├── api/                      <- trei fișiere de legătură
    └── uploads/                  <- imaginile; se creează singur
```

**De ce `omd/` stă în afara `public_html`:** acolo sunt `.env` cu parola bazei,
codul sursă și migrațiile. Singurul lucru expus e `public_html/api/`.

### Arhivele

```powershell
cd D:\Florian\omd-valea-jiului
php backend-php\bin\generate-mariadb-migrations.php   # NU sări peste asta
$stage = Join-Path $env:TEMP 'omd-upload'
Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stage | Out-Null
Copy-Item backend-php, contracts, database -Destination $stage -Recurse
Remove-Item (Join-Path $stage 'backend-php\.env') -Force -ErrorAction SilentlyContinue
$zip = Join-Path $PWD 'omd-backend.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Push-Location $stage; tar.exe -a -c -f $zip backend-php contracts database; Pop-Location
Remove-Item $stage -Recurse -Force
```

```powershell
$zip = Join-Path 'D:\Florian\omd-valea-jiului' 'omd-frontend.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Push-Location D:\Florian\omd-valea-jiului\frontend\dist
tar.exe -a -c -f $zip *
Pop-Location
```

| arhivă | se extrage în |
|---|---|
| `omd-backend.zip` | `/home/descoper/omd/` |
| `omd-frontend.zip` | `/home/descoper/public_html/app/` |

Două detalii care nu sunt stilistice:

- **`tar.exe`, nu `Compress-Archive`.** `Compress-Archive` din PowerShell 5.1
  scrie căile cu backslash în arhivă; dezarhivatorul de pe Linux le ia literal și
  obții un fișier numit `backend-php\src\bootstrap.php` în loc de un arbore.
- **`.env` se scoate din arhivă**, altfel parola bazei tale de dezvoltare ajunge
  pe gazdă. Cel de pe server se scrie la pasul 5.

**Nu urca** `backend/` (backendul Node) și nici `node_modules`.

După extragere verifică trei lucruri:

```
/home/descoper/omd/backend-php/src/bootstrap.php
/home/descoper/omd/backend-php/src/Database/Dialect.php     <- fără el, MariaDB nu merge
/home/descoper/omd/database/migrations-mariadb/001_roles_users.sql
```

### Fișierele de legătură

| din repo | pe gazdă | nume nou |
|---|---|---|
| `deploy/cpanel/api-index.php` | `public_html/api/` | **`index.php`** |
| `deploy/cpanel/api-setup.php` | `public_html/api/` | **`setup.php`** |
| `backend-php/public/.htaccess` | `public_html/api/` | `.htaccess` |
| `deploy/cpanel/app.htaccess` | `public_html/app/` | **`.htaccess`** |
| `deploy/cpanel/uploads.htaccess` | `public_html/uploads/` | **`.htaccess`** |

> **File Manager ascunde fișierele care încep cu punct.** Deschide **Setări**
> (dreapta sus) și bifează **Afișare fișiere ascunse (dotfiles)**, altfel nu vezi
> niciunul dintre cele trei `.htaccess`.

`public_html/api/` trebuie să conțină **exact trei fișiere**: `index.php`,
`setup.php`, `.htaccess`.

Cele două `.php` își **deduc singure** calea către backend din locul în care stau,
deci nu trebuie editate. Dacă totuși ai pus backendul altundeva decât
`<home>/omd/backend-php`, schimbă variabila `$backend` din capul fiecăruia — iar
când calea e greșită, răspunsul îți spune acum unde a căutat, în loc să tacă.

`app/.htaccess` e cel care face ca F5 pe `/app/campaigns` să nu dea 404.
`uploads/.htaccess` oprește execuția de cod în directorul în care aplicația scrie.

---

## 5. Configurația

Generează două secrete **diferite**:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Creează `/home/descoper/omd/backend-php/.env`:

```ini
APP_ENV=production
APP_BASE_URL=https://descoperavaleajiului.ro

APP_SECRET=<primul secret>
AUTH_SECRET=<al doilea secret, diferit>
AUTH_TOKEN_TTL=28800

DB_HOST=localhost
DB_PORT=3306
DB_NAME=descoper_omd_vj_staging
DB_USER=descoper_omd_app
DB_PASSWORD=<parola utilizatorului>

UPLOAD_DIR=/home/descoper/public_html/uploads
IMPORT_TEMP_DIR=storage/import-temp
MAX_UPLOAD_MB=15
MAX_JSON_IMPORT_MB=25

SEED_ADMIN_EMAIL=admin@omd.ro
SEED_ADMIN_NAME=Administrator OMD

LOG_LEVEL=info
LOG_FILE=
TRUST_PROXY=0
```

**`UPLOAD_DIR` e singura cale absolută din fișier** — și singurul loc în care se
poate strecura numele contului vechi dacă copiezi `.env` de la cealaltă
instalare. Verifică-l.

Restul valorilor:

- **`APP_ENV=production`** pune `Secure` pe cookie-ul de sesiune și oprește
  detaliile de eroare din răspunsuri.
- **`APP_SECRET`** e și tokenul instalatorului de la pasul 6.
- **`AUTH_SECRET`** semnează sesiunile. Dacă îl schimbi mai târziu, toți
  utilizatorii sunt deconectați.
- **`DB_HOST=localhost`**, nu `127.0.0.1` — pe cPanel conexiunea merge prin
  socket.
- **`TRUST_PROXY=0`**, pentru că Apache servește direct. Pune `1` **doar** dacă
  adaugi CloudFlare sau alt reverse proxy. O valoare prea mare e periculoasă, nu
  doar greșită: aplicația ar crede un `X-Forwarded-For` pe care nu l-a scris
  nimeni, iar cine încearcă parole ar putea trimite altul la fiecare încercare și
  n-ar declanșa niciodată limitatorul de rată.

Permisiuni (File Manager → click dreapta → **Permisiuni**):

| | |
|---|---|
| `omd/backend-php/.env` | `600` |
| `omd/storage/` și subdirectoarele | `755` |
| `public_html/uploads/` | `755` |

---

## 6. Instalarea

Pune cele **4 pachete JSON** în `/home/descoper/omd/storage/import-inbox/`.
Ordinea nu contează — instalatorul o deduce din `packageType`.

```
https://descoperavaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=check
https://descoperavaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=migrate
https://descoperavaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=seed
https://descoperavaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=import
```

1. **`check`** — versiune PHP, extensii, căi, `.env`, conexiune, colație și
   **setul de migrații ales**. Toate rândurile trebuie să fie `[OK]`.

   Pe MariaDB, rândul de conexiune scrie `Conexiune MariaDB` și versiunea, iar
   `Set de migrații` trebuie să spună `migrations-mariadb`. Dacă spune altceva,
   nu continua.

2. **`migrate`** — 41 de tabele și un view.
3. **`seed`** — rolurile și contul `admin@omd.ro`, cu parola temporară afișată
   **o singură dată**. **Copiaz-o acum.** Rulat din nou, `seed` e idempotent și
   spune „admin user already exists, password untouched".

   Dacă o pierzi: phpMyAdmin → `descoper_omd_vj_staging` → SQL →
   `DELETE FROM users WHERE email = 'admin@omd.ro';` apoi `?action=seed`. Șterge
   **doar acel rând** — cele 65 de chei străine către `users` sunt
   `ON DELETE SET NULL`, deci golirea tabelului ar merge fără eroare, dar ar
   șterge autorul fiecărei modificări din sistem.
4. **`import`** — cele 4 pachete. Durează cel mai mult: pachetul de campanii are
   1,2 MB, majoritatea imagini base64 care se decodează în fișiere.

Dacă `import` expiră, mută trei pachete temporar în afara `import-inbox/`,
rulează pentru unul, apoi adu-le înapoi pe rând: campanii, activări, monitorizare
activări, reputație. Fiecare pachet e o tranzacție separată, deci ce a intrat
rămâne.

---

## 7. Închide ușa

1. **Șterge `/home/descoper/public_html/api/setup.php`.** E singurul lucru din
   procedura asta care poate rescrie baza. Ștergerea shim-ului e suficientă —
   instalatorul real rămâne în afara docroot-ului.
2. **Golește `/home/descoper/omd/storage/import-inbox/`.**
3. **Schimbă parola de admin** la prima autentificare.

---

## 8. Verifică

```
https://descoperavaleajiului.ro/api/v1/health          -> {"status":"ok"}
https://descoperavaleajiului.ro/api/v1/health/ready    -> {"status":"ok","database":"ok"}
https://descoperavaleajiului.ro/app                    -> ecranul de autentificare
```

Apoi, ca probă că totul e legat:

- **Campanii** arată 6 campanii;
- deschide o campanie → **machete**: imaginile se văd (dacă apar rupte, e
  `uploads/`);
- **F5 pe `/app/campaigns`** rămâne acolo, nu dă 404 (dacă dă, lipsește
  `app/.htaccess`);
- **Administrare → Nomenclatoare**: caută o valoare cu diacritice. Colația e
  accent-insensitive și pe MariaDB, deci „Valea" trebuie să găsească și „Vălea";
- **fonturile**: deschide consola browserului pe `/app`. Zero erori
  `downloadable font: download failed`. Fonturile de rezervă seamănă destul cu
  cele bune cât să nu observi lipsa; consola e singurul loc unde se vede.
- **Campanii → căutare** după un cuvânt dintr-un titlu: interogarea folosește
  `JSON_SEARCH`, funcție care există în MariaDB din 10.2 dar nu a fost probată
  acolo. E primul loc de verificat dacă ceva se poartă ciudat.

---

## 9. Actualizări ulterioare

**Doar frontendul:**

```powershell
cd D:\Florian\omd-valea-jiului\frontend
$env:APP_BASE_PATH = '/app/'
pnpm run build
$zip = 'D:\Florian\omd-valea-jiului\omd-frontend.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Push-Location dist; tar.exe -a -c -f $zip *; Pop-Location
```

Șterge conținutul lui `public_html/app/` **păstrând `.htaccess`**, apoi extrage.

**Backendul:** regenerează întâi setul MariaDB, apoi înlocuiește
`/home/descoper/omd/backend-php/src/` și `/home/descoper/omd/database/`. **Nu
atinge `.env`.** Dacă actualizarea aduce migrații noi, urcă temporar shim-ul
`setup.php`, rulează `&action=migrate`, apoi șterge-l.

Baza **nu** se golește la actualizare. Un import repetat actualizează, nu
duplică — identitatea e `externalKey`.

---

## Ce s-a rupt la instalarea asta

Patru lucruri, toate în afara codului de aplicație. Le las scrise pentru că
niciunul nu s-ar fi văzut dintr-o recitire a ghidului.

**1. `require` cu numele contului vechi.** Shim-urile din `public_html/api/`
aveau calea scrisă în clar, cu un comentariu care spunea s-o schimbi. Prefixul
bazelor de date sugera un nume de cont care nu era cel real, PHP a murit la
`require`, iar răspunsul a fost **500 cu corp gol** — semnătura unei erori
fatale, fiindcă aplicația noastră întoarce întotdeauna JSON. Acum calea se deduce
singură, iar când e greșită, răspunsul spune unde a căutat.

**2. Utilizatorul creat, dar neadăugat pe bază.** `1044`, nu `1045` — pasul 2.

**3. Numele bazei, greșit.** Fără urmări; `check` l-a prins.

**4. Colația.** `1273 Unknown collation` la conectare. De aici a ieșit tot pasul
1.5: al doilea set de migrații, detecția serverului și, pe drum, un defect real —
`Preflight` compara versiunea cu `version_compare($version, '8.0', '>=')`, iar
MariaDB raportează `10.11.18-MariaDB`. Zece e mai mare decât opt, deci verificarea
scria `[OK]` exact pe serverul care nu putea crea schema, și aflai abia la primul
`CREATE TABLE`.

---

## Dacă ceva nu merge

| simptom | cauză probabilă |
|---|---|
| **500 cu corp gol** pe `/api/...` | PHP moare înainte de codul nostru — aplicația răspunde întotdeauna JSON. Cale greșită într-un `require`, sau `.env` ilizibil |
| `[1273] Unknown collation` | lipsește `src/Database/Dialect.php` sau `database/migrations-mariadb/` din arhivă — nu doar migrațiile, și codul PHP trebuie urcat |
| `check`: `Set de migrații` arată `migrations` | detecția crede că e MySQL; verifică ce scrie pe rândul de conexiune |
| `check`: `Colație bază de date` e `latin1_swedish_ci` | valoarea implicită a serverului; `ALTER DATABASE` de la pasul 2. Nu blochează migrarea |
| `Illegal mix of collations` | un tabel creat fără charset explicit, pe o bază rămasă `latin1` — vezi pasul 2 |
| `[1044] Access denied ... to database` | utilizatorul nu e adăugat pe bază — pasul 2. Parola e corectă |
| `[1045] Access denied for user` | parolă greșită în `.env`, sau utilizatorul nu există |
| `migrate` se oprește la primul tabel | `descoper_omd_app` nu are ALL PRIVILEGES |
| Pagină albă la `/app` | build fără `APP_BASE_PATH` — verifică `dist/index.html` |
| 404 la F5 pe `/app/orice` | lipsește `public_html/app/.htaccess` |
| `File not found.` (text simplu) | fișierul `.php` nu există — probabil a rămas `api-setup.php` în loc de `setup.php` |
| 404 la `/api/v1/health` | lipsește `public_html/api/.htaccess` |
| Nu vezi `.htaccess` în File Manager | e ascuns; Setări → Afișare fișiere ascunse |
| „Token invalid" la setup | `APP_SECRET` din URL nu e identic cu cel din `.env` |
| „Refuzat pe HTTP" | ai deschis `http://` — folosește `https://` |
| `check` spune că lipsește o extensie | nu o poți activa singur — tichet la gazdă |
| `import` se oprește fără mesaj | expirat; ridică limitele din MultiPHP INI Editor sau importă pachetele pe rând |
| Imagini rupte | `UPLOAD_DIR` arată spre contul vechi, sau lipsesc permisiunile |
| Deconectat la fiecare cerere | `AUTH_SECRET` s-a schimbat, sau `APP_ENV=production` fără HTTPS |
| „Prea multe încercări" la login | limitatorul de rată; 15 minute, sau șterge `omd/storage/rate-limit/` |
