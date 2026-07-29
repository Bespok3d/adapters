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
