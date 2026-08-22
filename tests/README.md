# tests/

Specificațiile sunt în [`docs/tests-specs/`](../docs/tests-specs/README.md).
Aici e doar codul.

```powershell
pwsh tests/seed.ps1     # o singură dată: omd_vj_test cu migrațiile și pachetele demo
pwsh tests/run.ps1      # tot, în ordine, sub cinci minute
```

| director | ce e | comandă proprie |
|---|---|---|
| `backend/` | reguli, schemă, API, importuri | `php tests/backend/run.php [suite...]` |
| `frontend/` | funcții pure, Administrare, paritate vizuală | `pwsh tests/frontend/run.ps1 [-All]` |
| `hybrid/` | ecranele operaționale și parcursurile complete | `pwsh tests/hybrid/run.ps1` |
| `shared/` | harness, config, mock, dependențe | — |
| `.work/` | capturi, loguri, fixture — regenerabile | — |

**Baza e întotdeauna `omd_vj_test`.** Fiecare runner refuză să pornească pe una
al cărei nume nu se termină în `_test`.
