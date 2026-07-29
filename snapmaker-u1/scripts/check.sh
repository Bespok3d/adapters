#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# The snapmaker-u1 adapter's own gate. The adapter is one repo with two halves: a TypeScript client
# and a Python jinni. The Python half runs on the shared toolchain, so it no longer needs the
# daemon's venv built. The TS half is written against @adapter-sdk, which IS the app's adapter
# loader, so the client half needs the app repo checked out and uses its node toolchain, the same
# coupling eslint.config.mjs and vitest.config.ts already declare. Exits non-zero on any failure.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# The shared gate helpers and the detectors that enforce a workspace-wide rule live in one place.
# See lib_bespok3d/tooling/README.md. This is the only line that knows where they are.
B3D_TOOLING="${B3D_TOOLING:-$REPO_ROOT/../../lib_bespok3d/tooling}"
# shellcheck source=/dev/null
. "$B3D_TOOLING/gate-lib.sh"

cd "$REPO_ROOT" || exit 1

WORKSPACE="$REPO_ROOT/../.."
DAEMON_DIR="$WORKSPACE/daemon"
KLIPPER_JINNI_DIR="$WORKSPACE/adapters/klipper-jinni"
APP_DIR="$WORKSPACE/Bespok3d-desktop"

echo ""
echo "snapmaker-u1 adapter gate"

b3d_python_tools

run_check "size ratchet"   node "$REPO_ROOT/scripts/ratchet.mjs"

run_check "ruff (jinni)"   ruff_in_dir "$REPO_ROOT" jinni
# The jinni extends the shared klipper jinni and speaks the daemon's `protocol` package, so the type
# checker resolves both from their own repos, as the runtime does.
export MYPYPATH="$DAEMON_DIR:$KLIPPER_JINNI_DIR"
run_check "mypy (jinni)"   mypy_in_dir "$REPO_ROOT" \
    jinni/bespok3d_jinni.py jinni/device_health.py jinni/service_scripts.py jinni/wifi_watchdog.py
unset MYPYPATH
run_check "pytest (jinni)" pytest_in_dir "$REPO_ROOT" jinni/tests

run_check "tsc (client)"    bash -c "cd '$APP_DIR' && npx --no-install tsc -p tsconfig.node.json --noEmit"
run_check "eslint (client)" "$APP_DIR/node_modules/.bin/eslint" client
run_check "vitest (client)" "$APP_DIR/node_modules/.bin/vitest" run

workflow_pinning_check "$REPO_ROOT"
em_dash_check "$REPO_ROOT"
shellcheck_repo "$REPO_ROOT"

gate_summary || exit 1
