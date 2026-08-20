# Deploying to a server with nginx

For an ordinary Linux server where nginx is already installed. For the Docker +
Tailscale variant see `Dockerfile`, `docker-compose.yml` and `deploy/nginx.conf`
instead — **that path has never been built or run**, so this is the one with
verified pieces.

Assumes `/srv/omd` as the install root and `omd.example.ro` as the hostname.
Replace both throughout.

## What runs where

```
browser ──HTTPS──▶ nginx :443 ──┬── /            SPA from /srv/omd/web
                                ├── /assets/     hashed bundles, cached 1y
                                ├── /fonts/      self-hosted woff2
                                ├── /uploads/    files from /srv/omd/storage/uploads
                                └── /api/  ──▶  node :3000 (127.0.0.1 only) ──▶ MySQL
```

Node never listens on a public interface. nginx is the only thing bound to 0.0.0.0.

Those are URL paths, not directories side by side on disk. `/assets/` and
`/fonts/` inherit the server-level `root /srv/omd/web`, so nginx appends the URI
and they resolve inside the web root. `/uploads/` uses `alias`, which *replaces*
the matched prefix instead of appending, so it can point outside the web root
entirely. `/api/` touches no filesystem path at all.

```
/srv/omd/
|-- backend/          Node app - never served as files
|   |-- dist/           compiled JS, incl. database/migrate.js
|   |-- node_modules/
|   `-- .env            mode 600, omd:omd
|-- web/              <- nginx root. The 18 files from frontend/dist
|   |-- index.html
|   |-- assets/         served at /assets/, cached 1y
|   `-- fonts/          served at /fonts/, cached 1y
|-- storage/          <- the only writable path (ReadWritePaths=)
|   |-- uploads/        served at /uploads/ via alias
|   `-- import-temp/
|-- contracts/        JSON Schemas, read at runtime by the API
|-- database/
|   `-- migrations/     read by migrate.js
`-- deploy/           config sources, nothing reads at runtime
```

Uploads sit outside the web root on purpose: an uploaded file then cannot land
beside the app bundle, and cannot be reached by guessing a path under
`/srv/omd/web`. It is also the one directory a database dump cannot rebuild,
which is why step 8 archives it separately.

## 0. What you need before you start

Deploying onto a machine you do not own, get these settled first — every one of
them blocks a later step.

| What | Why |
|---|---|
| An SSH account **in the `sudo` group** | Unavoidable: steps 1, 2, 6 install packages, create a MySQL user, and write to `/etc/nginx` and `/etc/systemd` — all root-owned. You do *not* need the root account itself or `NOPASSWD` sudo; the commands that run over SSH use `ssh -t` so sudo can prompt you. |
| A hostname with an A record (and AAAA if the host has IPv6) pointing at the server's public IP | certbot proves control of the name over HTTP. Without DNS already resolving, step 6's certificate request fails. Set it up and let it propagate *before* you begin. |
| Inbound TCP 80 and 443 open to the internet | Both, not just 443: certbot's HTTP-01 challenge arrives on 80, and 80 also serves the redirect. Check the host firewall (`ufw`/`firewalld`) **and** any cloud security group — they are separate and both must allow it. |
| Outbound HTTPS from the server | `apt`, the NodeSource script, `pnpm install` and certbot all fetch from the internet. On a locked-down network, arrange a mirror or build `node_modules` elsewhere and rsync it. |
| Node 20 or newer | `backend/package.json` sets `engines: { node: ">=20" }`. Step 1 installs 24. |
| MySQL 8.0 or newer | The schema uses `utf8mb4_0900_ai_ci`, which does not exist before 8.0. |
| A free TCP port on loopback | 3000 by default. If it is taken, change `PORT` in `.env` **and** `proxy_pass` in the nginx site — they must agree. |
| Confirmation of what already runs there | See below. |

**If the server already hosts other sites** — likely, on someone else's box —
four things in this guide need adjusting:

- Skip `apt install nginx mysql-server` for whatever is already installed, and
  skip the `adduser` if an `omd` account somehow exists.
- **Do not** run `sudo rm -f /etc/nginx/sites-enabled/default`. That line assumes
  a fresh server; on a shared one it can take down someone else's site. Adding
  your own file to `sites-enabled/` is enough.
- `certbot --nginx` edits nginx configuration in place. Take a copy of
  `/etc/nginx` first: `sudo tar czf ~/nginx-backup.tgz /etc/nginx`.
- If MySQL is shared, you still create your own database and user — just do not
  touch the root password or `mysql_secure_installation`.

Nothing about the build is host-specific: the SPA calls `/api/v1` relatively and
reads no `VITE_` variables, so the same `frontend/dist` works on any hostname.
Only `.env` and the nginx `server_name` carry the server's identity.

### Three identities, two of them Linux accounts

The runbook calls three things "users". Keeping them apart avoids most of the
confusion:

| Name | What it is | Can it log in? |
|---|---|---|
| your own account | Linux login with `sudo`; you deploy with it | yes, over SSH |
| `omd` | Linux **service account** the Node process runs as | no — `nologin`, no password |
| `omd_app` | a **MySQL** account, exists only inside the database | not a Linux account at all |

`omd_app` never touches the filesystem and has no home directory; it is a name
the database checks when Node connects. `omd` never logs in anywhere; it exists
so the process has an unprivileged identity, which is what makes the systemd
hardening in `omd-api.service` mean anything.

## 1. Server prerequisites

```bash
sudo apt update
sudo apt install -y nginx mysql-server certbot python3-certbot-nginx rsync
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo corepack enable pnpm
sudo adduser --system --group --home /srv/omd omd
```

`corepack` ships with Node, so this puts `pnpm` on PATH without a second global
install. The project is built and installed with pnpm: `pnpm-lock.yaml` is where
the versions are pinned, and `npm ci` here would resolve from a different file.

## 2. Database

```bash
sudo mysql -e "
  CREATE DATABASE omd_vj_production CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
  CREATE USER 'omd_app'@'127.0.0.1' IDENTIFIED BY '<strong-password>';
  GRANT ALL PRIVILEGES ON omd_vj_production.* TO 'omd_app'@'127.0.0.1';
  FLUSH PRIVILEGES;"
```

`ALL PRIVILEGES` is scoped to this one schema, and it is what the migration
runner needs: the ten migrations issue 40 `CREATE TABLE` and one `CREATE VIEW`,
plus foreign keys, which DML-only rights refuse outright.

To tighten afterwards — the running app issues no DDL, only `SELECT`, `INSERT`,
`UPDATE`, `DELETE` — revoke once step 5 has succeeded, and grant it back before
any future deploy that ships a new migration:

```bash
sudo mysql -e "
  REVOKE ALL PRIVILEGES ON omd_vj_production.* FROM 'omd_app'@'127.0.0.1';
  GRANT SELECT, INSERT, UPDATE, DELETE ON omd_vj_production.* TO 'omd_app'@'127.0.0.1';
  FLUSH PRIVILEGES;"
```

## 3. Build, on a machine with the toolchain

Both builds are verified working.

```bash
cd backend  && pnpm install --frozen-lockfile && pnpm run build     # -> backend/dist
cd ../frontend && pnpm install --frozen-lockfile && pnpm run build  # -> frontend/dist
```

Ship over your own SSH account. `omd` has a `nologin` shell by design, so it
cannot receive an ssh or rsync session at all. Stage into a directory you own,
then hand the tree to the service account. `ssh -t` allocates a terminal —
without one, `sudo` cannot prompt for your password and fails with
`no tty present and no askpass program specified`:

```bash
rsync -a --delete backend/{dist,package.json,package-lock.json,.env.example} you@server:/tmp/omd/backend/
rsync -a --delete frontend/dist/                                you@server:/tmp/omd/web/
rsync -a          contracts/ database/ deploy/                  you@server:/tmp/omd/

ssh -t you@server 'sudo rsync -a /tmp/omd/ /srv/omd/ \
  && sudo chown -R omd:omd /srv/omd && rm -rf /tmp/omd'
```

`deploy/` travels too — step 6 installs the systemd unit and the nginx site
from it. Nothing reads it at runtime.

`contracts/` and `database/migrations/` must sit **beside** `backend/`, not
inside it. `config/env.ts` computes the repo root as three levels up from
`backend/dist/config`, and both `migrationsDir` and the contract registry
resolve from there. Move either directory and the migration runner and the JSON
Schema validator break at runtime, not at build time.

Then install production dependencies on the server, so `argon2`'s native binding
is compiled for that machine:

```bash
ssh -t you@server 'cd /srv/omd/backend && sudo -u omd pnpm install --prod --frozen-lockfile'
```

## 4. Configuration

```bash
# Storage tree. Create it before step 6a: the systemd unit declares
# ReadWritePaths=/srv/omd/storage, and systemd refuses to start a unit whose
# ReadWritePaths does not exist.
sudo mkdir -p /srv/omd/storage/uploads /srv/omd/storage/import-temp
sudo chown -R omd:omd /srv/omd/storage

sudo cp /srv/omd/backend/.env.example /srv/omd/backend/.env
sudo chown omd:omd /srv/omd/backend/.env
sudo chmod 600 /srv/omd/backend/.env

openssl rand -hex 32   # once for APP_SECRET, again for AUTH_SECRET
sudo -u omd nano /srv/omd/backend/.env
```

Values that must change from the example:

| Variable | Production value | Why |
|---|---|---|
| `APP_ENV` | `production` | drives `secure` cookies and hides error details |
| `APP_BASE_URL` | `https://omd.example.ro` | |
| `APP_SECRET` / `AUTH_SECRET` | two different 32-byte hex strings | changing `AUTH_SECRET` logs everyone out |
| `DB_NAME` | `omd_vj_production` | |
| `DB_PASSWORD` | the password from step 2 | |
| `HOST` | `127.0.0.1` | nginx is the only way in |
| `TRUST_PROXY` | `1` | commented out in the example — uncomment it. **Without it `req.ip` is nginx**, so the login rate limiter counts every user as one client |
| `UPLOAD_DIR` | `/srv/omd/storage/uploads` | absolute, outside the deploy directory |
| `IMPORT_TEMP_DIR` | `/srv/omd/storage/import-temp` | |

`ALLOWED_ORIGIN` is declared but nothing reads it — the app has no CORS
middleware because nginx serves the SPA and the API on one origin.

## 5. Schema and first user

`tsx` is a devDependency, so after `pnpm install --prod` the `pnpm run migrate`
script does not exist. Run the compiled files:

```bash
cd /srv/omd/backend
sudo -u omd node dist/database/migrate.js
sudo -u omd node dist/database/seed-technical.js
```

The seed creates the three roles and one ADMIN. **The temporary password is
printed once and never stored in recoverable form** — copy it out of that output
before you close the terminal. `must_change_password` is set, so the first login
forces a replacement. Re-running the seed is safe: it leaves existing rows alone
and never resets an existing admin's password.

**Do not import the DEMO_SEED files into production.** They are staging fixtures.

## 6. Service and web server

The TLS config names `fullchain.pem`, so `nginx -t` cannot pass until the
certificate exists — and certbot cannot issue one until nginx answers on port
80. Break that loop by serving the ACME challenge from a throwaway HTTP-only
site first. All of this runs on the server.

```bash
export OMD_HOST=omd.example.ro          # your real hostname, used throughout

# 6a. Start the API. nginx will proxy to it.
cd /srv/omd
sudo cp deploy/omd-api.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now omd-api
sudo systemctl status omd-api --no-pager
curl -s localhost:3000/api/v1/health/ready     # {"status":"ok","database":"ok"}

# 6b. Temporary site that answers only the ACME challenge.
sudo mkdir -p /var/www/certbot
printf 'server {
    listen 80;
    server_name %s;
    location /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
' "$OMD_HOST" | sudo tee /etc/nginx/sites-available/omd-acme >/dev/null
sudo ln -sf /etc/nginx/sites-available/omd-acme /etc/nginx/sites-enabled/omd-acme
sudo nginx -t && sudo systemctl reload nginx

# 6c. Issue the certificate. --webroot leaves nginx config untouched, which
#     matters on a server hosting someone else's sites.
sudo certbot certonly --webroot -w /var/www/certbot -d "$OMD_HOST" \
  --agree-tos -m you@example.com --no-eff-email
sudo ls /etc/letsencrypt/live/"$OMD_HOST"/fullchain.pem   # must exist

# 6d. Now the real site can parse. Swap the placeholder for your hostname.
sudo rm -f /etc/nginx/sites-enabled/omd-acme
sudo sed -e "s/omd.example.ro/$OMD_HOST/g" deploy/nginx-standalone.conf \
  | sudo tee /etc/nginx/sites-available/omd >/dev/null
sudo ln -sf /etc/nginx/sites-available/omd /etc/nginx/sites-enabled/omd
sudo rm -f /etc/nginx/sites-enabled/default    # fresh server only - see step 0
sudo nginx -t && sudo systemctl reload nginx
```

Renewal is installed by the certbot package as a systemd timer. Confirm it, and
make nginx pick up renewed certificates:

```bash
systemctl list-timers 'certbot*' --no-pager

sudo mkdir -p /etc/letsencrypt/renewal-hooks/deploy
printf '#!/bin/sh\nsystemctl reload nginx\n' \
  | sudo tee /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh >/dev/null
sudo chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
sudo certbot renew --dry-run
```

## 7. Verify

```bash
curl -sI  https://$OMD_HOST/ | head -1                    # 200
curl -s   https://$OMD_HOST/api/v1/health                 # {"status":"ok"}
curl -sI  https://$OMD_HOST/api/v1/campaigns | head -1     # 401 before login
curl -sI  https://$OMD_HOST/campaigns | head -1            # 200, SPA fallback
curl -sI  https://$OMD_HOST/fonts/SourceSerif4-600-latin.woff2 | head -1   # 200
```

Then in a browser: sign in, change the temporary password, and confirm headings
render in Source Serif 4 rather than Georgia — if the fonts 404, the `/fonts/`
directory did not ship.

## 8. Backups

Nothing in this repo backs anything up. At minimum:

```bash
mysqldump --single-transaction omd_vj_production | gzip > omd-$(date +%F).sql.gz
tar czf omd-uploads-$(date +%F).tar.gz /srv/omd/storage/uploads
```

The uploads directory is not reconstructible from the database — `assets` rows
store a path, not the bytes.

## Updating

Only two directories change on a routine update. Keep `--delete` scoped to
each of them — pointed at `/srv/omd` it would take `node_modules`, `.env` and
`storage/` with it.

```bash
rsync -a --delete backend/dist/  you@server:/tmp/omd-dist/
rsync -a --delete frontend/dist/ you@server:/tmp/omd-web/

ssh -t you@server 'sudo rsync -a --delete /tmp/omd-dist/ /srv/omd/backend/dist/ \
  && sudo rsync -a --delete /tmp/omd-web/ /srv/omd/web/ \
  && sudo chown -R omd:omd /srv/omd/backend/dist /srv/omd/web \
  && rm -rf /tmp/omd-dist /tmp/omd-web \
  && cd /srv/omd/backend \
  && sudo -u omd pnpm install --prod --frozen-lockfile \
  && sudo -u omd node dist/database/migrate.js \
  && sudo systemctl restart omd-api'
```

`cd /srv/omd/backend` is load-bearing: dotenv reads `.env` from the working
directory, so the migration runner finds no database without it.

`sudo -u omd` runs a command directly rather than through the account's login
shell, so it works despite `nologin` — which is why steps 4 and 5 use it.

Migrations are idempotent and refuse to re-run an edited file. `index.html` is
served with `no-store`, so browsers pick up the new bundle immediately.

## Known gaps, before you rely on this

- **No automated tests at any level.** Nothing gates a deploy; `pnpm run typecheck`
  is the only static check.
- **No import UI.** Importing production data needs shell access and
  `node dist/imports/cli.js <file>`.
- **Rate limiting is per process.** One instance today, so it holds; two behind a
  load balancer would double the effective limit.
- **Image upload from the browser does not exist.** Visuals only enter through
  imports.
- **The Docker/Tailscale path is unbuilt.** Use this guide, not that one.
