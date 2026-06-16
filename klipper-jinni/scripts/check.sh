#!/usr/bin/env bash
# The klipper-jinni app's own gate. klipper-jinni is a separate app from the daemon: the shared
# klipper jinni runtime that device adapters (snapmaker-u1, future Voron) extend. It speaks the
# daemon's `protocol` package (the one thing the two apps share) and borrows the daemon's venv for
# its Python toolchain, the same way the adapter and app gates do. Isolation tests (the jinni alone)
# and together tests (the daemon seam driving a real jinni over the socket) both run here.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DAEMON_DIR="$(cd "$ROOT/../.." && pwd)/daemon"
VENV="$DAEMON_DIR/.venv"
CFG="$DAEMON_DIR/pyproject.toml"

pass=0
fail=0

run_check() {
  name="$1"
  shift
  if out="$("$@" 2>&1)"; then
    printf '  %-28s ok\n' "$name"
    pass=$((pass + 1))
  else
    printf '  %-28s FAIL\n' "$name"
    fail=$((fail + 1))
    printf '\n--- %s ---\n%s\n\n' "$name" "$out"
  fi
}

echo "klipper-jinni gate"

run_check "em-dash / en-dash ban" "$VENV/bin/python" "$ROOT/scripts/em_dash_guard.py"
run_check "size ratchet" "$VENV/bin/python" "$ROOT/scripts/size_ratchet.py"
run_check "ruff" "$VENV/bin/ruff" check --config "$CFG" "$ROOT/jinni" "$ROOT/tests"
run_check "mypy" env MYPYPATH="$ROOT:$DAEMON_DIR" "$VENV/bin/mypy" --config-file "$CFG" "$ROOT/jinni"
run_check "pytest" bash -c "cd '$ROOT' && '$VENV/bin/pytest' --tb=short -q tests"

echo ""
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
