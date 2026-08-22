# OMD Valea Jiului — Asset Extraction Report v1

## Rezumat

- Fișier sursă campanii: `OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1(2).json`
- Fișier schemă: `OMD_CAMPAIGNS_PACKAGE_SCHEMA_v1(2).json`
- Fișier activări: `OMD_ACTIVATIONS_PACKAGE_DEMO_SEED_v1(2).json`
- HTML verificat: `OMD-Valea-Jiului-prototip_external_json_v13_3(2).html`
- Importer JS verificat: `omd_import_packages_v1(2).js`
- Base64/data URL imagini găsite în Campaign JSON: **8**
- Fișiere fizice create: **8**
- Assets unice după SHA-256: **8**
- Duplicate binare detectate: **0**
- ActivationMaterial cu `templateAssetId` nenul: **12**
- Referințe `templateAssetId` nerezolvate: **0**
- Mismatch Campaign/Template/Asset: **0**
- Base64 imagini în Activations JSON: **0**
- `data:image` în HTML: **3**, dintre care Base64: **0**
- `data:image` în importer JS: **0**
- Original Campaign JSON byte-for-byte nemodificat: **PASS**
- SHA-256 original: `57743e36d39b3409d85be92aabb063792f365089ae5eeb0d2f3cd03f900e466c`
- În copia external-assets au rămas `data:image` pentru assets: **0**
- Diferențe față de original care NU sunt `.src`: **0**
- Câmpuri `.src` înlocuite: **8**
- JSON Schema original: **PASS**
- JSON Schema external-assets: **PASS**
- Verificare fișiere imagine create: **PASS**

## Assets extrase

| Campaign | Template | Asset ID | Filename | MIME | Size bytes | SHA256 | Referenced by activation materials |
|---|---|---|---|---|---:|---|---|
| `camp-002` | `camp-002-template-1` | `camp-002-template-1-asset-1` | `camp-002-template-1-asset-1.jpg` | image/jpeg | 115,082 | `0f40ae0b3698e43d…` | activation-demo-outdoor-spring/demo-spring-ig-reel, activation-demo-outdoor-spring/demo-spring-fb, activation-demo-outdoor-autumn/demo-material-outdoor-1, activation-demo-outdoor-autumn/demo-material-outdoor-3, activation-annual-2027-spring/annual27-spring-ig, activation-annual-2027-creator/annual27-creator-yt, activation-annual-2027-autumn/annual27-autumn-ig |
| `camp-002` | `camp-002-template-1` | `camp-002-template-1-asset-2` | `camp-002-template-1-asset-2.jpg` | image/jpeg | 91,560 | `cc68898988ed08b1…` | — |
| `camp-002` | `camp-002-template-2` | `camp-002-template-2-asset-1` | `camp-002-template-2-asset-1.jpg` | image/jpeg | 137,203 | `8354c6398928dbdf…` | activation-demo-outdoor-spring/demo-spring-ig-carousel, activation-demo-outdoor-spring/demo-spring-tt, activation-demo-outdoor-autumn/demo-material-outdoor-2, activation-demo-outdoor-autumn/demo-material-outdoor-4, activation-annual-2027-spring/annual27-spring-fb |
| `camp-002` | `camp-002-template-2` | `camp-002-template-2-asset-2` | `camp-002-template-2-asset-2.jpg` | image/jpeg | 132,412 | `ceea112e2be8a21d…` | — |
| `camp-002` | `camp-002-template-2` | `camp-002-template-2-asset-3` | `camp-002-template-2-asset-3.jpg` | image/jpeg | 88,984 | `a4ae165403473ef4…` | — |
| `camp-002` | `camp-002-template-3` | `camp-002-template-3-asset-1` | `camp-002-template-3-asset-1.jpg` | image/jpeg | 88,079 | `83e3655e533c8b4e…` | — |
| `camp-002` | `camp-002-template-3` | `camp-002-template-3-asset-2` | `camp-002-template-3-asset-2.jpg` | image/jpeg | 97,672 | `6ba2d36a38ac02a6…` | — |
| `camp-002` | `camp-002-template-3` | `camp-002-template-3-asset-3` | `camp-002-template-3-asset-3.jpg` | image/jpeg | 85,920 | `52a178af6bcc0845…` | — |

## Referințe Activation → Template → Asset

Au fost găsite **12** materiale cu `templateAssetId` nenul, către **2** assets distincte.

- `camp-002-template-1-asset-1` → `activation-demo-outdoor-spring/demo-spring-ig-reel`, `activation-demo-outdoor-spring/demo-spring-fb`, `activation-demo-outdoor-autumn/demo-material-outdoor-1`, `activation-demo-outdoor-autumn/demo-material-outdoor-3`, `activation-annual-2027-spring/annual27-spring-ig`, `activation-annual-2027-creator/annual27-creator-yt`, `activation-annual-2027-autumn/annual27-autumn-ig`
- `camp-002-template-2-asset-1` → `activation-demo-outdoor-spring/demo-spring-ig-carousel`, `activation-demo-outdoor-spring/demo-spring-tt`, `activation-demo-outdoor-autumn/demo-material-outdoor-2`, `activation-demo-outdoor-autumn/demo-material-outdoor-4`, `activation-annual-2027-spring/annual27-spring-fb`

Rezultat:
- toate `templateAssetId` nenule se rezolvă: **PASS**;
- `templateCampaignId` / `templateId` corespund asset-ului: **PASS**;
- nu s-au creat copii ale asset-ului per ActivationMaterial.

## Data URLs în HTML

HTML-ul nu mai conține vizualurile demo Base64. Au fost găsite doar următoarele `data:image` folosite de UI/CSS:

- #1: non-Base64 — `data:image/svg+xml;utf8,<svg`
- #2: non-Base64 — `data:image/svg+xml;utf8,<svg`
- #3: non-Base64 — `data:image/svg+xml;utf8,<svg`

Acestea nu sunt campaign visual assets și nu au fost extrase.

## Data URLs în Activations / importer

- Activations JSON: **0** `data:image`.
- Importer JS: **0** `data:image`.

## Verificare integritate

A. Base64 assets descoperite: **8**  
B. Fișiere fizice create: **8**  
C. Assets unice: **8**  
D. Toate fișierele pot fi citite ca imagini: **PASS**  
E. Toate `templateAssetId` nenule se rezolvă: **PASS**  
F. Campaign/Template/Asset IDs nu au fost modificate: **PASS**  
G. Original JSON byte-for-byte nemodificat: **PASS**  
H. Copia external-assets nu mai conține Base64 pentru assets: **PASS**

## Duplicate

- Niciun duplicate binar detectat.

## Erori

- Nicio eroare de extracție.

## Erori de verificare a fișierelor

- Niciuna.

## JSON Schema

- Fără erori.

## Observație pentru implementarea live

Folderul `assets/` este material de staging/handoff. În aplicația live, importerul trebuie să creeze rânduri în tabela `assets`, să copieze fișierele în storage-ul serverului și să păstreze relațiile prin identitățile stabile. Calea relativă din copia `external_assets.json` nu trebuie tratată drept model permanent al DB.


## Actualizare pachet v4

Metadatele `strategicData.strategyVersion` au fost adăugate pachetului Campaign. Vizualurile și relațiile Asset au rămas neschimbate; hash-ul package-ului sursă din `ASSET_MANIFEST.json` a fost recalculat.
