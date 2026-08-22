# OMD Valea Jiului — Architecture Risk Review v1

**Data:** 13 august 2026  
**Scop:** evaluare critică a riscurilor de evoluție pe 3–7+ ani.  
**Principiu:** se modifică acum numai elementele care evită blocaje structurale; restul sunt documentate ca extensii viitoare, fără overengineering în v1.

**Actualizare:** continuitatea unei campanii între două StrategyVersions este rezolvată prin lineage/duplicare controlată.

## 1. Concluzie executivă

Arhitectura actuală este potrivită ca **modular monolith** pentru un singur OMD și poate evolua fără rescriere totală dacă sunt respectate boundary-urile din FULLSTACK spec.

Au fost identificate și corectate acum patru riscuri structurale:

1. lipsa versionării strategiei;
2. câmp DB legat explicit de anul 2028;
3. incompatibilitate între `purpose` din JSON contracts și CHECK-ul MySQL;
4. lipsa unor reguli ferme de compatibilitate API/import, pagination și integrare prin adapters.

Nu este recomandată transformarea v1 într-o platformă generică/plugin system. Asta ar crește riscul de implementare fără beneficiu imediat.

---

## 2. CRITIC — schimbarea strategiei OMD

### Problema inițială

`strategic_objectives.code`, `strategic_programs.code` și `strategic_pillars.code` erau unice global.

Dacă în 2030 OMD introduce o strategie nouă și reutilizează `OS2` cu alt sens, existau două variante rele:
- overwrite al OS2 vechi → campaniile istorice ar părea că au urmărit noul obiectiv;
- inventarea forțată a altui code doar pentru DB.

### Corecția făcută

S-a introdus:

```text
strategy_versions
```

iar unicitatea strategică devine:

```text
(strategy_version_id, code)
```

Campaign și Activation persistă `strategy_version_id`.

**Impact:** o strategie nouă nu cere rescrierea aplicației sau a campaniilor istorice.

---

## 2.1. HIGH — aceeași campanie continuă în noua strategie

Un singur Campaign legat la două StrategyVersions ar produce ambiguitate pentru obiective și Activations.

Soluția adoptată:

```text
1 Campaign = 1 StrategyVersion
campaign_family_external_key = linia comună
supersedes_campaign_id = predecessor
```

`Continue in new strategic cycle` creează Campaign nou DRAFT și nu copiază Activation/AnnualPlan/Monitoring.

Activation derivată moștenește StrategyVersion din Campaign.

---

## 3. CRITIC — câmpul `result_2028`

### Problema

DB avea:

```text
strategic_programs.result_2028
```

O strategie 2029–2033 ar fi păstrat o coloană cu un an mort în nume.

### Corecția

DB folosește:

```text
horizon_result_text
```

Contractul JSON v1 poate păstra temporar `result2028` pentru compatibilitate. Un contract viitor poate redenumi câmpul fără migration DB.

---

## 4. CRITIC — package purpose incompatibil cu SQL

Campaign/Activation contracts permit:

```text
DEMO_SEED
INITIAL_IMPORT
UPDATE
AD_HOC
```

Monitoring contracts permit:

```text
BASELINE
QUARTERLY_IMPORT
DEMO_SEED
AD_HOC
```

SQL-ul permitea doar a doua familie, ceea ce ar fi făcut ca un `INITIAL_IMPORT` real să treacă JSON validation și să eșueze la DB.

CHECK-ul MySQL a fost corectat la reuniunea valorilor.

---

## 5. CRITIC — evoluția API și JSON contracts

Fără o politică de versionare, o integrare viitoare poate obliga frontend-ul și importerul să fie rescrise simultan.

### Regula v1

REST:
```text
/api/v1
```

Breaking changes → versiune nouă.

Imports:
```text
(packageType, schemaVersion)
→ validator
→ version adapter
→ canonical DTO
→ domain service
```

Nu se rescrie parserul v1 „în loc” când apare v2.

---

## 6. HIGH — creșterea volumului de monitoring

Monitoring poate crește mult mai repede decât Campanii/Activări.

### Corecție făcută

List/history API este paginabil din v1.

### Dacă volumul devine foarte mare

Pot fi adăugate ulterior:
- agregări;
- partitioning;
- materialized summary tables;
- warehouse/BI.

Nu este necesar acum.

---

## 7. HIGH — integrări directe cu alte sisteme

Scenarii:
- Social Insider;
- Zelist;
- Google Analytics;
- CRM;
- review providers;
- alte API-uri.

### Risc

Dacă fiecare integrare scrie direct în MySQL, core-ul devine dependent de furnizori.

### Guardrail

```text
Provider API
→ Adapter
→ canonical DTO
→ existing application/import service
→ DB
```

Provider-specific code nu intră în Campaign/Activation core.

Acest lucru permite schimbarea furnizorului fără rescrierea modulelor principale.

---

## 8. HIGH — schimbarea storage-ului

V1 poate folosi filesystem local.

Dacă ulterior serverul se schimbă sau se dorește object storage, path-uri locale împrăștiate prin cod ar crea cost mare de migrare.

### Guardrail

Backend folosește `AssetStorage`.

`storage_path` este storage key opac.

Migrarea la S3/MinIO/Azure Blob rămâne implementarea unui nou adapter + migrarea fișierelor.

---

## 8.1. HIGH — ștergeri și integritate referențială

Două extreme sunt greșite:
- „nu ștergem niciodată nimic” → se acumulează erori/test values;
- „lăsăm SQL să decidă” → UX slab și risc de cleanup destructiv.

Soluția:
- master `is_system=1` → protejat;
- non-system + zero referințe → delete fizic;
- non-system + referințe → delete blocat/deactivate;
- Campaign/Activation istorice → CLOSED, nu delete;
- dependency checks în backend;
- `409 ENTITY_IN_USE`;
- FK RESTRICT safety net;
- staging reset separat și imposibil în production.


## 9. MEDIUM-HIGH — Campaign și Annual Plan nu au business revision history complet

Există:
- `version_number` pentru optimistic concurrency;
- `audit_log`.

Nu există încă:
- CampaignRevision cu snapshot complet;
- AnnualPlanRevision/Approval.

### Când devine problemă

Dacă OMD va cere:
- „arată exact versiunea aprobată la 15 martie 2028”;
- workflow formal de aprobare;
- semnare/lock a unui Plan anual;
- comparații între versiuni aprobate.

### Recomandare

NU construi acum aceste tabele dacă nu există cerință contractuală.

Dacă apare cerința, se pot adăuga:

```text
campaign_revisions
annual_plan_revisions
approval_events
```

fără schimbarea external keys ale entităților curente.

---

## 10. MEDIUM-HIGH — produse și canale Campaign sunt narative JSON

Actual:

```text
Campaign.products
Campaign.channels
Activation.products
```

sunt texte descriptive.

### Avantaj

Flexibilitate editorială.

### Limită

Dacă peste câțiva ani se dorește analytics strict:

```text
câte campanii au promovat produsul X?
ce buget s-a dus pe produsul Y?
ce rezultate au avut campaniile pe categorie?
```

textul liber nu este o bază bună de agregare.

### Recomandare

Nu schimba v1 doar pentru o nevoie ipotetică.

Dacă OMD confirmă că vrea raportare structurată pe produse/canale, adăugați ulterior relații opționale:

```text
campaign_product_tags
campaign_channel_tags
activation_product_tags
```

păstrând textul narativ separat.

Acesta este un add-on, nu o rescriere.

---

## 11. MEDIUM — multilingual content

Aplicația internă este în română și Campaign content este în principal single-language.

Dacă sistemul va deveni și content repository multilingv, actualele câmpuri text nu oferă traduceri per locale.

### De ce nu este critic acum

Identitatea este deja bazată pe:
- IDs;
- codes;
- external keys;

nu pe label.

Se pot adăuga ulterior translation tables:

```text
campaign_translations
catalog_translations
strategy_translations
```

fără schimbarea FK-urilor de bază.

Nu recomand implementarea lor în v1 fără cerință.

---

## 12. MEDIUM — roluri mai granulare / SSO

V1:

```text
ADMIN
EDITOR
VIEWER
```

un rol per user.

Dacă ulterior apar:
- aprobatori;
- agenții externe;
- acces limitat pe modul;
- SSO Microsoft/Google;
- service accounts;

va fi nevoie de extindere.

Schema actuală poate migra la:

```text
permissions
role_permissions
user_roles
```

și auth provider adapters.

Nu este motiv de overengineering acum.

---

## 13. MAJOR dacă apare — multi-tenant / folosirea aplicației de mai multe OMD-uri

Schema actuală este **single-organization**.

Nu există `tenant_id` pe business tables.

Dacă produsul devine SaaS pentru mai multe OMD-uri izolate în aceeași bază, aceasta este o schimbare mare.

### Decizie recomandată acum

Documentați explicit invariantul:

> v1 este aplicație pentru un singur OMD / o singură organizație.

Dacă în viitor se dorește produs multi-tenant, proiectați migrarea separat. Nu adăugați `tenant_id` peste 40 de tabele acum doar pentru o ipoteză neconfirmată.

---

## 14. MEDIUM — mai multe strategii active simultan

v1 permite structural mai multe StrategyVersions, dar service rule este un singur `ACTIVE`.

Dacă OMD ajunge să lucreze simultan cu:
- strategie turistică;
- strategie de marketing;
- strategie de brand;
- strategie pentru un program special;

ca axe independente, poate fi necesar un concept superior de `strategy_type`.

Schema actuală poate extinde `strategy_versions` cu `strategy_type_id` ulterior.

Nu este necesar acum dacă există un singur cadru strategic operațional.

---

## 15. MEDIUM — module noi

Modular monolith este adecvat.

Un modul nou trebuie să primească:
- propriile migrations;
- backend feature;
- API endpoints;
- React feature;
- tests.

Nu trebuie introdus un „generic module builder” sau plugin engine în v1.

Exemple de module ce pot fi adăugate fără rescriere core:
- parteneri/operatori;
- evenimente;
- CRM;
- proiecte/finanțări;
- media library;
- indicatori turistici;
- integrare analytics;
- workflow aprobări.

---

## 16. Ce trebuie verificat la code review

Reject dacă programatorul:
- hardcodează strategiile/nomenclatoarele în React;
- folosește codul strategic fără StrategyVersion;
- scrie business logic direct în controllers;
- permite provider adapters să scrie SQL direct;
- pune absolute file paths în domain objects;
- construiește list APIs fără pagination contract;
- schimbă schema production manual;
- reutilizează un master code cu alt sens;
- face breaking API changes în `/api/v1` fără adapter/version;
- amestecă DEMO_SEED cu production.

---

## 17. Verdict

Cu modificările consolidate în FULLSTACK v1.5 / package v6 FINAL, sistemul este suficient de flexibil pentru evoluția realistă a unui OMD pe mai mulți ani **fără a proiecta acum o platformă generică exagerată**.

Cele mai importante garanții sunt:
1. strategie versionată;
2. external keys stabile;
3. master data semantic immutable;
4. migrations versionate;
5. API/import contracts versionate;
6. modular monolith;
7. adapters pentru storage și integrări;
8. pagination pentru date istorice.

Scenariul care ar cere cea mai mare schimbare rămâne transformarea aplicației într-un produs multi-tenant pentru mai multe organizații. Acesta este intenționat în afara scope-ului v1.
