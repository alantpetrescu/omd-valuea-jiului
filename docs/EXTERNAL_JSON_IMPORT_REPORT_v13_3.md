# OMD Valea Jiului — External JSON Import Report v13.3

Data verificării: 13 august 2026

## Arhitectura de test

Versiunea `OMD-Valea-Jiului-prototip_external_json_v13_3.html` nu mai conține fixture-urile demo de campanii, activări, vizualuri sau valorile reputaționale. Datele sunt livrate prin patru pachete independente:

1. `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json`
2. `OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1.json`
3. `OMD_ACTIVATION_MONITORING_PACKAGE_DEMO_SEED_v1.json`
4. `OMD_REPUTATION_MONITORING_PACKAGE_DEMO_SEED_v1.json`

Importerul browser este `omd_import_packages_v1.js`.

## Conținut seed

- Campaigns package: 6 campanii; strategie; nomenclatoare; 8 assets vizuale base64.
- Activations package: 16 activări; 42 materiale; 2 planuri anuale.
- Activation monitoring package: 34 performance snapshots.
- Reputation monitoring package: 1 reputation snapshot.

## Rezultat import end-to-end

PASS:

- 6 campanii create;
- 16 activări create;
- 2 planuri anuale create;
- 34 materiale cu rezultate de monitorizare după import;
- 8 assets vizuale disponibile din JSON-ul de campanii;
- 12 materiale rezolvă un vizual propriu sau prin template asset;
- reputație încărcată: 1.284 mențiuni, 214 review-uri, rating 4,42, 67% pozitiv;
- zero page errors;
- campania `camp-002` este reconstruită din JSON cu titlul „Muntele nu are un singur sezon”.

Avertisment de date păstrat intenționat:

- activarea independentă folosește publicul custom „Public regional și vizitatori de weekend”, care nu are cod în nomenclatorul curent.

## Validare JSON Schema

Toate cele patru demo seed JSON validează cu 0 erori împotriva schemelor lor Draft 2020-12:

- `OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1.json` — PASS
- `OMD_ACTIVATIONS_PACKAGE_SCHEMA_v1.json` — PASS
- `OMD_ACTIVATION_MONITORING_PACKAGE_SCHEMA_v1.json` — PASS
- `OMD_REPUTATION_MONITORING_PACKAGE_SCHEMA_v1.json` — PASS

## Comportament HTML

La primul start prin HTTP, dacă repository-urile externe sunt goale, scriptul încearcă să încarce automat cele patru fișiere din același director. După primul seed, datele persistă în storage-ul prototipului și nu sunt reimportate la fiecare refresh.

Important: `fetch()` pentru fișiere externe trebuie rulat prin HTTP/HTTPS (server local sau staging), nu prin dublu-click `file://`.

În backend, același proces va fi tranzacțional și va scrie în DB/storage, nu în localStorage.
