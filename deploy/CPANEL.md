# Deploying on cPanel — the Node backend

> **For visitvaleajiului.ro, use `DEPLOY-CPANEL.md` instead.** That account has
> no **Setup Node.js App**, which everything below depends on, so this route is
> not available there. `DEPLOY-CPANEL.md` deploys the PHP backend, which needs no
> Node process on the host at all.
>
> Keep this document for a host that *does* offer Node.

An alternative to `DEPLOY.md`, for shared hosting where you have cPanel instead
of root on a server. The pieces are the same — MySQL, a Node process, static
files, a route from `/api` to Node — but nothing is done the same way: no
systemd, no nginx config, no `sudo`.

## First: can this host run it at all?

Log into cPanel and look for **Setup Node.js App** (under Software). Everything
below depends on it.

**If it is not there, stop.** The Node API cannot run, and no workaround changes
that — the frontend is a static bundle that talks to an API, so uploading the
built SPA alone gives you a login screen that can never authenticate. You need a
plan with Node.js support, or a VPS and `DEPLOY.md`.

If it is there, check three more things before you start:

| Check | Where | Needed |
|---|---|---|
| Node version offered | Setup Node.js App → Node.js version | **20 or newer** (`engines: >=20`) |
| MySQL version | cPanel → phpMyAdmin, or ask support | **8.0+** — the schema uses `utf8mb4_0900_ai_ci`, which does not exist earlier |
| Terminal access | cPanel → Terminal | Not strictly required, but migrations are far easier with it |

The app must be served from a **domain or subdomain root**, not a subfolder.
Vite built the bundle with absolute paths (`/assets/…`, `/fonts/…`), so
`example.com/omd/` would request `/assets/…` at the domain root and 404.

## 1. Database

cPanel → **MySQL Databases**:

1. Create a database — cPanel prefixes it, so you get something like
   `myuser_omd`.
2. Create a user — likewise `myuser_omdapp`. Use the password generator.
3. Add the user to the database with **ALL PRIVILEGES**.

Note all three values exactly as cPanel shows them, prefixes included. The host
is almost always `localhost`.

The migrations issue 40 `CREATE TABLE` and one `CREATE VIEW`, so DML-only rights
will not do.

## 2. Build locally and upload

Build on your own machine — shared hosting rarely has the toolchain, and
`pnpm install` in a Node app container often runs out of memory:

```bash
cd backend  && pnpm install --frozen-lockfile && pnpm run build
cd ../frontend && pnpm install --frozen-lockfile && pnpm run build
```

Upload this tree **outside** `public_html`, so nothing in it is web-readable:

```
/home/<cpaneluser>/omd/
├── backend/
│   ├── dist/                  from backend/dist
│   ├── package.json
│   ├── package-lock.json
│   └── .env                   you create it in step 4
├── contracts/                 the whole folder
├── database/                  the whole folder (migrations live here)
└── storage/
    ├── uploads/
    └── import-temp/
```

The three siblings are not optional. `config/env.ts` computes the repository
root as three levels up from `backend/dist/config`, and resolves `migrationsDir`
and the JSON Schema registry from there. Put `contracts/` inside `backend/` and
the API starts and then fails at runtime.

Do **not** upload `node_modules` — `argon2` has a native binding that must be
built on the host. Step 3 installs it there.

Then the SPA, into the docroot:

```
/home/<cpaneluser>/public_html/
├── index.html
├── assets/
└── fonts/
```

Those are the 18 files from `frontend/dist`. Use File Manager's *Upload* with a
zip and *Extract*, or FTP.

## 3. Create the Node application

cPanel → **Setup Node.js App** → *Create Application*:

| Field | Value |
|---|---|
| Node.js version | 20 or newer |
| Application mode | Production |
| Application root | `omd/backend` |
| Application URL | your domain, **path `/api`** |
| Application startup file | `dist/server.js` |

The Application URL is the part that wires everything together: it makes
`https://yourdomain/api/...` reach Node while everything else is served as static
files from `public_html`. Same origin, which is what the SPA needs — it calls
`/api/v1` relatively and there is no CORS middleware.

Then press **Run NPM Install**. This reads the uploaded `package.json` and
compiles `argon2` for this host.

## 4. Environment variables

Still in Setup Node.js App, add these under *Environment variables* — or create
`omd/backend/.env`, which dotenv also reads. Use one or the other, not both.

| Variable | Value |
|---|---|
| `APP_ENV` | `production` |
| `APP_BASE_URL` | `https://yourdomain` |
| `APP_SECRET` | 32+ random characters |
| `AUTH_SECRET` | 32+ different random characters |
| `DB_HOST` | `localhost` |
| `DB_NAME` | `myuser_omd` — with the cPanel prefix |
| `DB_USER` | `myuser_omdapp` |
| `DB_PASSWORD` | from step 1 |
| `UPLOAD_DIR` | `/home/<cpaneluser>/omd/storage/uploads` |
| `IMPORT_TEMP_DIR` | `/home/<cpaneluser>/omd/storage/import-temp` |
| `TRUST_PROXY` | `1` |

`TRUST_PROXY` matters here as much as behind nginx: Passenger fronts the app, so
without it `req.ip` is the proxy and the login rate limiter counts every user as
one client.

If you need random values and have no terminal:
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

## 5. Schema and first user

`tsx` is a devDependency, so `pnpm run migrate` does not exist in production. Run
the compiled files.

**With Terminal** (cPanel → Terminal). Copy the `source …/bin/activate` line that
Setup Node.js App shows at the top of your application's panel, then:

```bash
source /home/<cpaneluser>/nodevenv/omd/backend/20/bin/activate
cd /home/<cpaneluser>/omd/backend
node dist/database/migrate.js
node dist/database/seed-technical.js
```

**Without Terminal**, use the application panel's *Run JS script* button, which
runs a script from `package.json`. Add these to `backend/package.json` before
uploading:

```json
"migrate:prod": "node dist/database/migrate.js",
"seed:prod": "node dist/database/seed-technical.js"
```

The seed prints a temporary admin password **once**. Copy it before you close
the window — it is not recoverable, and the first login forces you to change it.

Do not import the DEMO_SEED files into production; they are staging fixtures.

## 6. SPA fallback

The app uses real URLs, so a refresh on `/campaigns` must return `index.html`
rather than 404. Create `public_html/.htaccess`:

```apache
RewriteEngine On

# Anything Passenger owns, and any real file, is left alone.
RewriteCond %{REQUEST_URI} ^/api/ [OR]
RewriteCond %{REQUEST_URI} ^/uploads/
RewriteRule ^ - [L]

RewriteCond %{REQUEST_FILENAME} -f [OR]
RewriteCond %{REQUEST_FILENAME} -d
RewriteRule ^ - [L]

RewriteRule ^ /index.html [L]
```

```apache
# Hashed filenames never change contents; index.html must never be cached, or a
# deploy leaves browsers on the old bundle against the new API.
<IfModule mod_expires.c>
  ExpiresActive On
  ExpiresByType text/css "access plus 1 year"
  ExpiresByType application/javascript "access plus 1 year"
  ExpiresByType font/woff2 "access plus 1 year"
</IfModule>

<IfModule mod_headers.c>
  <Files "index.html">
    Header set Cache-Control "no-store, must-revalidate"
  </Files>
</IfModule>
```

## 7. HTTPS

cPanel → **SSL/TLS Status** → *Run AutoSSL*. Then force HTTPS from Domains →
your domain → *Force HTTPS Redirect*.

## 8. Verify

```bash
curl -s  https://yourdomain/api/v1/health          # {"status":"ok"}
curl -s  https://yourdomain/api/v1/health/ready    # database:"ok"
curl -sI https://yourdomain/api/v1/campaigns       # 401 before login
curl -sI https://yourdomain/campaigns              # 200 - SPA fallback
curl -sI https://yourdomain/fonts/fonts.css        # 200
```

Then sign in, change the temporary password, and confirm headings render in
Source Serif 4 rather than Georgia. If they look wrong, `/fonts/` did not upload.

## Known gotchas on this platform

These are specific to cPanel and worth reading before you debug blind.

**The `/api` path prefix.** The app defines its routes as `/api/v1/...`
(`app.use('/api/v1', campaignRouter)`). Passenger passes the request path
through, so mounting the application at URL path `/api` lines up exactly. If
`/api/v1/health` returns 404 while the app is clearly running, Passenger is
stripping the prefix on your host — mount the application at `/` on a dedicated
subdomain instead, and note that the SPA then needs a matching origin, which it
currently has no setting for.

**`PORT` may not be a number.** `config/env.ts` parses `PORT` as a positive
integer. Some Passenger builds set `PORT` to a Unix socket path, which fails that
check and the app exits at boot with an env validation error. If that happens,
set `PORT=3000` explicitly in the environment variables — Passenger intercepts
`listen()` anyway, so the value is never used to bind.

**Memory limits.** Shared plans often cap a Node app around 512 MB–1 GB. The API
is modest, but a large JSON import decodes base64 in memory and can hit it.

**Restart after every change.** Setup Node.js App → *Restart*. Environment
variable edits and re-uploaded `dist/` files both need it.

**Logs.** The app writes pino JSON to stdout; Passenger collects it in
`stderr.log` in the application root, and cPanel → *Errors* shows the Apache
side.

## Updating

1. `pnpm run build` in both projects locally.
2. Upload `backend/dist` over the old one, and `frontend/dist` into `public_html`.
3. Run the migration script if the release added one.
4. Setup Node.js App → **Restart**.
