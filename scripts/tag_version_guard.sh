#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: GPL-3.0-only
# Guard: a `jinni-snapmaker-u1-v<version>` release tag must carry the exact version the jinni's
# manifest declares.
#
# The release workflow fires on the tag, but the package, the GitHub release and the index atom the
# app reads are all stamped from manifest.json. A tag whose number disagrees therefore publishes a
# package the tag lies about, and the disagreement is invisible afterwards. Refuse the run instead.
#
# Refusing a ref that is not a release tag at all is the same guard from the other side: that is what
# a Run workflow click against a branch looks like, and a branch must never publish.
set -eu

TAG_PREFIX="jinni-snapmaker-u1-v"
MANIFEST="snapmaker-u1/jinni/manifest.json"

ref_name="${1:-}"

case "$ref_name" in
    "$TAG_PREFIX"*) ;;
    *)
        echo "'$ref_name' is not a ${TAG_PREFIX}<version> tag: a release is published by a version" \
             "tag and by nothing else" >&2
        exit 1
        ;;
esac

claimed_version="${ref_name#"$TAG_PREFIX"}"
declared_version="$(jq -r '.version' "$MANIFEST")"

if [ "$claimed_version" != "$declared_version" ]; then
    echo "tag '$ref_name' claims $claimed_version but $MANIFEST declares $declared_version:" \
         "the package would be published as $declared_version" >&2
    exit 1
fi

echo "tag '$ref_name' matches the version the jinni declares: $declared_version"
