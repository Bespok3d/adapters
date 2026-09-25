#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Guard: a `jinni-<adapter>-v<version>` release tag must name an adapter this repo carries and must
# carry the exact version that adapter's jinni manifest declares.
#
# The release workflow fires on the tag, but the package, the GitHub release and the index atom the
# app reads are all stamped from manifest.json. A tag whose number disagrees therefore publishes a
# package the tag lies about, and the disagreement is invisible afterwards. Refuse the run instead.
#
# Refusing a ref that is not a release tag at all is the same guard from the other side: that is what
# a Run workflow click against a branch looks like, and a branch must never publish.
#
# The last line of stdout is `adapter=<name>`, so the workflow reads which adapter is releasing off
# the guard that already had to work it out, rather than parsing the tag a second time.
set -eu

TAG_PREFIX="jinni-"

ref_name="${1:-}"

case "$ref_name" in
    "$TAG_PREFIX"*-v*) ;;
    *)
        echo "'$ref_name' is not a ${TAG_PREFIX}<adapter>-v<version> tag: a release is published by a" \
             "version tag and by nothing else" >&2
        exit 1
        ;;
esac

tag_body="${ref_name#"$TAG_PREFIX"}"
adapter_name="${tag_body%-v*}"
claimed_version="${tag_body##*-v}"

case "$adapter_name" in
    */*|.*|"")
        echo "tag '$ref_name' names '$adapter_name', which is not an adapter directory in this repo" >&2
        exit 1
        ;;
esac

MANIFEST="$adapter_name/jinni/manifest.json"

if [ ! -f "$MANIFEST" ]; then
    echo "tag '$ref_name' names adapter '$adapter_name', but $MANIFEST does not exist: there is no" \
         "jinni here to release" >&2
    exit 1
fi

declared_version="$(jq -r '.version' "$MANIFEST")"

if [ "$claimed_version" != "$declared_version" ]; then
    echo "tag '$ref_name' claims $claimed_version but $MANIFEST declares $declared_version:" \
         "the package would be published as $declared_version" >&2
    exit 1
fi

echo "tag '$ref_name' matches the version the $adapter_name jinni declares: $declared_version"
echo "adapter=$adapter_name"
