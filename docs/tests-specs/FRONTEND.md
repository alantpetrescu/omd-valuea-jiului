# Suita de frontend

**Depinde de:** [`README.md`](README.md) · **Rulează pe:** Node + Vite + mock API

Două feluri de test sub același acoperiș:

- **unitare**, în Node, fără browser — funcțiile pure din `src/domain/`;
- **de interfață**, cu Playwright peste aplicația reală și un API fals alimentat
  din `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json`.

Mock-ul e ce face suita rapidă și deterministă: aceleași date la fiecare rulare,
fără bază de date, fără curățenie.

**Ce nu e aici, și de ce.** Ecranele operaționale — campanii, activări, plan
anual, monitorizare — citesc date pe care mock-ul nu le are. Ca să le testăm pe
el, ar trebui să-l învățăm să răspundă ca un backend: încă o implementare, pe care
n-o exercită nimic altceva și care se depărtează în tăcere de cea adevărată. Așa
că rulează în [`tests/hybrid/screens.spec.mjs`](../../tests/hybrid/screens.spec.mjs),
peste backendul real, în regim de citire. ID-urile lor rămân `F-*`, fiindcă ce
verifică e tot forma ecranului.

Cazurile marcate **[existent]** sunt mutate din vechiul `frontend/tests/`.

```powershell
pwsh tests/frontend/run.ps1              # unitare + Administrare
pwsh tests/frontend/run.ps1 -All         # și paritatea vizuală
pwsh tests/frontend/run.ps1 -Only unit
```

---

## 1. Unitare — funcții pure · `F-U-01…U16` **[nou]**

`src/domain/services.ts` și `src/domain/sorting.ts` conțin toată aritmetica pe
care o vede utilizatorul: rate, costuri, perioade, acorduri gramaticale. Nimic
nu le verifica până acum, deși sunt exact felul de cod care se strică tăcut — o
împărțire la zero dă `Infinity`, iar `Infinity` se afișează frumos.

Rulează în milisecunde, fără browser: sursa `.ts` se importă direct, fiindcă Node
îi scoate singur tipurile de la 22.18 încolo. Fără pas de compilare, fără copie —
fișierul testat e fișierul livrat.

| ID | funcție | cazuri |
|---|---|---|
| `F-U-01` | `countLabel` | `1 campanie`; `4 campanii`, `19 campanii`; `20 de campanii`, `1.284 de mențiuni` |
| `F-U-02` | `countLabel` | pragurile: 101 fără `de`; 0, 100 și 120 cu `de` |
| `F-U-03` | `naturalCompare` | aceiași vectori ca `AS-B-U01…U04` |
| `F-U-04` | `naturalCompare` | lista întreagă: `P5.1, P5.2, P5.3, P5.10, P5.20` |
| `F-U-05` | `getTemporalSituation` | trecut, curent, viitor — și **gol** pentru tot ce nu e `ACTIVE` |
| `F-U-06` | `getTemporalSituation` | ziua de început și ziua de final sunt **incluse** |
| `F-U-07` | `overlapsYear` | intervale care intră, ies, cuprind anul; unul incomplet nu aparține niciunui an |
| `F-U-08` | `calculateEngagementRate` | se raportează la **reach**, nu la afișări; reach zero → `null` |
| `F-U-09` | `calculateCTR`, `calculateCPC`, `calculateCPM` | numitor zero → `null`, nu `Infinity` |
| `F-U-10` | `calculateInteractions` | suma; toate lipsă → `null`, nu `0` |
| `F-U-11` | `formatNumber`, `formatMoney` | separatorul românesc; `null` → `—` |
| `F-U-12` | `formatPercent` | zecimalele cerute; `null` → `—` |
| `F-U-13` | `formatDate`, `formatDateTime`, `formatPeriod` | dată invalidă → `—`, nu `Invalid Date` |
| `F-U-14` | `parseDate` | `null`, `''` și un șir aiurea → `null` |
| `F-U-15` | `seasonalityPeriodLabel` | interval, enumerare, `Tot anul`, `Luni neconfigurate`, iarna care trece peste an |
| `F-U-16` | `seasonalityMonthsLabel`, `seasonalityBands` | listă goală → text de rezervă; duplicate și luni imposibile, ignorate |

`F-U-08…F-U-10` sunt cele care justifică secțiunea. Distincția dintre „zero" și
„nu se știe" e singura care contează într-un raport: o rată de angajament de 0%
afirmă ceva despre campanie, iar `—` recunoaște că nu avem cifra.

`F-U-05` a corectat o presupunere a specificației: funcția nu întoarce o situație
pentru orice activare, ci **doar pentru cele active**. Un Draft ale cărui date
includ ziua de azi nu e „În desfășurare" — nu e în desfășurare deloc.

`F-U-03` repetă intenționat vectorii testați în PHP. Regula de ordonare are
**două implementări**, una în fiecare limbaj; dacă se depărtează, lista din
Administrare ajunge în altă ordine decât cea din API, iar amândouă par corecte
privite separat.

---

## 2. Paritate vizuală · 22 de stări [existent]

Ecranul `Repere strategice` trebuie să fie **identic la pixel** cu prototipul
v13.3. Nu „asemănător": comparația e pe imagini, iar pragul e zero.

| mod | stări |
|---|---|
| static | 12 — matrice, carduri și fișă pentru sinteză, programe și publicuri |
| interactiv | 10 — căutări, inclusiv cu diacritice și fără rezultate, fișe deschise, salt între obiective |

Se compară capturi ale prototipului cu capturi ale aplicației, la aceeași lățime
și cu aceleași date. Un `DIFF px` diferit de zero e eșec, oricât de mic.

**De ce ecranul acesta și nu altele:** e singurul cu obligație de identitate.
Restul aplicației trebuie să funcționeze; acesta trebuie să arate la fel.

Cele 12 stări statice se repetă **și ca ADMIN** — editarea reperelor stă în
Administrare, deci ecranul operațional rămâne o proiecție read-only pentru toate
rolurile.

**Mock-ul pentru paritate pornește fără `ADMIN_STRATEGY`.** Cu flagul pus, apar
un program `P5.10` și o a doua versiune strategică — necesare suitei de
Administrare, absente din seed-ul prototipului. Cu ele, toate cele 22 de stări ar
diferi printr-un rând în plus, iar comparația ar măsura fixture-ul în loc de
randare.

---

## 3. Poarta de rol · `AS-U-37…38` [existent]

| ID | rol | verifică |
|---|---|---|
| `AS-U-37` | EDITOR | `/admin` explică, nu crapă; nicio filă nu se încearcă |
| `AS-U-38` | VIEWER | idem |
| `AS-U-37c` | ADMIN | vede în continuare ecranul complet |

Ruta `/admin` există pentru toată lumea, doar linkul e ascuns. Înainte de
`AS-U-37`, cine ajungea acolo primea ecranul întreg și șase erori `403`.

Poarta se verifică și pe API, și pentru celelalte ecrane, în
[`BACKEND.md`](BACKEND.md) §4.2 și în parcursul `H-07`.

---

## 4. Administrare · `AS-U-01…36` [existent]

Tabelul complet e în [`TASK-2_ui-strategie.md`](../TASK-2_ui-strategie.md) §3.
Grupele:

| grup | ID-uri | ce acoperă |
|---|---|---|
| acțiuni pe rând | `AS-U-01…07` | patru iconițe, stări, butonul blocat care rămâne vizibil |
| fișa inline | `AS-U-08…11` | panou sub rând, două deschise simultan, toate cele 11 câmpuri |
| adăugare și cod | `AS-U-12…19` | modal, ajutorul de convenție, codul blocat cu motivul |
| relații | `AS-U-20…23` | obiectivele bifabile, ordinea, golirea |
| sortare | `AS-U-24…28` | naturală, în trei stări, fără efect asupra datelor |
| ștergere | `AS-U-29…33` | dialog cu dependențe, dezactivare în loc de ștergere, `409` |
| clonare | `AS-U-34…36` | selectorul, previzualizarea, `cloneFromExternalKey` |

### 4.1. Modale de creare și editare [existent]

Cele 15 verificări din `admin-edit.spec.mjs`: modalul de adăugare peste pagină,
cel de editare cu `MOD EDITARE` și datele existente, codul `disabled` pe o
valoare folosită, cu motivul, și cele trei editoare — pilon, program, obiectiv —
cu toate coloanele lor și cu `PUT`-ul care le duce pe toate.

### 4.2. API învechit [existent]

Cele 6 verificări din `stale-api.spec.mjs`. Un backend care servește o compilare
veche răspunde `200` fără `campaigns` și `audiences`; ecranul trebuie să
diagnosticheze, nu să afișeze zero. „0/8 programe asociate" dintr-un răspuns
incomplet ar fi un răspuns greșit, spus cu convingere.

Mock-ul se repornește cu `LEGACY=1` doar pentru acest test și se readuce la
normal imediat după — altfel toate testele următoare ar vedea un ecran strategic
fără campanii.

---

## 5. Ecranele operaționale · `F-C`, `F-W`, `F-V`, `F-E`, `F-M`, `F-S`, `F-H` **[nou]**

Rulează în suita hibridă, peste backendul real. Doar citiri: nimic din ele nu
scrie, deci pot rula lângă parcursuri fără să le tulbure.

### 5.1. Campanii · `F-C-01…C10`

| ID | verifică |
|---|---|
| `F-C-01` | lista randează campanii (carduri implicit, rânduri în vederea listă) |
| `F-C-02` | căutarea filtrează |
| `F-C-03` | căutarea ignoră diacriticele și majusculele |
| `F-C-04a` | un rând selectat umple panoul de previzualizare |
| `F-C-04b` | campania se deschide într-un panou, **fără să schimbe adresa** |
| `F-C-05` | panoul are secțiuni |
| `F-C-06` | comutatorul de mod de citire |
| `F-C-09` | după închidere, pagina redevine derulabilă |
| `F-C-10` | subtitlurile din panou nu poartă indici (`5. `) |

`F-C-09` e defectul din 20.08: efectul care ținea blocarea scroll-ului avea
`openActivation` în dependențe, deci fiecare re-rulare salva valoarea deja
blocată ca fiind cea de restaurat. Pagina rămânea înghețată cu tot ce era pe ea
închis.

### 5.2. Wizardul de campanie · `F-W-01…W05`

| ID | verifică |
|---|---|
| `F-W-01a` | cei opt pași |
| `F-W-01b` | și indicatorul de progres |
| `F-W-02` | „Continuă" nu avansează cu câmpuri obligatorii goale |
| `F-W-03` | și mesajul numește ce lipsește, nu doar „date invalide" |
| `F-W-05` | pe `/edit`, formularul vine cu datele existente |

`F-W-05` nu e o formalitate: un editor care se deschide gol e mai rău decât unul
care refuză să se deschidă — arată gata de lucru, iar salvarea lui șterge fișa.

### 5.3. Activări și editorul lor · `F-V-01…V07`, `F-E-01…E02`

| ID | verifică |
|---|---|
| `F-V-01a` | cele șase carduri de statistici |
| `F-V-01b` | tabela cu rândurile ei |
| `F-V-02` | acțiunile de pe rând sunt iconițe |
| `F-V-03` | butonul de reîmprospătare **nu navighează** |
| `F-V-04` | tooltipul lui: `Actualizează rezultate sociale` |
| `F-V-05` | tabela rămâne pe ecran cât se reîncarcă |
| `F-V-06` | activarea se deschide într-un panou |
| `F-V-07` | panoul are subtaburi |
| `F-E-01a` | editorul randează cu datele existente |
| `F-E-01b` | și oferă „Salvează modificările", nu „Salvează activarea" |
| `F-E-02` | secțiunile lui, inclusiv materiale și KPI |

`F-V-05` acoperă reîncărcarea tăcută: o reîmprospătare de rând nu are voie să
golească toată tabela, altfel butonul care arată progresul dispare cu ea.

### 5.4. Monitorizare · `F-M-01…M03`

| ID | verifică |
|---|---|
| `F-M-01a` | clic pe un material deschide panoul activării |
| `F-M-01b` | pe subtabul **Materiale și canale** |
| `F-M-02` | materialul cerut primește clasa `material-focus` |
| `F-M-03` | și e vizibil pe ecran |

Fără instantanee în bază, testele astea **pică** cu mesajul care spune ce lipsește
— nu trec ca „sărite". Un test care raportează succes fiindcă n-a avut ce
verifica e o linie verde care nu înseamnă nimic.

### 5.5. Restul ecranelor · `F-S-01…S07`

Plan anual, Monitorizare reputație, Repere strategice și Despre aplicație
randează conținut; tabul `Date & import/export` are banda de stare și cardurile;
iar la 880px pagina **nu** derulează orizontal — un singur nume de fișier
neîntrerupt a lărgit cândva tot tabul cu 29 de pixeli, și bara apărea abia pe
ecranele mici, unde nimeni nu se uita.

### 5.6. Sănătate generală · `F-H-01…H-03`

| ID | verifică |
|---|---|
| `F-H-01a` | nicio excepție neprinsă, pe niciun ecran parcurs |
| `F-H-01b` | nicio eroare de aplicație în consolă |
| `F-H-02` | nicio cerere eșuată neintenționat |
| `F-H-03` | fonturile se încarcă |

`F-H-01b` numără doar excepțiile și erorile scrise de aplicație. Un
`Failed to load resource` pentru un `401` de dinainte de autentificare nu e un
defect, iar dacă l-am număra, singurul mod de a trece ar fi să ștergem testele
care provoacă refuzuri ca să dovedească tratarea lor.

`F-H-03` există fiindcă fonturile au lipsit săptămâni întregi fără ca cineva să
observe: cele de rezervă seamănă destul cât să nu sară în ochi, iar singurul
semn era în consolă.

---

## 6. Ce nu se testează aici

| subiect | unde |
|---|---|
| regulile de business | [`BACKEND.md`](BACKEND.md) |
| contractul dintre front și back | [`README.md`](README.md) §5, parcursurile `H-*` |
| forma răspunsurilor API | BACKEND.md — pe mock vin din fixture, deci nu dovedesc nimic despre server |
