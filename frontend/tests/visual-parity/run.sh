#!/usr/bin/env bash
#
# Repere strategice — visual parity against the v13.3 prototype.
#
# Serves the prototype and its four DEMO_SEED packages, builds the API fixture
# from the same seed, starts the Vite dev server against a mock API, then walks
# both applications through the same states and compares them.
#
# See README.md for prerequisites and environment overrides.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Node resolves paths itself, and on Windows it cannot read the POSIX form Git
# Bash hands out: `/d/Florian/...` became `D:\d\Florian\...` and the import
# failed before the suite drew a single pixel. `cygpath -m` gives the mixed form
# Node accepts; everywhere else the two are the same string.
if command -v cygpath >/dev/null 2>&1; then HERE_URL="file:///$(cygpath -m "$HERE")"; else HERE_URL="file://$HERE"; fi
FRONTEND="$(cd "$HERE/../.." && pwd)"
WORK="${OMD_PARITY_WORK:-$HERE/.work}"
PROTO_PORT="${OMD_PROTO_PORT:-8811}"
# The mock impersonates the backend on the port vite.config.ts already proxies.
MOCK_PORT="${OMD_MOCK_PORT:-3000}"
APP_PORT="${OMD_APP_PORT:-5174}"

if curl -sf -o /dev/null -m 2 "http://127.0.0.1:$MOCK_PORT/api/v1/health"; then
  echo "The real API is answering on :$MOCK_PORT — stop it, or set OMD_MOCK_PORT." >&2
  exit 1
fi

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "Fixture from OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json"
node "$HERE/make-fixture.mjs" || exit 1

step "Prototype server on :$PROTO_PORT"
node -e "
import('$HERE_URL/config.mjs').then(async (c) => {
  const { mkdirSync, copyFileSync, readdirSync } = await import('node:fs');
  const { resolve, basename } = await import('node:path');
  mkdirSync(c.PROTO_SERVE, { recursive: true });
  copyFileSync(c.PROTOTYPE_HTML, resolve(c.PROTO_SERVE, 'index.html'));
  copyFileSync(c.IMPORTER_JS, resolve(c.PROTO_SERVE, basename(c.IMPORTER_JS)));
  /*
   * The seeds go in twice, and both places are needed.
   *
   * `omd_import_packages_v1.js` fetches them from `../04_DEMO_SEEDS/`, relative
   * to the page — the layout of the delivered package, not of this staging
   * directory. Copying them only next to index.html left every fetch at 404, the
   * prototype booted with zero campaigns, and the capture step timed out waiting
   * for six.
   *
   * Inside the docroot, not beside it: index.html is served from `/`, and a
   * browser clamps `..` at the root, so `../04_DEMO_SEEDS/x.json` is requested as
   * `/04_DEMO_SEEDS/x.json`.
   */
  const seedsSibling = resolve(c.PROTO_SERVE, '04_DEMO_SEEDS');
  mkdirSync(seedsSibling, { recursive: true });
  for (const f of readdirSync(c.SEEDS)) {
    if (!f.endsWith('.json')) continue;
    copyFileSync(resolve(c.SEEDS, f), resolve(c.PROTO_SERVE, f));
    copyFileSync(resolve(c.SEEDS, f), resolve(seedsSibling, f));
  }
  console.log('prototype staged at ' + c.PROTO_SERVE);
});
" || exit 1
# `python3` is not always a Python: on Windows it is usually the Microsoft Store
# stub, which exits without serving anything. The suite then failed four steps
# later, at the first screenshot, with a connection refused and no hint why.
PY_BIN=""
for candidate in python3 python py; do
  if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c "import sys" >/dev/null 2>&1; then
    PY_BIN="$candidate"; break
  fi
done
if [ -z "$PY_BIN" ]; then
  echo "Nu am găsit un interpretor Python pentru serverul prototipului." >&2
  exit 1
fi

(cd "$WORK/prototype" && "$PY_BIN" -m http.server "$PROTO_PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
PIDS+=($!)

for _ in $(seq 1 20); do
  curl -sf -o /dev/null -m 1 "http://127.0.0.1:$PROTO_PORT/index.html" && break
  sleep 0.5
done

step "Vite dev server on :$APP_PORT"
(cd "$FRONTEND" && npx vite --host 127.0.0.1 --port "$APP_PORT" >"$WORK/vite.log" 2>&1) &
PIDS+=($!)

MOCK_PID=""
stop_mock() {
  # `kill` on the PID we started, not `pkill -f`: there is no pkill in Git Bash,
  # so on Windows the old mock kept the port, the new one failed to bind, and the
  # suite silently went on talking to the previous role.
  if [ -n "$MOCK_PID" ]; then
    kill "$MOCK_PID" 2>/dev/null
    wait "$MOCK_PID" 2>/dev/null
    MOCK_PID=""
  fi
  pkill -f "visual-parity/mock-api.mjs" 2>/dev/null
  for _ in $(seq 1 20); do
    curl -sf -o /dev/null -m 1 "http://127.0.0.1:$MOCK_PORT/api/v1/auth/me" || return 0
    sleep 0.5
  done
  echo "Mock-ul anterior nu s-a oprit de pe :$MOCK_PORT." >&2
  return 1
}

start_mock() {
  stop_mock || exit 1
  ROLE="$1" LEGACY="${2:-0}" node "$HERE/mock-api.mjs" >"$WORK/mock-$1${2:+-legacy}.log" 2>&1 &
  MOCK_PID=$!
  PIDS+=($MOCK_PID)

  for _ in $(seq 1 20); do
    if curl -sf -o /dev/null -m 1 "http://127.0.0.1:$MOCK_PORT/api/v1/auth/me"; then return 0; fi
    sleep 0.5
  done
  echo "Mock-ul nu a pornit ca $1." >&2
  exit 1
}

start_mock VIEWER
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$APP_PORT/" && break
  sleep 1
done

fail=0

step "Capture the prototype"
SIDE=proto MODE=static      node "$HERE/capture.mjs" || fail=1
SIDE=proto MODE=interactive node "$HERE/capture.mjs" || fail=1

step "Capture React as VIEWER"
SIDE=react MODE=static      node "$HERE/capture.mjs" || fail=1
SIDE=react MODE=interactive node "$HERE/capture.mjs" || fail=1

step "Compare — static views"
MODE=static node "$HERE/compare.mjs" || fail=1

step "Compare — interaction"
MODE=interactive node "$HERE/compare.mjs" || fail=1

step "Role gate"
ROLE=VIEWER node "$HERE/role-gate.spec.mjs" || fail=1
start_mock EDITOR
ROLE=EDITOR node "$HERE/role-gate.spec.mjs" || fail=1
start_mock ADMIN
ROLE=ADMIN node "$HERE/role-gate.spec.mjs" || fail=1

step "Compare as ADMIN — must be identical too, editing lives in Administrare"
SIDE=react MODE=static node "$HERE/capture.mjs" || fail=1
MODE=static node "$HERE/compare.mjs" || fail=1

step "Administrare → Strategie"
node "$HERE/admin-edit.spec.mjs" || fail=1

step "Stale API — diagnosed, not crashed on"
start_mock ADMIN 1
node "$HERE/stale-api.spec.mjs" || fail=1

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32mALL CHECKS PASSED\033[0m — artefacts in %s\n' "$WORK/shots"
else
  printf '\033[31mFAILURES\033[0m — see the diff images in %s\n' "$WORK/shots"
fi
exit "$fail"
