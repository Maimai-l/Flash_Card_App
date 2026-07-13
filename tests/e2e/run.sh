#!/usr/bin/env bash
# End-to-end regression harness.
#   1. builds a small fixture user-data dir
#   2. launches the app headless with the dev bridge
#   3. runs the Playwright smoke test against it
#   4. tears the server down
#
# Run from the repo root:  bash tests/e2e/run.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UD="$(mktemp -d)"
PORT=18765

cleanup() {
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  rm -rf "$UD"
}
trap cleanup EXIT

echo "[e2e] building fixture at $UD"
python3 "$ROOT/tests/e2e/build_fixture.py" "$UD" || exit 1

echo "[e2e] starting headless server"
FLASHCARD_DEV_BRIDGE=1 FLASHCARD_NO_WINDOW=1 FLASHCARD_USER_DATA="$UD" \
  python3 "$ROOT/main.py" > "$UD/server.log" 2>&1 &
SERVER_PID=$!

# wait for readiness
for i in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/index.html"; then break; fi
  sleep 0.5
done

echo "[e2e] running Playwright smoke"
BASE_URL="http://127.0.0.1:$PORT" node "$ROOT/tests/e2e/smoke.mjs"
RC=$?

echo "[e2e] running Playwright interaction"
BASE_URL="http://127.0.0.1:$PORT" node "$ROOT/tests/e2e/interaction.mjs"
RC2=$?

if [ $RC -ne 0 ] || [ $RC2 -ne 0 ]; then
  echo "[e2e] server log tail:"; tail -20 "$UD/server.log"
  exit 1
fi
exit 0
