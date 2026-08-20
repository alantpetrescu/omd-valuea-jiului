# Backend PHP

Portare a backendului Node/Express în PHP, pentru găzduiri partajate care oferă
PHP și MySQL, dar nu pot rula Node.

`backend/` rămâne neatins. Cele două implementări sunt independente: **nu se
importă niciodată una pe alta** și pot rula simultan pe aceeași bază de date.

## Ce înseamnă „port fidel"

Aceleași 53 de rute, aceleași mesaje de eroare, aceeași schemă, aceleași
contracte JSON. Verificat prin comparare automată: 53 din 53, niciuna în plus,
niciuna lipsă.

Trei lucruri sunt compatibile la nivel de bit, deci **cele două backenduri pot
rula în paralel pe aceeași bază**:

| | |
|---|---|
| Hash-uri de parolă | Argon2id cu aceiași parametri (19 MiB, 2 iterații, 1 fir). O parolă setată în Node se verifică aici și invers — vezi nota despre ordinea parametrilor mai jos. |
| Token de sesiune | `<userId>.<expiră>.<HMAC-SHA256>`, semnat cu `AUTH_SECRET`. O sesiune emisă de Node e acceptată aici. |
| Migrații | Aceleași fișiere `database/migrations/*.sql`, aceeași tabelă `schema_migrations`, aceleași sume SHA-256. O bază migrată de unul e recunoscută de celălalt. |

Ca să funcționeze, `AUTH_SECRET` trebuie să fie identic în ambele `.env`.

## Cerințe

- **PHP 8.1+** cu extensiile `pdo_mysql`, `json`, `mbstring`
  (8.1 e pragul real: proprietățile `readonly` sunt eroare de sintaxă pe 8.0)
- **MySQL 8.0+** — schema folosește `utf8mb4_0900_ai_ci`
- Argon2 în PHP (opțional, vezi mai jos)

Fără Composer. Autoloader propriu, validator JSON Schema propriu — pe multe
conturi cPanel nu există shell, deci `composer install` ar face instalarea
imposibilă exact acolo unde portarea asta are rost.

## Structura pe disc

`contracts/` și `database/` trebuie să fie **lângă** `backend-php/`, nu în el —
la fel ca la backendul Node:

```
/home/user/omd/
├── backend-php/
│   ├── public/          <- singurul director expus web
│   │   ├── index.php
│   │   └── .htaccess
│   ├── src/
│   ├── bin/             migrate.php, seed-technical.php,
│   │                    import.php, check-environment.php
│   └── .env             mod 600
├── contracts/           schemele JSON, citite la runtime
├── database/migrations/ citite de bin/migrate.php
└── storage/
    ├── uploads/
    ├── import-temp/
    └── rate-limit/      creat automat
```

Doar `public/` se servește. `backend-php/.htaccess` blochează restul, ca plasă
de siguranță dacă tot directorul ajunge în `public_html`.

## Instalare

Pe gazdă (Linux/cPanel):

```bash
cp .env.example .env
chmod 600 .env
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"   # de două ori
```

Local, pe Windows — `chmod` nu există, drepturile se dau din ACL-uri, iar
fișierul e oricum doar de dezvoltare:

```powershell
Copy-Item .env.example .env
php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
```

Completează `.env` — ai nevoie de două secrete distincte, deci rulează comanda
de două ori.

### De la o bază goală la un sistem funcțional

Patru pași, în ordinea asta, la fel pe Windows și pe gazdă:

```powershell
php bin/check-environment.php
php bin/migrate.php
php bin/seed-technical.php
php bin/import.php campanii.json activari.json monitorizare.json reputatie.json
```

`seed-technical.php` creează rolurile și **contul de administrator**, apoi
afișează parola temporară **o singură dată** — copiaz-o atunci, nu se mai poate
recupera. La prima autentificare aplicația cere schimbarea ei.

Ce face fiecare pas: verificarea mediului spune dacă instalarea poate porni;
migrațiile creează cele 41 de tabele și view-ul; seed-ul tehnic pune rolurile și
contul; importul aduce datele de business. Nimic altceva nu e necesar — nu există
pas manual de completat nomenclatoare, pentru că pachetul le aduce cu el.

Starea migrațiilor, oricând:

```powershell
php bin/migrate.php --status
```

## Verificarea mediului

Înainte de orice, întreabă instalarea dacă poate porni:

```powershell
php bin/check-environment.php
```

Verifică versiunea PHP, extensiile, Argon2, structura de directoare, `.env`,
permisiunile pe directoarele de stocare, versiunea și colația MySQL, starea
migrațiilor și dacă există conturi. Ies cu 1 dacă ceva e FAIL, deci poate
condiționa un script de deploy.

## Rulat local, cu frontendul real

Două console. În prima, serverul PHP încorporat — `-t public` fiindcă doar
`public/` are voie să fie rădăcină web, exact ca pe gazdă:

```powershell
cd backend-php
php -S 127.0.0.1:8080 -t public public/index.php
```

În a doua, frontendul, spunându-i lui Vite să trimită `/api` către PHP în loc de
Node:

```powershell
cd frontend
$env:API_TARGET = 'http://127.0.0.1:8080'
npm run dev
```

Apoi http://localhost:5173. Variabila e citită în `vite.config.ts`; fără ea
proxy-ul merge la Node pe 3000, deci se comută între backenduri **fără să
modifici niciun fișier** — iar o modificare de fișier e o modificare pe care uiți
s-o dai înapoi.

Serverul are nevoie de `public/index.php` ca script de rutare — fără el, cererile
pentru căi care nu sunt fișiere reale nu ajung niciodată la aplicație, iar
`/uploads/` întoarce 404.

Ca să ținteşti altă bază de date decât cea din `.env`, serverul are nevoie și de
un `-d`:

```powershell
$env:DB_NAME = 'alta_baza'
php -d variables_order=EGPCS -S 127.0.0.1:8081 -t public public/index.php
```

Fără flag, variabila e ignorată în tăcere și se folosește tot `.env`. `GPCS`,
implicit în PHP, nu include `E`, iar SAPI-urile web nu copiază mediul în
`$_SERVER` așa cum face CLI-ul. Uneltele din `bin/` nu au nevoie de flag —
`DB_NAME=x php bin/import.php …` funcționează, fiindcă acolo rulează CLI-ul.

Ambele backenduri pot rula simultan pe aceeași bază de date. Așa s-a făcut
comparația din secțiunea de verificare: două instanțe de Vite, pe 5173 și 5174,
fiecare către alt backend.

## Pe cPanel, fără Terminal

`public/` devine docroot-ul domeniului sau subdomeniului. Dacă nu poți schimba
docroot-ul, pune un `.htaccess` în `public_html` care rescrie totul spre
`../omd/backend-php/public/index.php`.

**Fără Terminal nu poți rula nimic din CLI** — nici migrațiile, nici seed-ul.
Pentru asta există `public/setup.php`, protejat prin token:

```
https://exemplu.ro/setup.php?token=<APP_SECRET>
https://exemplu.ro/setup.php?token=<APP_SECRET>&action=migrate
https://exemplu.ro/setup.php?token=<APP_SECRET>&action=seed
```

Patru lucruri îl țin să nu fie o ușă din dos: cere `APP_SECRET`, comparat în
timp constant; refuză cât timp `APP_SECRET` e încă valoarea implicită; refuză pe
HTTP simplu, fiindcă tokenul ar trece în clar și ar ajunge în logurile de proxy;
și fiecare acces e înregistrat cu adresa clientului.

**Șterge `public/setup.php` după ce baza de date e gata.** Nu mai face nimic ce
nu poți face din aplicație, iar bannerul ți-o amintește la fiecare rulare.

Alternativa, dacă preferi să nu expui deloc așa ceva: rulează `bin/migrate.php`
de pe altă mașină, conectat prin Remote MySQL — dar asta cere deschiderea
portului bazei de date către internet, un compromis mai prost decât un URL
temporar cu token.

Restul (`.htaccess`, TLS, structura de directoare) e în `deploy/CPANEL.md`.

## Diferențe față de Node, și de ce

Niciuna nu schimbă contractul API. Sunt consecințe ale modelului de execuție.

**Limitarea încercărilor de login stă într-un fișier.** Node ține un `Map` în
memoria procesului, ceea ce merge fiindcă un singur proces servește tot. În PHP
fiecare cerere e un proces nou, deci un contor în memorie s-ar reseta la fiecare
încercare — limitarea ar fi decorativă. Contorul stă în `storage/rate-limit/`,
cu blocare pe fișier ca două încercări simultane să nu treacă amândouă.

**Validatorul JSON Schema e scris de mână.** Node folosește Ajv. Am numărat
cuvintele-cheie din cele patru contracte și am implementat exact acelea: `type`,
`$ref`, `items`, `additionalProperties`, `required`, `properties`, `minimum`,
`maximum`, `minLength`, `format`, `const`, `enum`, `pattern`, `uniqueItems`,
`anyOf`. Toate `$ref`-urile sunt locale, deci nu există rezolvare la distanță —
iar adăugarea ei ar fi o cale prin care un fișier de schemă ar putea face
validatorul să acceseze un URL.

**Coloanele DECIMAL trec explicit prin `Db::decimal()`.** Pool-ul mysql2 avea
`decimalNumbers: true`, deci bugetele veneau ca numere. PDO le dă ca șiruri, iar
o adunare ar concatena. Conversia păstrează NULL distinct de 0 — un buget
nesetat și unul zero sunt fapte diferite peste tot în sistem.

**Coloanele JSON trec prin `Db::json()`.** mysql2 le parsa singur; PDO dă șirul
brut.

**Fracțiunea de secundă zero se taie, ca la mysql2.** Coloanele de timp sunt
`DATETIME(6)`. Când microsecundele sunt zero, mysql2 întoarce
`2027-06-20 14:30:00`, iar PDO `2027-06-20 14:30:00.000000` — același moment,
șapte caractere diferență, suficient cât două răspunsuri altfel identice să nu
mai coincidă. Când fracțiunea *nu* e zero, ambele drivere o păstrează
(`.411812`). `Db::normaliseDateTime()` reproduce exact regula asta, în stratul
PDO, unde apare diferența.

Prima versiune tăia orice fracțiune, ceea ce a stricat `/admin/users` în sens
invers — arunca precizie pe care Node o raportează. Diferența a ieșit la
iveală doar comparând câmp cu câmp cele două backenduri; o regulă dedusă dintr-un
singur exemplu e o regulă care cade la al doilea.

**Fără Argon2, se cade pe bcrypt.** Dacă PHP-ul gazdei nu are Argon2,
`PASSWORD_ARGON2ID` lipsește și parolele *noi* folosesc bcrypt. Verificarea nu e
afectată — `password_verify` alege algoritmul după prefixul hash-ului — deci
hash-urile Argon2 existente continuă să meargă. `bin/seed-technical.php` spune
care algoritm e activ.

### Ordinea parametrilor Argon2

Cele două biblioteci codifică același hash cu parametrii în ordine diferită:

```
node argon2       $argon2id$v=19$m=19456,p=1,t=2$sare$digest
PHP / libargon2   $argon2id$v=19$m=19456,t=2,p=1$sare$digest
```

Valorile sunt identice; doar succesiunea diferă. Decodorul libargon2 citește
câmpurile pozițional, deci respinge forma Node din start — iar `password_verify`
întoarce `false` pentru **fiecare parolă setată vreodată prin backendul Node**,
tăcut, ca și cum ar fi parola greșită.

`Password::verify()` rescrie ordinea înainte de verificare. Sarea, digestul și
cei trei parametri rămân neatinși, iar un hash care nu are exact forma aceea
trece nemodificat. Node acceptă ordinea canonică, deci hash-urile scrise aici
rămân citibile de backendul Node.

Regresia e acoperită de `tools/test-password-interop.php`, care verifică și că
o parolă greșită tot pică — un „normalizator" care ar face totul să treacă ar
fi trecut testul principal și ar fi fost o catastrofă.

```powershell
php tools/test-password-interop.php
```

## Importul pachetelor JSON

Datele de business intră în sistem doar prin import, deci asta este procedura
prin care o bază goală devine folosibilă.

```powershell
php bin/import.php ..\04_DEMO_SEEDS\OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json
```

Mai multe pachete deodată, **în ordinea asta**:

```powershell
php bin/import.php campanii.json activari.json monitorizare.json reputatie.json
```

Ordinea nu e o preferință. Activările se leagă de campanii prin `externalKey`, iar
instantaneele de monitorizare se agață de materialele activărilor; un pachet
importat prea devreme eșuează pe o referință inexistentă. Din același motiv
rularea se oprește la primul eșec, în loc să continue peste o stare deja greșită.

Ce se întâmplă la fiecare rulare:

```
citire -> sha256 -> parsare -> (packageType, schemaVersion) -> validare schemă
  -> decodare base64 în storage/import-temp
  -> BEGIN -> scrieri -> publicare fișiere -> verificare -> COMMIT
```

Rândul din `import_batches` se creează **înainte** de tranzacție, intenționat: dacă
ar fi înăuntru, un rollback ar șterge și dovada eșecului, iar Admin > Importuri
n-ar arăta nimic pentru o rulare care a eșuat vizibil.

La orice eroare: baza se dă înapoi complet, fișierele publicate în rulare se
șterg, temporarele se curăță, iar lotul rămâne `FAILED` cu motivul. Nu rămâne
niciodată un import pe jumătate.

Importul e **idempotent**. Aceleași pachete rulate a doua oară dau actualizări, nu
duplicate — identitatea e `externalKey`, nu ordinea din fișier. Un nomenclator
redenumit din aplicație **nu** e suprascris de pachet: diferența apare ca
avertisment și valoarea din aplicație rămâne (spec 33.4-33.6).

Nu există rută HTTP de import, exact ca în Node — acolo CLI-ul are aceeași notă,
că rutele vin în etapa 2. Un import se rulează din linia de comandă.

### Fișierele importate, servite pe `/uploads/`

Activele din pachet nu se stochează în MySQL: `src` e un `data:` URI, se decodează
într-un fișier și în baza de date rămâne doar calea. Frontendul le cere apoi pe
`/uploads/<an>/<luna>/<fisier>`.

Pe un server de producție, nginx sau Apache mapează `/uploads/` direct la disc și
cererea nu ajunge niciodată în PHP — asta descrie `deploy/DEPLOY.md`. Dar „se
ocupă serverul web" nu e adevărat peste tot: pe găzduire partajată rescrierea
trimite totul în `index.php`, iar sub serverul PHP încorporat nu există alt
handler. De aceea `Storage::serve()` răspunde el pe prefixul ăsta, înaintea
routerului și înaintea autentificării — exact poziția pe care o are
`app.use('/uploads', express.static(...))` în aplicația Node, cu aceleași opțiuni:
fișier inexistent = 404, nu trecere mai departe, și aceeași fereastră de cache de
o oră. Paznicul de traversare din `resolve()` se aplică și aici, iar o cheie
respinsă devine 404, nu 500 — o sondă nu trebuie să învețe nimic din diferență.

Fără asta, un import ar scrie fișiere pe care nimic nu le poate afișa.

## Ce nu am portat

**Încărcarea de fișiere.** Nu există `POST /assets` nici în Node. `Storage`-ul e
portat integral (citire, publicare, `data:` URI), deci atât exportul cât și
importul de active funcționează.

## Verificat, și cum

| | |
|---|---|
| Paritate rute | 53 = 53, comparate automat între cele două backenduri |
| Structură | acolade/paranteze echilibrate, namespace conform directorului, clasă conformă fișierului, toate cu `strict_types`, niciunul cu tag de închidere |
| Referințe de clasă | toate se rezolvă la un fișier existent sau la un `use` |
| Sintaxă | nicio construcție din 8.2, 8.3 sau 8.4 — cele 17 tipuri de retur folosite sunt toate valide pe 8.1 |
| Deprecări 8.1 | niciun `null` trimis unui parametru intern non-nullable |

### Rulat efectiv, pe PHP 8.1.34

Verificările statice de mai sus au fost făcute înainte de a exista un PHP pe
mașina de dezvoltare. Între timp există, și backendul a fost pornit și pus sub
frontendul real, cu ambele backenduri legate la **aceeași bază de date**:

| | |
|---|---|
| `php -l` | fără erori de sintaxă pe toate fișierele |
| Autentificare | login prin UI cu `admin@omd.ro`, sesiune emisă de PHP |
| Cele 10 ecrane | toate se încarcă cu date reale prin PHP |
| Paritate de răspuns | **11 din 11 rute identice cu Node**, comparate pe JSON canonic (chei sortate), lungime și amprentă |
| Sesiuni | un token emis de PHP e acceptat de Node — `AUTH_SECRET` comun |
| Scriere | salvare de campanie din wizard: `PUT` 200, `version_number` 7 → 8, persistat |
| Concurență | `If-Match` învechit → 409 `STALE_VERSION`, iar rândul rămâne neatins |
| Dus-întors între backenduri | Node citește înapoi ce a scris PHP, octet cu octet |

Paritatea de răspuns e testul care contează, și e cel care a scos la iveală
diferența de fracțiune de secundă de mai sus. Cele două nepotriviri găsite au
fost reparate; comparația se reface pornind ambele backenduri și cerând aceleași
rute prin fiecare.

Notă despre `If-Match`: absența antetului **nu** e o eroare, scrierea trece
neverificată. Nu e o scăpare a portării — originalul Node face la fel
(`ifMatch ? Number(...) : null`), iar PHP reproduce comportamentul.

### Bază goală → sistem funcțional, verificat cap-coadă

Procedura din „De la o bază goală la un sistem funcțional" a fost rulată exact
așa cum e scrisă, pe o schemă golită complet, și dusă până la autentificare:

| | |
|---|---|
| `migrate` | 10 migrații, 41 de tabele + view |
| `seed-technical` | 3 roluri, cont ADMIN, parolă temporară afișată o dată |
| `import` × 4 | 6 campanii, 16 activări, 3 planuri anuale, 4 loturi |
| Autentificare | login prin API cu parola din seed → 200, `mustChangePassword: true` |
| Cele 11 rute | toate 200, cu datele importate |
| Imagini | activ publicat de import servit pe `/uploads/`, 115082 octeți, `image/jpeg` |

Adică o instalare nouă nu mai are nevoie de backendul Node pentru nimic.

### Importul, verificat pe o bază goală

Cele patru pachete DEMO_SEED au fost importate **de două ori, în două baze
golite complet**: o dată prin `php bin/import.php`, o dată prin `npm run import`.
Apoi conținutul ambelor a fost comparat rând cu rând.

| | |
|---|---|
| Conținut | **zero diferențe** — 875 de linii, 41 de tabele |
| Numere | identice pe fiecare entitate: 6 campanii, 16 activări, 78 KPI, 42 materiale, 34 instantanee |
| Fișiere | 8 active publicate, `checksum_sha256` și dimensiune identice între cele două rulări |
| Idempotență | a doua rulare: 0 create, 78 / 42 / 16 actualizate, niciun duplicat |
| Rollback | pachet valid ca schemă dar cu campanie inexistentă la a 16-a activare: prima activare, deja scrisă, **nu** a rămas; lotul e `FAILED` cu motivul; zero rânduri în `import_batch_items`; zero temporare rămase |
| Raport | aceeași ordine a entităților ca la Node |

Comparația nu se face pe dump-uri brute: fiecare `id` e un UUID nou la fiecare
import, deci un diff direct ar arăta diferențe la fiecare rând și n-ar demonstra
nimic. Fiecare id a fost înlocuit cu o etichetă derivată din rândul pe care îl
identifică (`campaigns#camp-002`), iar cheile străine au trecut prin aceeași
hartă. Relațiile supraviețuiesc comparației; aleatoriul nu. Singurele câmpuri
excluse sunt cele care înregistrează *când* a rulat importul, nu *ce* a scris.

Cele 78 de KPI-uri sunt confirmarea că deviația cu cheia scoped funcționează:
citită literal, specificația ar fi colapsat 78 de KPI-uri în 33.

Primul import a eșuat, și nu din cauza codului de import: `Storage::resolve()`
normaliza calea țintă la `/` dar compara rezultatul cu o rădăcină nenormalizată.
Pe Linux nu se vede — nu există backslash-uri — dar pe Windows `UPLOAD_DIR` are
forma mixtă `D:\…\omd-valea-jiului/storage/uploads`, deci **orice** cheie părea o
tentativă de evadare din rădăcină și publicarea oricărui fișier eșua. Rădăcina se
normalizează acum la fel ca ținta; paznicul de traversare e neschimbat și a fost
reverificat pe `../../etc/passwd`, `2026/../../../secret.jpg` și varianta cu
backslash-uri — toate respinse.

Ce rămâne neacoperit: **nu există teste automate** la niciun nivel, în niciunul
dintre backenduri. Tot ce e mai sus a fost rulat manual o dată.

Primul lucru de făcut pe gazdă, după încărcare:

```powershell
Get-ChildItem -Recurse -Filter *.php | ForEach-Object { php -l $_.FullName } | Select-String -NotMatch 'No syntax errors'
curl.exe -s https://exemplu.ro/api/v1/health
curl.exe -s https://exemplu.ro/api/v1/health/ready
```
