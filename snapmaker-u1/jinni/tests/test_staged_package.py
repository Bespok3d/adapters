# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""scripts/stage-package.sh composes one publishable package from two source trees.

A staged output that carries a test file or a cache directory ships that noise to a printer, and a
staged output missing either half is a jinni that cannot import itself. This runs the real script
and inspects its real output, not a description of what it should do.
"""

import json
import subprocess
from pathlib import Path

ADAPTERS_ROOT = Path(__file__).resolve().parents[3]
STAGE_DIR = ADAPTERS_ROOT / "dist" / "package"
PACKAGE_NAME = json.loads(
    (ADAPTERS_ROOT / "snapmaker-u1" / "jinni" / "manifest.json").read_text()
)["name"]
PACKAGE_DIR = STAGE_DIR / PACKAGE_NAME


def _stage() -> None:
    subprocess.run(
        ["sh", str(ADAPTERS_ROOT / "scripts" / "stage-package.sh")],
        cwd=ADAPTERS_ROOT,
        check=True,
        capture_output=True,
    )


def test_staged_package_carries_no_tests_or_caches() -> None:
    _stage()
    staged = list(STAGE_DIR.rglob("*"))

    assert not any(p.name == "tests" for p in staged), "tests/ must never reach a printer"
    assert not any(
        p.name == "__pycache__" for p in staged
    ), "__pycache__ must never reach a printer"


def test_the_jinni_is_staged_as_a_named_dir_because_that_is_what_releases() -> None:
    _stage()

    assert (
        PACKAGE_DIR / "manifest.json"
    ).is_file(), "b3-builder releases by walking the named dirs under the source dir"


def test_staged_package_carries_both_halves() -> None:
    _stage()
    files_root = PACKAGE_DIR / "files"

    assert (PACKAGE_DIR / "manifest.json").is_file()
    assert (files_root / "bespok3d_jinni.py").is_file(), "the u1 half must be staged under files/"
    assert (
        files_root / "jinni" / "__init__.py"
    ).is_file(), "the shared runtime must be staged under files/jinni/"
