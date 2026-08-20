# Baza de date în container

Doar MySQL — fără API, fără nginx, fără Tailscale. Pentru situația în care
aplicația rulează în altă parte, iar baza de date are nevoie de o gazdă.

E un fișier separat de `docker-compose.yml`, care descrie stack-ul complet pe
tailnet și presupune o bază de date *externă*. Nimic de aici nu îl atinge.

## Pornire

```bash
cp .env.db.example .env.db
```

Editează `.env.db` — două parole și, dacă vrei, portul. Apoi:

```bash
docker compose -f docker-compose.db.yml --env-file .env.db up -d
docker compose -f docker-compose.db.yml ps
```

Așteaptă starea `healthy`; verificarea de sănătate se autentifică, deci
înseamnă că serverul chiar răspunde, nu doar că ascultă pe port.

## Migrațiile și seed-ul

Containerul conține un MySQL gol. Schema o creează tot runner-ul proiectului,
nu containerul — altfel `schema_migrations` ar rămâne în urmă față de realitate.

Din `backend/.env`, pune datele containerului:

```
DB_HOST=127.0.0.1
DB_PORT=3306
DB_NAME=omd_vj_production
DB_USER=omd_app
DB_PASSWORD=<cel din .env.db>
```

apoi:

```bash
cd backend
pnpm run migrate
pnpm run seed:technical
```

În producție, unde `tsx` nu există:

```bash
node dist/database/migrate.js
node dist/database/seed-technical.js
```

Seed-ul afișează **o singură dată** parola temporară de admin. Copiaz-o.

## Ce am configurat și de ce

| Setare | Motiv |
|---|---|
| `mysql:8.4` | schema cere `utf8mb4_0900_ai_ci`, constrângeri `CHECK` și funcții JSON — toate din 8.0 în sus. Versiune fixată, ca un rebuild să nu mute serverul sub datele existente |
| `--character-set-server=utf8mb4`<br>`--collation-server=utf8mb4_0900_ai_ci` | tabelele își declară colația, dar valorile implicite ale serverului decid ce primește o conexiune înainte de asta |
| `--default-time-zone=+00:00` | toate marcajele de timp sunt UTC; aplicația se conectează cu `time_zone='+00:00'`, iar asta face serverul să fie de acord și pentru sesiuni care nu o setează — `mysql`, `mysqldump`, phpMyAdmin |
| `--max-allowed-packet=64M` | importurile mută vizualuri decodate din base64; valoarea implicită de 4 MB le respinge |
| `MYSQL_DATABASE` + `MYSQL_USER` | crearea lor prin entrypoint acordă automat utilizatorului ALL pe acea schemă — exact ce cere runner-ul de migrații, care emite 40 `CREATE TABLE` și un `CREATE VIEW` |

## Portul e legat la loopback

```yaml
ports:
  - "${DB_BIND:-127.0.0.1}:${DB_PORT:-3306}:3306"
```

Implicit `127.0.0.1`, deci doar mașina gazdă ajunge la el. Forma obișnuită
`3306:3306` publică baza prin firewall-ul gazdei pe majoritatea configurațiilor,
iar un port MySQL expus e scanat în câteva ore.

Dacă trebuie accesat de pe altă mașină, pune un tunel în față — `ssh -L` sau
Tailscale — în loc să lărgești legarea. Dacă totuși schimbi `DB_BIND` în
`0.0.0.0`, adaugă și o regulă de firewall care restrânge sursele.

## Backup și restaurare

```bash
# dump
docker compose -f docker-compose.db.yml exec mysql \
  mysqldump --single-transaction --routines -u root -p"$DB_ROOT_PASSWORD" \
  omd_vj_production | gzip > omd-$(date +%F).sql.gz

# restaurare într-un container existent
gunzip -c omd-2026-08-19.sql.gz | docker compose -f docker-compose.db.yml exec -T mysql \
  mysql -u root -p"$DB_ROOT_PASSWORD" omd_vj_production
```

`--single-transaction` face dump-ul fără să blocheze tabelele, deci aplicația
poate rula în timpul lui.

Pentru o restaurare într-un container **nou**, pune fișierul `.sql` în
`deploy/mysql-init/` înainte de prima pornire — se execută automat, o singură
dată, pe un volum gol. Detalii în `deploy/mysql-init/README.txt`.

## Ciclul de viață

```bash
docker compose -f docker-compose.db.yml down       # oprește, PĂSTREAZĂ datele
docker compose -f docker-compose.db.yml down -v    # oprește și ȘTERGE datele
docker compose -f docker-compose.db.yml logs -f mysql
docker compose -f docker-compose.db.yml exec mysql mysql -u root -p omd_vj_production
```

Datele stau în volumul `mysql-data`, nu în container: `down` fără `-v` le
păstrează, la fel și o schimbare de imagine. `-v` le șterge definitiv.

## Ce nu rezolvă asta

Containerul acoperă doar baza de date. Pe găzduirea ta cPanel lipsește Node.js,
iar backendul tot nu are unde rula — un MySQL în container nu schimbă asta.
E util dacă:

- dezvolți local și vrei aceeași versiune de MySQL ca în producție;
- ai un VPS și preferi baza în container, iar aplicația pe gazdă;
- vrei să testezi o restaurare de backup fără să atingi baza reală.

Dacă scopul era să faci aplicația să meargă pe cPanel, vezi `deploy/CPANEL.md` —
concluzia de acolo rămâne: fără Node.js, doar frontendul static poate fi servit.
