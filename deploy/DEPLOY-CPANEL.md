# Instalare pe cPanel — visitvaleajiului.ro/app

Pentru contul `visit`, domeniul principal `visitvaleajiului.ro`, baza de date
`visit_omd_vj_staging`. Frontendul ajunge la `https://visitvaleajiului.ro/app`,
API-ul la `/api/v1/...`, imaginile la `/uploads/...`.

Procedura de mai jos a fost **repetată integral local** pe o copie a structurii
de pe gazdă, până la autentificare și încărcarea imaginilor. Secțiunea
[Ce am verificat și ce nu](#ce-am-verificat-și-ce-nu) spune exact unde se opreşte
proba și ce rămâne pe seama configurației Apache de pe server.

---

## 0. Înainte să începi

| | |
|---|---|
| Acces cPanel | File Manager, MultiPHP Manager, MySQL Databases |
| Terminal | **nu e necesar** — instalarea se face dintr-un URL protejat |
| Node.js pe gazdă | **nu e necesar** — frontendul se construiește pe calculatorul tău |
| Pe calculatorul tău | Node 20+ și proiectul, ca să poți rula `npm run build` |
| Pachetele JSON | cele 4 fișiere din `04_DEMO_SEEDS/` |

Domeniul are deja `Force HTTPS Redirect` activat. E o **precondiție**, nu o
recomandare: instalatorul refuză să ruleze pe HTTP simplu, ca tokenul să nu
circule în clar.

`public_html` conține deja `quizz`. Nimic din procedura asta nu-l atinge — se
adaugă doar `app/`, `api/` și `uploads/` lângă el.

---

## 1. Versiunea de PHP

**cPanel → MultiPHP Manager** → selectează `visitvaleajiului.ro` → pune **8.1**
sau mai nou → Apply.

Dacă gazda oferă 8.2 sau 8.3, alege-o: 8.1 nu mai primește actualizări de
securitate. Aplicația merge pe oricare dintre ele.

**cPanel → Select PHP Version → Extensions** — trebuie bifate exact astea patru:

```
pdo_mysql    mbstring    json    filter
```

Asta e lista completă; sunt exact extensiile pe care le verifică `?action=check`
la pasul 6, iar fără vreuna dintre ele backendul refuză să pornească și spune
care lipsește. `json` și `filter` sunt de obicei active implicit.

Nu ai nevoie de `openssl` sau `fileinfo`: criptografia folosită (`random_bytes`,
`hash_hmac`, `password_hash`) e în nucleul PHP, iar tipul fișierelor vine din
`data:` URI-ul pachetului, nu din detecție.

---

## 2. Utilizatorul bazei de date

**cPanel → MySQL Databases → Add User To Database**: `visit_omd_app` →
`visit_omd_vj_staging` → **ALL PRIVILEGES**.

Nu doar SELECT/INSERT/UPDATE/DELETE. Migrațiile execută 41 de `CREATE TABLE` și
un `CREATE VIEW`, deci contul are nevoie și de `CREATE`, `ALTER`, `INDEX`,
`REFERENCES`, `DROP`. Fără ele instalarea se oprește la primul tabel.

Ceilalți trei utilizatori (`visit_reader`, `visit_root`, `visit_writer`) nu sunt
folosiți de aplicație. Îi poți lăsa; aplicația se conectează doar cu
`visit_omd_app`.

Notează parola lui — intră în `.env` la pasul 5.

---

## 3. Construiește frontendul, local

Pe calculatorul tău, în PowerShell:

```powershell
cd D:\Florian\omd-valea-jiului\frontend
$env:APP_BASE_PATH = '/app/'
npm ci
npm run build
```

`APP_BASE_PATH` e ce face aplicația să funcționeze într-un subdirector: Vite
rescrie fiecare URL de resursă cu el, iar routerul îl citește înapoi din
`import.meta.env.BASE_URL`. Fără el, aplicația caută `/assets/...` la rădăcina
domeniului și vezi o pagină albă.

Verifică înainte să urci:

```powershell
Select-String -Path dist\index.html -Pattern 'src=|href='
```

Toate căile trebuie să înceapă cu `/app/`. Dacă vezi altceva, variabila nu a
ajuns la build.

> Rulează comanda în **PowerShell**, nu în Git Bash. Git Bash convertește `/app/`
> într-o cale Windows și build-ul iese cu URL-uri de forma
> `/Program Files/Git/app/...`.

---

## 4. Structura pe gazdă

**File Manager**, pornind din `/home/visit`. Creează:

```
/home/visit/
├── omd/                          <- NOU, în afara public_html
│   ├── backend-php/
│   ├── contracts/
│   ├── database/
│   └── storage/
│       ├── import-inbox/         <- CREEAZĂ TU; pachetele JSON, temporar
│       ├── import-temp/          (se creează singur la pasul 6)
│       └── rate-limit/           (se creează singur)
└── public_html/
    ├── quizz/                    <- existent, neatins
    ├── app/                      <- frontendul construit
    ├── api/                      <- două fișiere de legătură
    └── uploads/                  <- imaginile; se creează singur la pasul 6
```

Singurul director pe care trebuie să-l faci de mână e **`storage/import-inbox/`**.
`uploads/`, `import-temp/` și `rate-limit/` se creează singure — `?action=check`
le face la prima rulare şi raportează dacă nu poate.

**De ce `omd/` stă în afara `public_html`:** acolo sunt `.env` cu parola bazei,
codul sursă și migrațiile. Nimic din ele nu trebuie să fie accesibil dintr-un
browser. Singurul lucru expus e `public_html/api/`, două fișiere de câte o linie.

### Ce urci, și cum

Nu urca fișier cu fișier. Fă local câte o arhivă și folosește **Extragere** din
File Manager.

**Arhiva backendului:**

```powershell
cd D:\Florian\omd-valea-jiului
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

**Arhiva frontendului:**

```powershell
$zip = Join-Path 'D:\Florian\omd-valea-jiului' 'omd-frontend.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Push-Location D:\Florian\omd-valea-jiului\frontend\dist
tar.exe -a -c -f $zip *
Pop-Location
```

| arhivă | se extrage în |
|---|---|
| `omd-backend.zip` | `/home/visit/omd/` |
| `omd-frontend.zip` | `/home/visit/public_html/app/` |

Două detalii din comenzile de mai sus nu sunt stilistice:

- **`tar.exe`, nu `Compress-Archive`.** `Compress-Archive` din PowerShell 5.1
  scrie căile cu backslash în interiorul arhivei. Dezarhivatorul de pe Linux
  le ia literal și obții un fișier numit `backend-php\src\bootstrap.php` în loc
  de un arbore. `tar` e inclus în Windows 10 și 11 și scrie corect. Verificat pe
  ambele variante.
- **`.env` se scoate din arhivă.** Altfel `.env`-ul tău local, cu parola bazei
  de dezvoltare, ajunge pe gazdă. Cel de pe server se scrie la pasul 5.

**Nu urca** folderul `backend/` (backendul Node) și **nu urca** `node_modules`.
Nu sunt necesare pe gazdă.

După extragere verifică: `/home/visit/omd/backend-php/src/bootstrap.php` există,
iar `/home/visit/public_html/app/index.html` există.

### Fișierele de legătură

Din `deploy/cpanel/` urcă și redenumește:

| din repo | pe gazdă |
|---|---|
| `deploy/cpanel/api-index.php` | `/home/visit/public_html/api/index.php` |
| `deploy/cpanel/api-setup.php` | `/home/visit/public_html/api/setup.php` |
| `backend-php/public/.htaccess` | `/home/visit/public_html/api/.htaccess` |
| `deploy/cpanel/app.htaccess` | `/home/visit/public_html/app/.htaccess` |
| `deploy/cpanel/uploads.htaccess` | `/home/visit/public_html/uploads/.htaccess` |

Cele două fișiere `.php` conțin fiecare un singur `require` către codul din
`/home/visit/omd/`. **Dacă numele contului nu e `visit`, deschide-le și schimbă
calea** — e scris în comentariul din fiecare.

`app/.htaccess` e cel care face ca reîncărcarea paginii pe `/app/campaigns` să nu
dea 404. `uploads/.htaccess` oprește execuția de cod în directorul în care
aplicația scrie fișiere.

---

## 5. Configurația

Generează două secrete **diferite**, local:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Rulează comanda de două ori. Creează `/home/visit/omd/backend-php/.env`
(File Manager → **+ Fișier**, apoi **Editare**):

```ini
APP_ENV=production
APP_BASE_URL=https://visitvaleajiului.ro

APP_SECRET=<primul secret>
AUTH_SECRET=<al doilea secret, diferit>
AUTH_TOKEN_TTL=28800

DB_HOST=localhost
DB_PORT=3306
DB_NAME=visit_omd_vj_staging
DB_USER=visit_omd_app
DB_PASSWORD=<parola utilizatorului>

UPLOAD_DIR=/home/visit/public_html/uploads
IMPORT_TEMP_DIR=storage/import-temp
MAX_UPLOAD_MB=15
MAX_JSON_IMPORT_MB=25

SEED_ADMIN_EMAIL=admin@omd.ro
SEED_ADMIN_NAME=Administrator OMD

LOG_LEVEL=info
LOG_FILE=
TRUST_PROXY=0
```

Câteva valori nu sunt arbitrare:

- **`APP_ENV=production`** pune atributul `Secure` pe cookie-ul de sesiune și
  oprește detaliile de eroare din răspunsuri. Domeniul are HTTPS forțat, deci e
  valoarea corectă.
- **`APP_SECRET`** e și tokenul instalatorului de la pasul 6. Cât timp e valoarea
  implicită `change-me...`, instalatorul refuză să pornească.
- **`AUTH_SECRET`** semnează sesiunile. Dacă îl schimbi mai târziu, toți
  utilizatorii sunt deconectați.
- **`UPLOAD_DIR` e absolut și în `public_html`.** Aşa imaginile sunt servite
  direct de Apache, fără PHP. Backendul știe să le servească și el, dar e mai
  lent şi inutil aici.
- **`DB_HOST=localhost`**, nu `127.0.0.1` — pe cPanel conexiunea merge prin
  socket.
- **`TRUST_PROXY=0`**, pentru că pe cPanel Apache servește direct. Pune `1`
  **doar** dacă adaugi CloudFlare sau alt reverse proxy în față. O valoare prea
  mare e periculoasă, nu doar greșită: aplicația ar avea încredere într-un
  `X-Forwarded-For` pe care nu l-a scris nimeni, iar cine încearcă parole ar
  putea trimite altul la fiecare încercare și n-ar declanșa niciodată
  limitatorul de rată.

Permisiuni, din File Manager (click dreapta → **Permisiuni**):

| | |
|---|---|
| `omd/backend-php/.env` | `600` |
| `omd/storage/` și subdirectoarele | `755` (sau `775` dacă scrierea eșuează) |
| `public_html/uploads/` | `755` |

---

## 6. Instalarea

Pune cele **4 pachete JSON** în `/home/visit/omd/storage/import-inbox/`
(File Manager → Încărcare). Ordinea fișierelor nu contează — instalatorul o
deduce singur din `packageType`.

Apoi deschide pe rând, în browser, înlocuind `<APP_SECRET>` cu valoarea din
`.env`:

```
https://visitvaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=check
https://visitvaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=migrate
https://visitvaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=seed
https://visitvaleajiului.ro/api/setup.php?token=<APP_SECRET>&action=import
```

Ce face fiecare:

1. **`check`** — versiune PHP, extensii, căi, `.env`, conexiune MySQL, colație.
   Rezolvă orice `FAIL` înainte să mergi mai departe.
2. **`migrate`** — creează cele 41 de tabele și view-ul.
3. **`seed`** — creează rolurile și contul `admin@omd.ro`, apoi afișează parola
   temporară **o singură dată**. **Copiaz-o acum.** Rularea din nou nu o
   regenerează: `seed` e idempotent și spune „admin user already exists, password
   untouched".

   Dacă totuși o pierzi: **phpMyAdmin** → baza `visit_omd_vj_staging` → SQL →
   `DELETE FROM users WHERE email = 'admin@omd.ro';` apoi `?action=seed` din nou.
   Verificat: contul se recreează cu o parolă nouă și datele rămân neatinse.
   Şterge **doar acel rând**, nu golește tabelul — cele 65 de chei străine către
   `users` sunt `ON DELETE SET NULL`, deci a goli tabelul ar merge fără eroare
   dar ar șterge autorul fiecărei modificări din sistem.
4. **`import`** — încarcă cele 4 pachete, în ordinea corectă dedusă automat.
   Durează cel mai mult: pachetul de campanii are 1,2 MB, din care majoritatea
   sunt imagini codate base64 care se decodează în fișiere.

Dacă `import` se oprește la jumătate cu o eroare de timp, mută trei dintre
fișiere temporar în afara `import-inbox/`, rulează pentru unul singur, apoi
adu-le înapoi pe rând — în ordinea: campanii, activări, monitorizare activări,
reputație. Fiecare pachet e o tranzacție separată, deci ce a intrat rămâne.

---

## 7. Închide ușa

Imediat după ce importul a reușit:

1. **Șterge `/home/visit/public_html/api/setup.php`.** E singurul lucru din
   procedura asta care poate rescrie baza de date. Ștergerea fișierului de
   legătură e suficientă — instalatorul real rămâne în afara docroot-ului și
   devine inaccesibil.
2. **Șterge fișierele din `/home/visit/omd/storage/import-inbox/`.** Şi-au făcut
   treaba.
3. **Schimbă parola de admin** la prima autentificare — aplicația o cere oricum.

---

## 8. Verifică

```
https://visitvaleajiului.ro/api/v1/health          -> {"status":"ok"}
https://visitvaleajiului.ro/api/v1/health/ready    -> {"status":"ok","database":"ok"}
https://visitvaleajiului.ro/app                    -> ecranul de autentificare
```

Autentifică-te cu `admin@omd.ro` și parola de la pasul 6. Apoi, ca probă că
totul e legat:

- **Campanii** trebuie să arate 6 campanii;
- deschide o campanie și du-te la **machete** — imaginile trebuie să se vadă
  (dacă apar rupte, e `uploads/`);
- **reîncarcă pagina** (F5) pe `/app/campaigns` — trebuie să rămână acolo, nu 404
  (dacă dă 404, lipsește `app/.htaccess`);
- **Administrare** trebuie să arate un utilizator.

---

## 9. Actualizări ulterioare

**Doar frontendul** (cel mai frecvent):

```powershell
cd D:\Florian\omd-valea-jiului\frontend
$env:APP_BASE_PATH = '/app/'
npm run build
$zip = 'D:\Florian\omd-valea-jiului\omd-frontend.zip'
Remove-Item $zip -Force -ErrorAction SilentlyContinue
Push-Location dist; tar.exe -a -c -f $zip *; Pop-Location
```

Şterge conținutul lui `public_html/app/` **păstrând `.htaccess`**, apoi extrage
arhiva nouă. Numele fișierelor conțin un hash, deci nu rămân resurse vechi în
cache.

`tar.exe` şi aici, din același motiv ca la pasul 4.

**Backendul:** înlocuiește `/home/visit/omd/backend-php/src/`. **Nu atinge
`.env`.** Dacă actualizarea aduce migrații noi, urcă temporar din nou shim-ul
`setup.php`, rulează `&action=migrate`, apoi șterge-l la loc.

Baza de date **nu** se golește la actualizare. Un import repetat actualizează,
nu duplică — identitatea e `externalKey`.

---

## Ce am verificat și ce nu

**Repetat integral, local, pe o copie a structurii de mai sus** — cu backendul în
afara docroot-ului, shim-urile în `public_html/api/`, frontendul construit cu
`APP_BASE_PATH=/app/` şi baza golită complet:

| | |
|---|---|
| `check` prin shim | toate căile se rezolvă, MySQL conectat |
| `migrate` | 10 migrații, 41 de tabele + view |
| `seed` | rolurile şi contul admin, parolă afișată o dată |
| `import` | ordinea dedusă corect din `packageType`, deşi alfabetic fișierele stau invers; 6 campanii, 16 activări, 78 KPI, 34 instantanee |
| Autentificare la `/app` | reușită, redirect corect la `/app/change-password` |
| Schimbarea parolei | reușită, apoi `/app/campaigns` |
| Cele 8 ecrane | toate se randează cu date |
| Imagini | servite din `/uploads/`, 115082 octeți, decodate ca imagine reală |
| Reîncărcare pe rută adâncă | `/app/monitoring-activations` cu F5 → pagina corectă, sesiunea păstrată |
| Paznicul instalatorului | refuzat pe HTTP simplu; refuzat cu token greșit |

**Şapte lucruri s-au rupt la validarea listei.** Le enumăr pentru că niciunul nu
s-ar fi văzut dintr-o recitire — au ieșit doar rulând fiecare pas:

1. **`npm run build` eșua.** Verificasem cu `npx vite build`, care sare peste
   TypeScript; scriptul real rulează `tsc -b` întâi, iar `import.meta.env` nu era
   tipizat. Adăugat `frontend/src/vite-env.d.ts`.
2. **`TRUST_PROXY` nu funcționa deloc.** Era citit cu `getenv()`, care nu vede
   `.env`, și nu era înregistrat în `Env`. Documentat, configurabil și mort. Mai
   rău, lua adresa din stânga lui `X-Forwarded-For` — cea pe care o scrie
   clientul —, deci dacă ar fi funcționat, cineva ar fi putut ocoli limitatorul
   de login trimițând alt antet la fiecare încercare. Reparat: se citeşte prin
   `Env` și se numără de la dreapta, ca în Express. Şase cazuri testate.
3. **Valoarea recomandată era greșită.** Aveam `TRUST_PROXY=1`, dar pe cPanel nu
   e proxy în față, deci exact varianta periculoasă de mai sus. Acum e `0`.
4. **Arhiva ar fi conținut `.env`-ul local**, cu parola bazei de dezvoltare.
5. **`Compress-Archive` scrie căi cu backslash** în arhivă. Dezarhivatorul de pe
   Linux le ia literal, deci în loc de un arbore obții fișiere numite
   `backend-php\src\bootstrap.php`. Înlocuit cu `tar.exe`, verificat prin
   extragere reală.
6. **Ceream extensii inutile.** `openssl` și `fileinfo` nu sunt folosite nicăieri
   în `src/` — criptografia e în nucleul PHP. Te-aș fi trimis după o problemă
   inexistentă dacă gazda nu le avea. Corectat şi în `tools/install-php-ini.ps1`,
   care făcea aceeaşi afirmație.
7. **Recuperarea parolei era greșită.** Scrisesem „golești tabelul `users`".
   `seed` rulat din nou **nu** regenerează parola, iar golirea tabelului ar fi
   mers fără eroare — cele 65 de chei străine sunt `ON DELETE SET NULL` — dar ar
   fi șters autorul fiecărei modificări. Procedura corectă, testată, e la pasul 6.

**Ce nu am putut verifica local**, pentru că ține de Apache, nu de aplicație:

- **regulile din cele trei `.htaccess`**. Serverul PHP încorporat nu citește
  `.htaccess`, aşa că le-am emulat cu un router care aplică exact aceleaşi trei
  reguli. Aplicația funcționează în spatele lor; ce rămâne e ca Apache să le
  aplice la fel. Dacă ceva se sparge, aici e primul loc de căutat.
- **`APP_ENV=production`**. Local am rulat cu `staging`, fiindcă `production`
  pune `Secure` pe cookie și browserul nu-l trimite peste HTTP simplu. Pe gazdă,
  cu HTTPS, e valoarea corectă — dar combinația exactă nu a fost probată.
- **limitele gazdei**: `max_execution_time`, `memory_limit`, timeout-ul FastCGI.
  Importul cere cel mai mult; pasul 6 spune ce faci dacă expiră.
- **privilegiile lui `visit_omd_app`**. Nu am cum să le văd din capturi. Dacă
  `migrate` eșuează la primul `CREATE TABLE`, ăsta e motivul.

**Nu există teste automate** în niciun backend. Tot ce e mai sus a fost rulat
manual, o dată.

---

## Dacă ceva nu merge

| simptom | cauză probabilă |
|---|---|
| Pagină albă la `/app` | build fără `APP_BASE_PATH` — verifică `dist/index.html` |
| 404 la F5 pe `/app/orice` | lipsește `public_html/app/.htaccess` |
| 404 la `/api/v1/health` | lipsește `public_html/api/.htaccess` sau calea din `api/index.php` e greșită |
| 500 la `/api/...` | `.env` lipsă sau incomplet; vezi `logs/` din contul cPanel |
| „Token invalid" la setup | `APP_SECRET` din URL nu e identic cu cel din `.env` |
| „Refuzat pe HTTP" | ai deschis `http://` — foloseşte `https://` |
| `migrate` se oprește la primul tabel | `visit_omd_app` nu are ALL PRIVILEGES |
| Imagini rupte | `UPLOAD_DIR` nu arată spre `public_html/uploads`, sau lipsesc permisiunile |
| Deconectat la fiecare cerere | `AUTH_SECRET` s-a schimbat, sau `APP_ENV=production` fără HTTPS |
| „Prea multe încercări" la login | limitatorul de rată; 15 minute, sau șterge `omd/storage/rate-limit/` |
