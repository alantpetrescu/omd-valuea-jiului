#!/usr/bin/env bash
#
# Administrare → Strategie — the TASK-2 suite.
#
#   cd frontend && pnpm run test:admin-strategy
#
# Reuses the parity harness: the same fixture built from the demo seed, the same
# mock API, the same Vite dev server. It only starts the mock with
# ADMIN_STRATEGY=1, which adds a `P5.10` programme and a second strategy version
# — natural ordering and cloning cannot be tested without them, and neither
# belongs in the fixture the visual comparison uses.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARITY="$HERE/../visual-parity"
FRONTEND="$(cd "$HERE/../.." && pwd)"
WORK="${OMD_PARITY_WORK:-$PARITY/.work}"
MOCK_PORT="${OMD_MOCK_PORT:-3000}"
APP_PORT="${OMD_APP_PORT:-5174}"

if curl -sf -o /dev/null -m 2 "http://127.0.0.1:$MOCK_PORT/api/v1/health"; then
  echo "The real API is answering on :$MOCK_PORT — stop it, or set OMD_MOCK_PORT." >&2
  exit 1
fi

mkdir -p "$WORK"

PIDS=()
cleanup() { for pid in "${PIDS[@]:-}"; do kill "$pid" 2>/dev/null; done; }
trap cleanup EXIT

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

step "Fixture from OMD_CAMPAIGNS_PACKAGE_DEMO_SEED_v1.json"
node "$PARITY/make-fixture.mjs" || exit 1

step "Vite dev server on :$APP_PORT"
(cd "$FRONTEND" && npx vite --host 127.0.0.1 --port "$APP_PORT" >"$WORK/vite-admin.log" 2>&1) &
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
  ROLE="$1" ADMIN_STRATEGY=1 node "$PARITY/mock-api.mjs" >"$WORK/mock-admin-$1.log" 2>&1 &
  MOCK_PID=$!
  PIDS+=($MOCK_PID)

  for _ in $(seq 1 20); do
    if curl -sf -o /dev/null -m 1 "http://127.0.0.1:$MOCK_PORT/api/v1/auth/me"; then return 0; fi
    sleep 0.5
  done
  echo "Mock-ul nu a pornit ca $1." >&2
  exit 1
}

start_mock ADMIN
for _ in $(seq 1 30); do
  curl -sf -o /dev/null "http://127.0.0.1:$APP_PORT/" && break
  sleep 1
done

fail=0

step "Acțiuni, fișă, cod, relații, sortare, ștergere, clonare"
node "$HERE/admin-strategy.spec.mjs" || fail=1

step "Poarta de rol pe /admin"
ROLE=ADMIN node "$HERE/role-gate.spec.mjs" || fail=1
start_mock EDITOR
ROLE=EDITOR node "$HERE/role-gate.spec.mjs" || fail=1
start_mock VIEWER
ROLE=VIEWER node "$HERE/role-gate.spec.mjs" || fail=1

printf '\n'
if [ "$fail" -eq 0 ]; then
  printf '\033[32mALL CHECKS PASSED\033[0m\n'
else
  printf '\033[31mFAILURES\033[0m — see the log above\n'
fi
exit "$fail"
