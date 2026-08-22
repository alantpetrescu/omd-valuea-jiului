# Suita de backend

**Depinde de:** [`README.md`](README.md) · **Rulează pe:** `omd_vj_test`

Server PHP pornit de suită pe un port propriu, cereri HTTP reale, verificări
făcute și prin API și direct în baza de date. Ce se poate proba fără HTTP se
probează fără HTTP — e mai rapid și eșuează mai precis.

Cazurile marcate **[existent]** sunt mutate din `backend-php/tests/`; restul sunt
noi.

---

## 1. Unitare — reguli pure, fără bază de date

Rulează în proces. Nu ating nimic.

### 1.1. Ordinea naturală a codurilor · `AS-B-U01…U04` [existent]

| ID | verifică | așteptat |
|---|---|---|
| `AS-B-U01` | `naturalCompare('P5.2','P5.10')` | negativ |
| `AS-B-U02` | `naturalCompare('D6.10','D6.9')` | pozitiv |
| `AS-B-U03` | `naturalCompare('PILLAR_1','PILLAR_2')` | negativ |
| `AS-B-U04` | `naturalCompare('AB','AA')` | pozitiv |
| `AS-B-U01b` | sortarea unei liste întregi | `P5.1, P5.2, P5.3, P5.10, P5.20` |

Ultimul nu e redundant: perechile pot trece în timp ce ordinea pe care o implică
e greșită, fiindcă un comparator trebuie să fie tranzitiv.

### 1.2. Când e codul editabil · `AS-B-U05…U07`, `AS-B-A30` [existent]

`codeEditable(0,false)→true`, `(1,false)→false`, `(0,true)→false`.
`statusForNewVersion(0)→ACTIVE`, `(1)→DRAFT`.

### 1.3. Validarea codului · `AS-B-U08…U09` [existent]

Respinse: `''`, `'   '`, 65 de caractere, lipsă. Acceptate **neschimbate**:
`D6.1`, `p5.9`, `A-1`, `OS2`, `obiectiv 2`, 64 de caractere. Spațiile din jur se
taie — colația e NO PAD, deci `'P5.1 '` și `'P5.1'` ar fi două valori distincte
pentru un index UNIQUE.

`AS-B-U09` e testul care apără regula „validează, nu transforma". Un
`strtoupper()` strecurat acolo ar trece toate celelalte teste și ar rescrie tăcut
coduri alese de beneficiar.

### 1.4. Recunoașterea serverului · `AS-D-01…D02` [existent]

`10.11.18-MariaDB-cll-lve` și `11.4.2-MariaDB` → MariaDB; `8.0.46`, `8.4.24` →
nu. Iar `AS-D-02` ține scrisă capcana: `version_compare('10.11.18-MariaDB','8.0','>=')`
e **adevărat**, deci o verificare pe versiune ar fi declarat MariaDB drept MySQL 8.

### 1.5. Ce **nu** intră aici, deși pare că ar trebui

Acordul numeralelor (`countLabel`), formatările și aritmetica de KPI sunt tot
funcții pure — dar sunt scrise în TypeScript, iar suita asta rulează PHP. Stau
în [`FRONTEND.md`](FRONTEND.md) §1, care le execută în Node, fără browser, la
fel de ieftin.

Excepția e `naturalCompare`, care există în **ambele** limbaje. Se testează în
ambele suite, cu aceiași vectori, tocmai fiindcă sunt două implementări ale
aceleiași reguli: dacă se depărtează, lista din Administrare ajunge în altă
ordine decât cea din API și niciuna nu pare greșită privită singură.

---

## 2. Schemă și tranzacții · `AS-B-D01…D11`, `AS-D-03…D08` [existent]

Nu trec prin API. Dacă un `UNIQUE` sau un `ON DELETE RESTRICT` ar fi relaxat
într-o migrație, toate regulile de deasupra ar deveni orientative.

| ID | verifică |
|---|---|
| `AS-B-D01` | două repere cu același cod în aceeași versiune — respins |
| `AS-B-D02` | același cod în două versiuni — ambele acceptate |
| `AS-B-D03` | ștergerea unui pilon referit de o campanie — blocată de FK |
| `AS-B-D04` | ștergerea unei versiuni cu campanii — blocată |
| `AS-B-D05…D09` | clonarea: numere, relații, UUID-uri noi, coduri identice, campaniile vechi neatinse |
| `AS-B-D10` | ștergerea unui reper îi ia și rândurile din matrice |
| `AS-B-D11` | o ștergere eșuată la mijloc — rollback complet |
| `AS-D-03…D08` | cele două seturi de migrații nu s-au depărtat |

`AS-D-08` rulează generatorul cu `--check`. E singurul mod în care cele două
directoare pot ajunge diferite: cineva editează sursa și uită regenerarea.

---

## 3. Repere strategice, prin API · `AS-B-A01…A36` [existent]

Creare, editare, redenumire, ștergere, `usage`, versiuni, permisiuni, audit.
Tabelul complet e în [`TASK-1_backend-strategie.md`](../TASK-1_backend-strategie.md) §3.3;
nu-l copiez aici ca să nu existe două variante care se pot depărta.

Ce merită repetat, fiindcă sunt cazurile cu miez:

- `AS-B-A06` — `p5.9` se stochează exact `p5.9`;
- `AS-B-A14` — un `objectiveCode` din altă versiune dă `422` și **zero scrieri**;
- `AS-B-A19` — previzualizarea poate fi învechită: `usage` spune că se poate
  șterge, apare o campanie, `DELETE` dă totuși `409`, fiindcă verificarea se
  repetă în tranzacție;
- `AS-B-A36` — auditul unei redenumiri conține și codul vechi și pe cel nou.

Tot ce lipsea acolo se adaugă la §4.

---

## 4. Domenii noi

### 4.1. Autentificare și sesiune · `B-A-01…A09` **[nou]**

| ID | verifică | așteptat |
|---|---|---|
| `B-A-01` | login corect | `200`, cookie de sesiune, rolul în corp |
| `B-A-02` | parolă greșită | `401`, fără cookie |
| `B-A-03` | e-mail inexistent | `401`, **același mesaj** ca la parolă greșită |
| `B-A-04` | cont dezactivat | `401` |
| `B-A-05` | `GET /auth/me` fără cookie | `401` |
| `B-A-06` | cookie stricat | `401`, nu `500` |
| `B-A-07` | logout apoi `/auth/me` | `401` |
| `B-A-08` | `must_change_password` | raportat în `/auth/me` |
| `B-A-09` | limitatorul de rată | după 10 încercări greșite, refuz — `409` |

`B-A-03` e cel care contează: un mesaj diferit pentru „nu există contul" spune
atacatorului care adrese sunt reale.

**Două lucruri descoperite scriind testele astea**, amândouă trecute în
`KNOWN_DEVIATIONS.md`:

- `B-A-07` — logout golește cookie-ul, dar **nu revocă jetonul**: sesiunile sunt
  fără stare, deci nu există nimic de șters (D-008). Testul verifică ce se
  contractează — că răspunsul golește cookie-ul — și nu afirmă că jetonul vechi
  mai merge, fiindcă o verificare verde care spune asta s-ar citi ca intenție.
- `B-A-09` — limitatorul răspunde **409**, nu `429 Too Many Requests` (D-009).
  Testul cere refuzul, nu codul: unul care ar pretinde 429 ar pica la fiecare
  rulare fără să spună nimic despre dacă limitatorul funcționează.

`B-A-09` folosește o adresă proprie, de unică folosință. Limitatorul cheie pe
IP + e-mail, iar toate testele împart IP-ul — zece încercări greșite pe
`admin@test.local` ar bloca exact contul cu care rulează restul suitei.

### 4.2. Roluri, pe toată suprafața · `B-R-01…R06` **[nou]**

`AS-B-A32…A34` acoperă doar strategia. Aici se verifică restul.

| ID | rol | cerere | așteptat |
|---|---|---|---|
| `B-R-01` | VIEWER | orice `POST`/`PUT`/`DELETE` pe campanii | `403` |
| `B-R-02` | VIEWER | la fel, pe activări | `403` |
| `B-R-03` | EDITOR | scrieri pe campanii și activări | permise |
| `B-R-04` | EDITOR | orice pe `/admin/*` | `403` |
| `B-R-05` | VIEWER, EDITOR | `GET` pe fiecare rută de citire care nu e `/admin` | `200` |
| `B-R-06` | neautentificat | orice rută în afară de login și health | `401` |

Ultimele două se scriu prin **parcurgerea tabelei de rute**, nu printr-o listă
ținută de mână: o rută nouă adăugată fără gardă trebuie să pice testul, nu să-l
ocolească fiindcă nimeni n-a adăugat-o în listă. De aceea nici numărul rutelor
nu e scris aici — ar fi doar încă un loc de actualizat.

### 4.3. Campanii · `B-C-01…C12` **[nou]**

| ID | verifică | așteptat |
|---|---|---|
| `B-C-01` | `POST` valid | `201`, apare în listă |
| `B-C-02` | `POST` fără un câmp obligatoriu | `422`, zero scrieri |
| `B-C-03` | `POST` cu referințe inexistente (părinte, nomenclator, pilon) | `422` |
| `B-C-04` | `PUT` complet | `200`, toate coloanele numite scrise |
| `B-C-05` | `PUT` cu `If-Match` corect | `200`, `version_number` +1 |
| `B-C-06` | `PUT` cu `If-Match` vechi | `409 STALE_VERSION` |
| `B-C-07` | `PUT` fără `If-Match` | acceptat — antetul e opțional prin proiectare |
| `B-C-08` | `If-Match` nevalid (`"abc"`) | `422`, nu ignorat tăcut |
| `B-C-09` | `DELETE` | ștergere logică; dispare din listă, rândul rămâne |
| `B-C-10` | `POST restore` | revine în listă |
| `B-C-11` | `GET dependencies` | numără activările și machetele |
| `B-C-12` | `GET export` | pachet valid față de contractul JSON |

`B-C-03` a fost rescris față de prima versiune a specificației: cheia externă e
**generată de server** și nu poate fi trimisă, deci nu există un caz de duplicat
la intrare. Ce poate greși un client e o referință către ceva ce nu există, și
toate trei trebuie refuzate înainte de orice scriere.

`B-C-07` pare o scăpare și nu e: antetul e opțional prin proiectare, iar testul
ține decizia scrisă ca să nu fie „reparată" de cineva care o crede o omisiune.

### 4.4. Activări · `B-V-01…V08` **[nou]**

Creare, editare, materiale, KPI, perioade, apartenența la Planul anual.
`B-V-07` verifică faptul că situația în calendar **nu se stochează** — se
calculează la afișare, iar coloana nu există (spec §27).

### 4.5. Cascada stadiului · `AS-K-01…K13` [existent]

Campania în `DRAFT`/`CLOSED` coboară activările `ACTIVE`; revenirea în `ACTIVE`
le ridică **doar pe cele neîncheiate**; o dată de final lipsă înseamnă activare
deschisă. `AS-K-09` verifică faptul că un stadiu nechimbat nu atinge nimic, iar
`AS-K-12` că auditul spune și cauza, nu doar efectul.

### 4.6. Nomenclatoare și identitatea codului · `AS-C-01…C14` [existent]

Aceeași regulă ca la repere, plus condiția de sistem. `AS-C-11` e cel care ține
distincția: pe o valoare folosită, **eticheta se poate schimba, codul nu** —
altfel regula ar fi „rândul e read-only", ceea ce nu e.

### 4.7. Importuri · `B-I-01…I07` **[nou]**

Importul **nu are rută HTTP** — se rulează cu `php bin/import.php <pachet.json>`,
iar API-ul doar raportează ce s-a întâmplat (`GET /admin/imports`). Testele
cheamă deci CLI-ul și verifică în bază, nu prin cereri.

**Pachetul de campanii e exportul aplicației însăși**, cu cheile rescrise. Unul
scris de mână ar însemna o a doua idee, privată, despre ce e un pachet valid — și
în ziua în care cele două s-ar depărta, suita ar testa-o pe cea privată. Dus-întors
prin export mai dovedește ceva ce nimic altceva nu verifică: că ce scrie
aplicația, tot ea poate să citească.

| ID | verifică | așteptat |
|---|---|---|
| `B-I-01` | import de campanii pe bază goală | numerele de referință |
| `B-I-02` | același pachet, a doua oară | idempotent: zero duplicate |
| `B-I-03` | ordinea e a operatorului: greșită → eșec curat, corectă → trece |
| `B-I-04` | pachet cu referință inexistentă | eșec curat, fără scrieri parțiale |
| `B-I-05` | fișier șters de pe disc, apoi reimport | **fișierul revine** |
| `B-I-06` | un nomenclator redenumit din aplicație | nu e suprascris; apare ca avertisment |
| `B-I-07` | zero nu e același lucru cu lipsă | `0` rămâne `0`, `null` rămâne `null` |

`B-I-03` a fost și el rescris. Prima versiune a specificației presupunea că
runner-ul deduce ordinea din `packageType`; nu o face — procesează fișierele
exact cum i se dau. Testul verifică acum comportamentul real, care e cel corect:
activări înaintea campaniilor lor eșuează curat, cu campania lipsă numită în
mesaj și fără scrieri parțiale, iar aceleași două fișiere în ordinea bună trec.
Un importator care ar reordona singur ar fi comod până la rularea în care ordinea
chiar conta dintr-un motiv pe care el nu-l putea vedea.

`B-I-05` e defectul reparat pe 21.08: importul publica fișierul doar pe ramura de
asset nou, deci un rând care își pierduse fișierul nu-l mai putea recupera
niciodată.

### 4.8. Monitorizare · `B-M-01…M05` **[nou]**

Ultimul instantaneu per material, totalurile, istoricul, reputația, și faptul că
un instantaneu nou **nu suprascrie** unul vechi.

### 4.9. Fișiere și `/uploads` · `B-F-01…F05` **[nou]**

`/uploads` nu e nici el o rută a aplicației: în producție îl servește Apache
direct. Testele îl cer de la routerul care emulează `.htaccess` (README §4.4) și
verifică pe disc ce a scris backendul.

| ID | verifică |
|---|---|
| `B-F-01` | un vizual existent se servește cu tipul corect |
| `B-F-02` | lipsă → `404` în forma de eroare a aplicației |
| `B-F-03` | `../` în cheie → refuzat, nu servit |
| `B-F-04` | cheia se rezolvă la fel cu separatori nativi și normalizați |
| `B-F-05` | directoarele create sunt `0755`, nu `0770` |

`B-F-05` e defectul de pe 21.08: fișierele erau scrise corect, dar Apache nu
putea intra în directoarele care le conțineau, deci 404 pentru un fișier prezent.

### 4.10. Contractul de eroare · `B-E-01…E04` **[nou]**

Orice eroare are `code`, `message`, `details`, `requestId`. `404` pe o rută
inexistentă vine în aceeași formă, nu ca pagină de server. `500` nu scurge urma
stivei când `APP_ENV=production`. `409 ENTITY_IN_USE` poartă
`details.allowedAction`.

### 4.11. Paginare și meta · `B-P-01…P03` **[nou]**

`meta.total`, `meta.totalUnfiltered`, `meta.hasMore`; `pageSize` peste plafon e
plafonat, nu refuzat; `page` în afara intervalului dă listă goală, nu eroare.

---

## 5. Regresie · `AS-B-R02…R03` [existent]

Valorile de referință la finalul fiecărei rulări: 4 piloni, 8 programe, 18
obiective. Și `AS-B-R02` — niciun reper adus prin import nu are codul editabil,
adică invariantul care face importul idempotent.

O suită care își consumă propriul fixture trece o dată. Astea două sunt plasa.

---

## 6. Ce nu se testează aici, și unde se testează

| subiect | unde |
|---|---|
| forma ecranelor | FRONTEND.md |
| contractul dintre front și back | README.md §5, parcursurile `H-*` |
| regulile Apache | la instalare; runbook-urile spun ce se verifică |
