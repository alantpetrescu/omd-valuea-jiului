# OMD Valea Jiului — production image.
#
# Two build targets from one file:
#   --target api   Node/Express API
#   --target web   nginx serving the built React SPA and proxying the API
#
# Layout inside the api image mirrors the repository, because the backend
# resolves `contracts/` and `database/migrations/` relative to the repo root
# (see backend/src/config/env.ts). Flattening it would break both the JSON
# Schema registry and the migration runner.

# ---------------------------------------------------------------------------
# 1. Frontend build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS frontend-build
WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./
# Vite inlines nothing secret here: the SPA talks to /api on its own origin.
RUN npm run build

# ---------------------------------------------------------------------------
# 2. Backend build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS backend-build
WORKDIR /build

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Production dependencies only. argon2 is a native module, so it is installed
# on the same Alpine base the runtime uses rather than copied from elsewhere.
RUN npm ci --omit=dev

# ---------------------------------------------------------------------------
# 3. API runtime
# ---------------------------------------------------------------------------
FROM node:24-alpine AS api

# tini gives us correct signal handling so SIGTERM reaches Node and the
# graceful shutdown in server.ts actually runs.
RUN apk add --no-cache tini curl

WORKDIR /app/backend

COPY --from=backend-build /build/node_modules ./node_modules
COPY --from=backend-build /build/dist ./dist
COPY backend/package.json ./package.json

# Repo-root siblings the backend reads at runtime.
COPY contracts /app/contracts
COPY database/migrations /app/database/migrations

# Runtime data lives outside the image so it survives redeploys.
RUN mkdir -p /data/uploads /data/import-temp \
 && chown -R node:node /data /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    UPLOAD_DIR=/data/uploads \
    IMPORT_TEMP_DIR=/data/import-temp

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/v1/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/server.js"]

# ---------------------------------------------------------------------------
# 4. Web runtime — nginx
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web

COPY --from=frontend-build /build/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
