# Task 2 — UI: acțiuni, adăugare, sortare în Administrare → Strategie

**Depinde de:** [`TASK-1_backend-strategie.md`](TASK-1_backend-strategie.md) și
[`SPEC_ADMIN_STRATEGIE.md`](SPEC_ADMIN_STRATEGIE.md)
**Stare:** propunere, în așteptarea aprobării

Cele patru acțiuni pe rând, butonul de adăugare, fișa de vizualizare, sortarea
după cod, editarea codului și a relațiilor program ↔ obiectiv.

Nu atinge ecranul `Repere strategice`.

---

## 1. Fișiere

```text
frontend/src/features/admin/StrategyAdminTab.tsx    rescris
frontend/src/features/admin/StrategyReperForm.tsx   nou — formularul de reper
frontend/src/features/admin/StrategyReperView.tsx   nou — fișa read-only
frontend/src/features/admin/DeleteReperDialog.tsx   nou — confirmarea cu dependențe
frontend/src/domain/sorting.ts                      nou — comparație naturală
frontend/src/styles/app.css                         extins — bara de acțiuni
tests/frontend/                                     suita de UI
```

`sorting.ts` stă în `domain/` fiindcă e o regulă pură, nu o preocupare de
prezentare — aceeași motivație ca `services.ts`.

---

## 2. Comportament

### 2.1. Acțiunile pe rând

Patru iconițe, în ordinea cerută. Fiecare are `title` și `aria-label` în text —
o iconiță fără nume nu e un buton, e o ghicitoare.

| Iconiță | Acțiune | Dezactivată când |
|---|---|---|
| `◉` | Vizualizează | niciodată |
| `✎` | Editează | niciodată |
| `⊘` | Dezactivează / Activează | niciodată |
| `🗑` | Șterge | `canDelete = false`, cu motivul în `title` |

Butonul de ștergere rămâne **vizibil** când e blocat, nu ascuns. Unul care
dispare lasă impresia că funcția nu există; unul dezactivat cu explicație spune
de ce.

Aceleași patru acțiuni pe rândul de versiune strategică, cu `⊘` însemnând
`Arhivează` și un al cincilea buton `Activează` pe versiunile neactive.

### 2.2. Vizualizarea

Panou inline sub rând, nu modal — se pot ține două fișe deschise pentru
comparație. Conține toate câmpurile tipului, obiectivele asociate (pentru
programe), numărul de referințe, starea, și data importului dacă există.

E singurul loc unde se văd toate cele 11 câmpuri ale unui program fără a intra
în modul de editare.

### 2.3. Adăugarea

Un buton `＋ Adaugă` la finalul listei, sub ultimul rând — lângă lista pe care o
extinde, nu în bara de filtre. Deschide același formular ca editarea, cu câmpul
`Cod` activ.

Sub câmpul `Cod`, ajutorul de convenție din spec §3.2: *„Convenția folosită în
această versiune: P5.1, P5.2, …”*, construit din primele coduri existente. Nu
blochează nimic.

### 2.4. Editarea codului

La editare, câmpul `Cod`:

- **activ**, dacă `usage.canEditCode` e `true`;
- **read-only**, altfel, cu motivul dedesubt: *„folosit în 6 campanii”* sau
  *„adus prin importul din 14.08.2026”*.

Motivul se ia din `GET .../usage`, cerut la deschiderea formularului. Un câmp
gri fără explicație e o ușă închisă fără indicație.

### 2.5. Relațiile program ↔ obiectiv

În formularul de program, o listă de obiective bifabile, doar din aceeași
versiune. Se trimit ca `objectiveCodes` odată cu restul câmpurilor. Ordinea
bifării devine ordinea din matrice.

### 2.6. Sortarea

Cap de tabel clicabil: `Cod`, `Denumire`, `Utilizat în`, `Stare`. Un click
sortează crescător, al doilea descrescător, al treilea revine la ordinea
implicită (`sort_order`). Indicator de direcție în antet.

Sortarea pe cod folosește `naturalCompare` din `domain/sorting.ts`.

Strict de afișare — `sort_order` nu se trimite nicăieri.

### 2.7. Ștergerea

Nu `window.confirm`. Un dialog care arată ce a răspuns `/usage`:

```text
Ștergi definitiv „P5.2 — Programul pentru Campanii Multicanal și Marketing B2C"?

  Utilizat în:        6 campanii        ← blochează
  Apare în matricea:  0 programe

Reperul nu poate fi șters. Îl poți dezactiva: rămâne rezolvabil în campaniile
existente, dar nu mai poate fi ales în înregistrări noi.

            [ Renunță ]  [ Dezactivează ]
```

Când ștergerea e permisă, aceeași structură cu butonul `Șterge definitiv`.

### 2.8. Clonarea la versiune nouă

În formularul de versiune, un selector: `Pornesc de la zero` sau
`Copiez reperele din …`, cu lista versiunilor existente. Sub el, ce se va copia:
*„4 piloni, 8 programe, 18 obiective și relațiile dintre ele”*.

---

## 3. Suita de teste

Se adaugă sub `tests/frontend/`, alături de `visual-parity/`, cu același
mecanism: Playwright peste mock API-ul alimentat din DEMO_SEED. Mock-ul se
extinde cu endpointurile din Task 1.

```bash
pwsh tests/frontend/run.ps1 -Only admin
```

### 3.1. Acțiuni și stări

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-01 | fiecare rând, pentru toate cele trei tipuri | exact 4 butoane de acțiune |
| AS-U-02 | fiecare buton de acțiune | are `aria-label` în text |
| AS-U-03 | reper folosit | `🗑` prezent dar `disabled` |
| AS-U-04 | `title` pe `🗑` dezactivat | conține motivul, nu doar „Șterge” |
| AS-U-05 | reper nefolosit | `🗑` activ |
| AS-U-06 | `⊘` pe un reper activ | devine inactiv, badge-ul se schimbă |
| AS-U-07 | rândul de versiune | are acțiunile ei, inclusiv `Activează` pe cele neactive |

### 3.2. Vizualizare

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-08 | `◉` pe un program | panou inline sub rând, nu modal |
| AS-U-09 | panoul unui program | toate cele 11 câmpuri prezente |
| AS-U-10 | panoul unui program | listează obiectivele asociate |
| AS-U-11 | `◉` pe două rânduri diferite | ambele panouri rămân deschise |

### 3.3. Adăugare și editarea codului

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-12 | `＋ Adaugă` | formular cu `Cod` activ |
| AS-U-13 | ajutorul de convenție | listează coduri existente din versiune |
| AS-U-14 | creare cu cod duplicat | eroarea de la API afișată, formularul rămâne deschis |
| AS-U-15 | creare cu `D6.1` într-o versiune `P5.x` | reușește — convenția nu blochează |
| AS-U-16 | editare reper nefolosit | `Cod` activ |
| AS-U-17 | editare reper folosit | `Cod` read-only + motivul vizibil |
| AS-U-18 | editare reper importat | `Cod` read-only + data importului |
| AS-U-19 | salvare program | body-ul conține toate coloanele |

AS-U-19 apără regula deja verificată în suita curentă: un formular incomplet ar
goli tăcut câmpurile pe care nu le trimite.

### 3.4. Relații

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-20 | formularul de program | listă de obiective bifabile |
| AS-U-21 | lista de obiective | doar din versiunea curentă |
| AS-U-22 | bifare + salvare | `objectiveCodes` în body, în ordinea din listă |
| AS-U-23 | debifare toate + salvare | `objectiveCodes: []`, relațiile șterse |

### 3.5. Sortare

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-24 | click pe `Cod` | ordine naturală — `P5.2` înaintea lui `P5.10` |
| AS-U-25 | al doilea click | ordine inversă |
| AS-U-26 | al treilea click | revine la `sort_order` |
| AS-U-27 | sortare pe `Utilizat în` | numeric, nu lexicografic |
| AS-U-28 | după sortare, `GET /strategy` | niciun `PUT` — datele neatinse |

### 3.6. Ștergere

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-29 | `🗑` pe reper nefolosit | dialog cu `Șterge definitiv` |
| AS-U-30 | dialogul | listează dependențele din `/usage` |
| AS-U-31 | reper folosit, dialog | oferă `Dezactivează`, nu ștergere |
| AS-U-32 | `Renunță` | nicio cerere trimisă |
| AS-U-33 | `409` de la API | mesajul serverului afișat, rândul rămâne |

### 3.7. Clonare

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-34 | formularul de versiune | selector `de la zero` / `copiez din …` |
| AS-U-35 | alegerea unei surse | afișează ce se va copia |
| AS-U-36 | creare cu clonare | `cloneFromExternalKey` în body |

### 3.8. Roluri și regresie

| ID | Verifică | Așteptat |
|---|---|---|
| AS-U-37 | `EDITOR` navighează direct la `/admin` | ecran care explică, fără crash |
| AS-U-38 | `VIEWER` la `/admin` | idem |
| AS-U-39 | `pwsh tests/frontend/run.ps1 -Only parity` | 22/22, 0 pixeli |
| AS-U-40 | consola pe `/admin` | zero erori (§69) |

AS-U-37 și AS-U-38 acoperă un caz pe care nu l-am verificat până acum: linkul
`Administrare` e ascuns pentru non-ADMIN, dar ruta există. Backendul răspunde
`403`; ecranul trebuie să spună asta, nu să rămână gol.

---

## 4. Definition of done

- [ ] cele 4 acțiuni pe fiecare rând, pentru toate cele trei tipuri și pentru versiuni
- [ ] `＋ Adaugă` la finalul fiecărei liste
- [ ] fișa de vizualizare, inline
- [ ] `Cod` editabil doar când API-ul spune că se poate, cu motivul afișat altfel
- [ ] relațiile program ↔ obiectiv editabile
- [ ] sortare naturală pe coloane, fără efect asupra datelor
- [ ] dialog de ștergere cu dependențe
- [ ] clonare la crearea unei versiuni
- [ ] toate testele din §3 trec
- [ ] suita de paritate rămâne 22/22
- [ ] zero erori în consolă pe `/admin`
