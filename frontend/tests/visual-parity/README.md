# Visual parity — Repere strategice vs. prototipul v13.3

Spec §54 cere ca ecranele live să reproducă prototipul. Pentru `Repere
strategice` verificarea nu este „la ochi”: suita rulează prototipul și
aplicația React una lângă alta, le plimbă prin aceleași stări și le compară
pixel cu pixel.

## Ce compară

Regiunea `.content` — pagina propriu-zisă, fără sidebar și topbar, care diferă
legitim (prototipul are butonul „Ajutor”, aplicația are meniul de utilizator).

Fiecare stare trece prin două verificări independente, pentru că fiecare
singură minte:

- **diff de pixeli** (`pixelmatch`) — prinde spacing, culori, font metrics;
- **diff de text** — prinde cifre greșite, ordonare greșită, rânduri lipsă, pe
  care un diff de pixeli le-ar arăta doar ca o pată.

O stare trece doar dacă amândouă sunt de acord.

## Stările acoperite

22 în total: 12 statice (3 tab-uri × 3 moduri de vizualizare, plus cele patru
sub-toggle-uri Programe/Obiective și Publicuri/Produse) și 10 de interacțiune
(căutare, căutare fără diacritice, căutare fără rezultate, selecție în fișă,
salt din panoul de semnale, deschiderea fișei dintr-un card).

Plus verificări care nu au corespondent în prototip:

- **role gate** — ecranul e read-only pentru toate rolurile, ADMIN inclusiv;
  niciun câmp, buton de salvare sau bloc de editare pe fișă;
- **compararea ca ADMIN** — trebuie să fie identică, fără excepție, pentru că
  editarea reperelor stă în `Administrare → Strategie` (abaterea D-002);
- **admin-edit** — tab-ul Strategie din Administrare: toate cele trei tipuri de
  reper sunt editabile, codul nu apare ca un câmp, PUT-ul e scoped pe versiune
  și duce toate coloanele (un formular incomplet ar goli restul), iar un reper
  utilizat oferă dezactivare, nu ștergere;
- **stale-api** — un backend mai vechi decât ecranul (build compilat nereîmprospătat)
  răspunde 200 fără `campaigns` și `audiences`. Ecranul trebuie să explice asta, nu
  să crape și nici să deseneze acoperire zero.

## De unde vin datele

Din `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json`, pentru amândouă părțile.
Prototipul îl încarcă prin propriul `omd_import_packages_v1.js`; partea React îl
primește printr-un mock API care aplică aceeași mapare JSON → DB → DTO pe care o
face backendul. Comparația nu are deci nevoie de MySQL.

Asta testează randarea, nu SQL-ul. Pentru stack-ul real, rulează aceleași
capturi cu `OMD_APP_URL` pointat spre staging, după importul celor patru
DEMO_SEED.

## Cerințe

- Node 20+, `python3` (serverul static pentru prototip)
- `npm i -D playwright pixelmatch pngjs` în `frontend/`
- pachetul de handoff dezarhivat lângă repo, ca `../programmer_full_package_FINAL`

## Rulare

```bash
bash frontend/tests/visual-parity/run.sh
```

Variabile utile:

| Variabilă | Implicit | Rol |
|---|---|---|
| `OMD_PACKAGE_DIR` | `../programmer_full_package_FINAL` | rădăcina pachetului de handoff |
| `OMD_APP_URL` | `http://127.0.0.1:5174/strategic` | pagina React de testat (pointeaz-o spre staging pentru stack-ul real) |
| `OMD_CHROMIUM` | binarul Playwright | Chromium alternativ |
| `OMD_PARITY_WORK` | `tests/visual-parity/.work` | unde ajung capturile și diff-urile |

Capturile, diff-urile și `report-*.json` rămân în directorul de lucru. Un diff
apare ca imagine doar când există pixeli diferiți, deci un director `diff-*`
gol înseamnă potrivire perfectă.

## Rezultat la ultima rulare

```
static:       12/12 identice (0 pixeli diferiți)
interactive:  10/10 identice (0 pixeli diferiți)
role gate:    3/3 (VIEWER, EDITOR, ADMIN — toate 0 controale de scriere)
admin (static): 12/12 identice, fără excepție
admin-strategy: 14/14
stale-api:    6/6
```
