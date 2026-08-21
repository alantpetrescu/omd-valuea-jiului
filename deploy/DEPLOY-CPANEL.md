# Instalare pe cPanel

Două instalări, același cod, gazde diferite. Alege ghidul care ți se potrivește —
sunt documente complete, nu variante ale aceluiași text cu ramificații.

| ghid | cont | domeniu | PHP | server de baze |
|---|---|---|---|---|
| [`DEPLOY-CPANEL-visitvaleajiului.md`](DEPLOY-CPANEL-visitvaleajiului.md) | `visit` | `visitvaleajiului.ro` | 8.1 | MySQL 8.0.46 |
| [`DEPLOY-CPANEL-descoperavaleajiului.md`](DEPLOY-CPANEL-descoperavaleajiului.md) | `descoper` | `descoperavaleajiului.ro` | 8.4.24 | MariaDB 10.11.18 |

## Ce diferă, de fapt

Aplicația e identică. Diferă trei lucruri, și toate trei au costat timp la a doua
instalare:

1. **Serverul de baze.** MariaDB nu are colația `utf8mb4_0900_ai_ci` pe care o
   cere schema scrisă pentru MySQL 8. Există un al doilea set de migrații,
   generat din primul; aplicația alege singură, dar setul trebuie generat înainte
   de împachetare.
2. **Numele contului.** Nu se deduce din prefixul bazelor de date — prefixul e
   doar primele opt caractere ale utilizatorului.
3. **Utilizatorul bazei.** A-l crea nu îl adaugă pe bază. Sunt două acțiuni
   separate, iar eroarea rezultată (`1044`) seamănă cu o parolă greșită (`1045`)
   fără să fie.

## De ce două documente, nu unul cu variante

Un runbook se citește în timp ce faci pașii, adesea sub presiune. Un singur text
cu „dacă gazda e MariaDB, atunci…" la fiecare al doilea pas se citește prost
exact atunci. Prețul e că cele două pot să se depărteze: dacă schimbi o procedură,
schimb-o în amândouă.

Ce e comun rămâne comun în cod, nu în documente — comenzile de împachetare,
shim-urile care își deduc singure calea, și detecția serverului.
