#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Lay each adapter's jinni out as a b3-builder repo-unit source dir, modelled on
# daemon/scripts/stage-package.sh: one named plugin dir under dist/package/, holding manifest.json at
# its root and the deployed payload under files/. b3-builder's packPlugin only reads files/ and doc/
# out of a plugin source dir (and root dependency declarations); a payload staged flat at the root is
# packed as if it did not exist.
#
# The named dir is what makes the release happen: b3-builder's Action releases by walking the
# immediate subdirs of the source dir for a manifest.json. A package staged flat at dist/package/ packs
# and signs, then releases nothing at all and the run only fails a step later, with no release to
# attach the index atom to.
#
# Within files/, the layout mirrors the printer layout in jinni-package-spec.md: every device half does
# `from jinni import KlipperPrinterJinni`, so the shared runtime is staged as a files/jinni/ sibling,
# and that adapter's device files sit at the files/ root beside it.
#
# One package carries two source trees (klipper-jinni/jinni/ and <adapter>/jinni/), so there is no
# single directory to point b3-builder at in place; this script is what composes them.
#
# With no arguments it stages every adapter that carries a jinni/manifest.json, which is what a pull
# request proves. Named adapters stage only those, which is what a release tag needs: one tag names
# one adapter, and a release must publish that one and no other.
#
#   sh scripts/stage-package.sh                 # every adapter
#   sh scripts/stage-package.sh klipper-linux   # just this one
#
# tests/ and __pycache__ are never copied, from either source tree, at the copy: stronger than
# excluding them at pack time.
#
# Requires: jq.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
SHARED_JINNI_DIR="$REPO_DIR/klipper-jinni/jinni"
PACKAGE_ROOT="$REPO_DIR/dist/package"

command -v jq >/dev/null 2>&1 || { echo "ERROR: 'jq' is required." >&2; exit 1; }

# Every adapter directory holding a jinni manifest, named the way an argument would name it. The
# shared klipper-jinni runtime carries no manifest of its own, so it is a source tree here and never a
# package, which is what keeps this list honest without naming any adapter.
discover_adapters() {
    ( cd "$REPO_DIR" && find . -mindepth 3 -maxdepth 3 -type f -path './*/jinni/manifest.json' ) \
      | sed -e 's|^\./||' -e 's|/jinni/manifest\.json$||' \
      | sort
}

stage_adapter() {
    adapter_name="${1%/}"
    adapter_jinni_dir="$REPO_DIR/$adapter_name/jinni"
    manifest="$adapter_jinni_dir/manifest.json"
    [ -f "$manifest" ] || { echo "ERROR: $manifest not found." >&2; exit 1; }

    package_name="$(jq -r '.name' "$manifest")"
    stage_dir="$PACKAGE_ROOT/$package_name"
    files_root="$stage_dir/files"
    shared_root="$files_root/jinni"

    mkdir -p "$shared_root"
    cp -p "$manifest" "$stage_dir/manifest.json"

    # The shared klipper jinni runtime, recursively, excluding __pycache__.
    ( cd "$SHARED_JINNI_DIR" && find . -type f -name '*.py' ! -path '*/__pycache__/*' ) \
      | while read -r rel; do
          mkdir -p "$shared_root/$(dirname "$rel")"
          cp -p "$SHARED_JINNI_DIR/$rel" "$shared_root/$rel"
        done

    # The adapter's device files, top level only: everything in <adapter>/jinni/ except manifest.json
    # (already staged at the package root above), tests/, doc/, and the tool caches.
    ( cd "$adapter_jinni_dir" && find . -maxdepth 1 -type f ! -name 'manifest.json' ! -name '.DS_Store' ) \
      | while read -r rel; do
          cp -p "$adapter_jinni_dir/$rel" "$files_root/$rel"
        done

    echo "Staged: $stage_dir"
}

rm -rf "$PACKAGE_ROOT"

if [ "$#" -gt 0 ]; then
    for named_adapter in "$@"; do
        stage_adapter "$named_adapter"
    done
else
    discover_adapters | while read -r found_adapter; do
        stage_adapter "$found_adapter"
    done
fi
