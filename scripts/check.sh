#!/usr/bin/env bash
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# The adapters repo's own gate. The repo holds one adapter per directory and each adapter carries the
# gate that knows how to check itself, so this script owns no rules of its own: it runs every
# adapter's gate in turn and fails if any of them fails. It exists so a change that spans two
# adapters is gated by something, which is what a per-adapter gate alone cannot do.
# Exits non-zero if any adapter's gate fails. Runs them all first, so one failure does not hide
# another.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

FAILED=""

# The detectors that enforce a workspace-wide rule live in one place and are invoked by every repo's
# gate. See lib_bespok3d/tooling/README.md. This is the only line that knows where they are.
B3D_TOOLING="${B3D_TOOLING:-$REPO_ROOT/lib_bespok3d/tooling}"
if [ ! -f "$B3D_TOOLING/release-trigger-detector.mjs" ]; then
  echo "The shared gate helpers are missing or older than the checks this gate runs:" >&2
  echo "the lib_bespok3d submodule is not checked out, or is pinned to an older commit." >&2
  echo "Run this once from the repo root, then try again:" >&2
  echo "  git submodule sync --recursive && git submodule update --init --recursive" >&2
  exit 1
fi

# A submodule is another repo living here for the build's convenience. It carries its own gate, it is
# checked in its own repo, and its failures are not this repo's to report. lib_bespok3d is the one we
# have today; the rule is written against .gitmodules so the next one needs no edit here.
SUBMODULES="$(git config -f "$REPO_ROOT/.gitmodules" --get-regexp '^submodule\..*\.path$' 2>/dev/null | awk '{print $2}')"

for adapter_gate in "$REPO_ROOT"/*/scripts/check.sh; do
  [ -f "$adapter_gate" ] || continue
  adapter_dir="$(cd "$(dirname "$adapter_gate")/.." && pwd)"
  adapter_name="$(basename "$adapter_dir")"
  if echo "$SUBMODULES" | grep -qx "$adapter_name"; then
    echo ""
    echo "=== $adapter_name skipped, it is a submodule and gates in its own repo ==="
    continue
  fi
  echo ""
  echo "=== $adapter_name ==="
  if ! ( cd "$adapter_dir" && bash ./scripts/check.sh ); then
    FAILED="$FAILED $adapter_name"
  fi
done

# The release workflow lives at the repo root, so no adapter's own gate covers it. A release is
# published by a version tag and by nothing else, and the Run workflow button reaches the version
# guard instead of skipping the job.
echo ""
echo "=== this repo's release trigger ==="
if ! node "$B3D_TOOLING/release-trigger-detector.mjs" "$REPO_ROOT"; then
  FAILED="$FAILED adapters/.github/workflows/release.yml"
fi

# This script is a gate, so it holds itself to the same bar it holds the adapters to.
echo ""
echo "=== this gate ==="
if command -v shellcheck >/dev/null 2>&1; then
  if shellcheck "$REPO_ROOT/scripts/check.sh"; then
    echo "  shellcheck check.sh      ok"
  else
    FAILED="$FAILED adapters/scripts/check.sh"
  fi
else
  echo "  shellcheck               not installed, skipped"
fi

echo ""
if [ -n "$FAILED" ]; then
  echo "adapters gate RED, failing adapters:$FAILED"
  exit 1
fi

echo "adapters gate GREEN, every adapter's own gate passed"
