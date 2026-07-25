#!/usr/bin/env bash
# The klipper-jinni app's own gate. klipper-jinni is a separate app from the daemon: the shared
# klipper jinni runtime that device adapters (snapmaker-u1, future Voron) extend. Its toolchain is
# the shared one, so this repo no longer needs the daemon's venv built to be green. It does still
# need the daemon CHECKED OUT: it speaks the daemon's `protocol` package and the together tests
# drive the daemon's `core` seam over the socket. Isolation tests (the jinni alone) and together
# tests both run here. Exits non-zero on any failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The shared gate helpers and the detectors that enforce a workspace-wide rule live in one place.
# See lib_bespok3d/tooling/README.md. This is the only line that knows where they are.
B3D_TOOLING="${B3D_TOOLING:-$REPO_ROOT/../../lib_bespok3d/tooling}"
# shellcheck source=/dev/null
. "$B3D_TOOLING/gate-lib.sh"

cd "$REPO_ROOT" || exit 1

DAEMON_DIR="$REPO_ROOT/../../daemon"

echo ""
echo "klipper-jinni gate"

b3d_python_tools

run_check "size ratchet"  "$B3D_PY" scripts/size_ratchet.py
run_check "ruff"          ruff_in_dir "$REPO_ROOT" jinni tests
# The shared `protocol` package is the daemon's, so the type checker resolves it the same way the
# tests' conftest does.
export MYPYPATH="$REPO_ROOT:$DAEMON_DIR"
run_check "mypy"          mypy_in_dir "$REPO_ROOT" jinni
unset MYPYPATH
run_check "pytest"        pytest_in_dir "$REPO_ROOT" tests

workflow_pinning_check "$REPO_ROOT"
em_dash_check "$REPO_ROOT"
shellcheck_repo "$REPO_ROOT"

gate_summary || exit 1
