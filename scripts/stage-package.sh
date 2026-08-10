#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Lay the jinni out as a b3-builder plugin source dir (unit: plugin), modelled on
# daemon/scripts/stage-package.sh: manifest.json at the stage root, the deployed payload under
# files/. b3-builder's packPlugin only reads files/ and doc/ out of a plugin source dir (and root
# dependency declarations); a payload staged flat at the root is packed as if it did not exist.
#
# Within files/, the layout mirrors the printer layout in jinni-package-spec.md: the u1 half does
# `from jinni import KlipperPrinterJinni`, so the shared runtime is staged as a files/jinni/
# sibling, and the u1 device files sit at the files/ root beside it.
#
# One package carries two source trees (klipper-jinni/jinni/ and snapmaker-u1/jinni/), so there is
# no single directory to point b3-builder at in place; this script is what composes them.
#
# tests/ and __pycache__ are never copied, from either source tree, at the copy: stronger than
# excluding them at pack time.
#
# Requires: jq.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
U1_JINNI_DIR="$REPO_DIR/snapmaker-u1/jinni"
SHARED_JINNI_DIR="$REPO_DIR/klipper-jinni/jinni"
MANIFEST="$U1_JINNI_DIR/manifest.json"

command -v jq >/dev/null 2>&1 || { echo "ERROR: 'jq' is required." >&2; exit 1; }
[ -f "$MANIFEST" ] || { echo "ERROR: $MANIFEST not found." >&2; exit 1; }

stage_dir="$REPO_DIR/dist/package"
files_root="$stage_dir/files"
shared_root="$files_root/jinni"

rm -rf "$stage_dir"
mkdir -p "$shared_root"
cp -p "$MANIFEST" "$stage_dir/manifest.json"

# The shared klipper jinni runtime, recursively, excluding __pycache__.
( cd "$SHARED_JINNI_DIR" && find . -type f -name '*.py' ! -path '*/__pycache__/*' ) \
  | while read -r rel; do
      mkdir -p "$shared_root/$(dirname "$rel")"
      cp -p "$SHARED_JINNI_DIR/$rel" "$shared_root/$rel"
    done

# The u1 device files, top level only: everything in snapmaker-u1/jinni/ except manifest.json
# (already staged at the package root above), tests/, and the tool caches.
( cd "$U1_JINNI_DIR" && find . -maxdepth 1 -type f ! -name 'manifest.json' ! -name '.DS_Store' ) \
  | while read -r rel; do
      cp -p "$U1_JINNI_DIR/$rel" "$files_root/$rel"
    done

echo "Staged: $stage_dir"
