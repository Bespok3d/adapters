#!/usr/bin/env bash
# The snapmaker-u1 adapter's own gate, parity with the daemon and app gates. The adapter is its own
# repo with two halves: a TypeScript client and a Python jinni. It borrows the daemon's venv for the
# jinni's Python toolchain and the app's node toolchain for the client's TS, exactly as the workspace gate
# already borrows the daemon venv for plugin/adapter Python. Adapter-specific guards (em-dash ban,
# size ratchet) are run from here. Exits non-zero on any failure.
set -uo pipefail

ADAPTER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE="$(cd "$ADAPTER_ROOT/../.." && pwd)"
DAEMON_DIR="$WORKSPACE/daemon"
KLIPPER_JINNI_DIR="$WORKSPACE/adapters/klipper-jinni"
VENV="$DAEMON_DIR/.venv"
RUFF_CFG="$DAEMON_DIR/pyproject.toml"
APP_DIR="$WORKSPACE/Bespok3d-desktop"
JINNI="$ADAPTER_ROOT/jinni"

pass=0
fail=0

run_check() {
  name="$1"
  shift
  if out="$("$@" 2>&1)"; then
    printf '  %-30s ok\n' "$name"
    pass=$((pass + 1))
  else
    printf '  %-30s FAIL\n' "$name"
    fail=$((fail + 1))
    printf '\n--- %s ---\n%s\n\n' "$name" "$out"
  fi
}

echo "Adapter gate: snapmaker-u1"

run_check "em-dash / en-dash ban" node "$ADAPTER_ROOT/scripts/em-dash-guard.mjs"
run_check "size ratchet"          node "$ADAPTER_ROOT/scripts/ratchet.mjs"

run_check "ruff (jinni)"   "$VENV/bin/ruff" check --config "$RUFF_CFG" "$JINNI"
run_check "mypy (jinni)"   env MYPYPATH="$DAEMON_DIR:$KLIPPER_JINNI_DIR" "$VENV/bin/mypy" --config-file "$RUFF_CFG" \
    "$JINNI/bespok3d_jinni.py" "$JINNI/device_health.py" "$JINNI/service_scripts.py" "$JINNI/wifi_watchdog.py"
run_check "pytest (jinni)" "$VENV/bin/pytest" --tb=short -q "$JINNI/tests"

run_check "tsc (client)"    bash -c "cd '$APP_DIR' && npx --no-install tsc -p tsconfig.node.json --noEmit"
run_check "eslint (client)" bash -c "cd '$ADAPTER_ROOT' && '$APP_DIR/node_modules/.bin/eslint' client"
run_check "vitest (client)" bash -c "cd '$ADAPTER_ROOT' && '$APP_DIR/node_modules/.bin/vitest' run"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
