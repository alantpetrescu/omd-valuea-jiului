# Documentație

Două familii de documente, cu regimuri diferite. Distincția contează la fiecare
modificare: unele sunt intrarea proiectului, celelalte sunt deciziile luate în
timpul lui.

## Specificațiile livrate

Copii ale documentelor din `programmer_full_package_FINAL/`. Originalele rămân
acolo, neatinse; aici sunt copiile de lucru, în care se adaugă deciziile de
implementare.

| document | ce conține |
|---|---|
| [`FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md`](FULLSTACK_IMPLEMENTATION_SPEC_v1_5.md) | specificația funcțională completă — 71 de capitole, de la scope la contractul de erori |
| [`ARCHITECTURE_RISK_REVIEW_v1.md`](ARCHITECTURE_RISK_REVIEW_v1.md) | riscurile identificate înainte de implementare |
| [`OMD_MYSQL_DATABASE_SPEC_v1.md`](OMD_MYSQL_DATABASE_SPEC_v1.md) | modelul de date — 41 de tabele și un view |
| [`OMD_MYSQL_DATABASE_VALIDATION_REPORT_v1.md`](OMD_MYSQL_DATABASE_VALIDATION_REPORT_v1.md) | validarea schemei față de contracte |
| [`BACKEND_READINESS_REPORT.md`](BACKEND_READINESS_REPORT.md) | ce era pregătit din partea de backend la livrare |
| [`DATA_PORTABILITY_REPORT.md`](DATA_PORTABILITY_REPORT.md) | cum circulă datele prin cele patru pachete JSON |
| [`EXTERNAL_JSON_IMPORT_REPORT_v13_3.md`](EXTERNAL_JSON_IMPORT_REPORT_v13_3.md) | mecanismul de import al prototipului v13.3 |
| [`ASSET_EXTRACTION_REPORT.md`](ASSET_EXTRACTION_REPORT.md) | de unde vin vizualele din pachetul demo |
| [`README_PROGRAMMER.md`](README_PROGRAMMER.md) | ghidul de pornire din pachet |
| [`PACKAGE_CHANGELOG.md`](PACKAGE_CHANGELOG.md) | istoricul versiunilor pachetului livrat |

**Modificările față de original se marchează cu subcapitol propriu**, ca
diferența să se citească dintr-o privire. Până acum trei:

- **§11.8.1** — adăugarea și editarea din `Administrare` se fac într-un modal
  peste pagină, cu un singur pas, marcat `MOD EDITARE` când actualizezi.
- **§11.8.2** — acțiunile pe rând sunt iconițe în toate cele trei liste, iar un
  buton indisponibil rămâne pe poziție cu motivul pe el.
- **§11.8.3** — stadiul unei campanii coboară la activările ei, fără să învie
  activările a căror perioadă s-a încheiat.

## Decizii luate în timpul implementării

Documente scrise aici, nu livrate.

| document | ce conține |
|---|---|
| [`SPEC_ADMIN_STRATEGIE.md`](SPEC_ADMIN_STRATEGIE.md) | modelul și regulile pentru administrarea reperelor strategice |
| [`TASK-1_backend-strategie.md`](TASK-1_backend-strategie.md) | API-ul complet pentru repere: nouă endpointuri, coduri de eroare, suita de teste |
| [`TASK-2_ui-strategie.md`](TASK-2_ui-strategie.md) | cele patru acțiuni pe rând, fișa inline, sortarea, clonarea |

## Unde sunt celelalte

- **abaterile de la specificație**: [`../KNOWN_DEVIATIONS.md`](../KNOWN_DEVIATIONS.md) — șapte, fiecare cu motivul
- **instalarea pe cPanel**: [`../deploy/`](../deploy/) — două ghiduri, câte unul per gazdă
- **stadiul implementării**: [`../README_IMPLEMENTATION.md`](../README_IMPLEMENTATION.md)
