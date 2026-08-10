# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The published package must never advertise a version the running jinni does not report.

manifest.json is what the app and the printer read to decide whether a newer jinni exists;
version.json is what a running jinni answers with. A release built from a tree where those two
disagree ships a package that lies about itself, so the gate refuses the mismatch here. This is the
mirror system-map.md warns about: one file, two readers, no drift, and this test is the guard that
makes that true now that the manifest carries its own copy of the version.
"""

import json
from pathlib import Path

JINNI_DIR = Path(__file__).resolve().parent.parent


def test_manifest_version_matches_the_running_jinni_version() -> None:
    manifest = json.loads((JINNI_DIR / "manifest.json").read_text())
    version = json.loads((JINNI_DIR / "version.json").read_text())

    assert manifest["version"] == version["jinni_version"], (
        "bump manifest.json and version.json together"
    )
