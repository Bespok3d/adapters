#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# The klipper-linux adapter's own gate. The adapter is one repo with two halves: a TypeScript client
# and a Python jinni. The Python half runs on the shared toolchain. The TS half is written against
# @adapter-sdk, which IS the app's adapter loader, so the client half needs the app repo checked out
# and uses its node toolchain, the same coupling eslint.config.mjs and vitest.config.ts already
# declare. Exits non-zero on any failure.
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
echo "klipper-linux adapter gate"

b3d_python_tools

# The ratchet is the adapters repo's, not this adapter's: every adapter enforces the same ceilings
# against its own adapter-baseline.json.
run_check "size ratchet" node "$REPO_ROOT/../scripts/size-ratchet.mjs" "$REPO_ROOT"

run_check "ruff (jinni)"   ruff_in_dir "$REPO_ROOT" jinni
# The jinni extends the shared klipper jinni and speaks the daemon's `protocol` package, so the type
# checker resolves both from their own repos, as the runtime does.
export MYPYPATH="$DAEMON_DIR:$KLIPPER_JINNI_DIR"
run_check "mypy (jinni)"   mypy_in_dir "$REPO_ROOT" \
    jinni/bespok3d_jinni.py jinni/layout_discovery.py jinni/linux_facts.py \
    jinni/linux_layout.py jinni/service_scripts.py jinni/systemd_env.py
unset MYPYPATH
run_check "pytest (jinni)" pytest_in_dir "$REPO_ROOT" jinni/tests

run_check "tsc (client)"    bash -c "cd '$APP_DIR' && npx --no-install tsc -p tsconfig.node.json --noEmit"
run_check "eslint (client)" "$APP_DIR/node_modules/.bin/eslint" client
run_check "vitest (client)" "$APP_DIR/node_modules/.bin/vitest" run

workflow_pinning_check "$REPO_ROOT"
# The unit and sudoers templates ship to the printer as prose too, so they are read by the guard.
em_dash_check "$REPO_ROOT" --suffix .service --suffix .sudoers
shellcheck_repo "$REPO_ROOT"

gate_summary || exit 1
