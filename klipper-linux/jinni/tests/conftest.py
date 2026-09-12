# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import os
import sys
from collections.abc import Mapping
from pathlib import Path

JINNI_DIR = Path(__file__).resolve().parent.parent  # this adapter's device jinni (bespok3d_jinni)
ADAPTERS_DIR = JINNI_DIR.parent.parent  # the org's adapters/ tree
# The device jinni extends the shared klipper jinni runtime (the `jinni` package, in the sibling
# klipper-jinni app) and speaks the daemon's `protocol` package. Two separate apps; resolve both.
KLIPPER_JINNI_DIR = ADAPTERS_DIR / "klipper-jinni"


def daemon_dir_from(environment: Mapping[str, str], workspace_root: Path) -> Path:
    """Where the daemon repo holding the `protocol` package sits for this run.

    A CI runner checks out one repo, so the daemon cannot be a workspace sibling there. The workflow
    fetches it at a pinned commit and names where it landed in B3D_DAEMON_DIR; a developer workspace
    has it next to adapters/ and sets nothing.
    """
    return Path(environment.get("B3D_DAEMON_DIR") or workspace_root / "daemon").resolve()


DAEMON_DIR = daemon_dir_from(os.environ, ADAPTERS_DIR.parent)

sys.path.insert(0, str(DAEMON_DIR))
sys.path.insert(0, str(KLIPPER_JINNI_DIR))
sys.path.insert(0, str(JINNI_DIR))
