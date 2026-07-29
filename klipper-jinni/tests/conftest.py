# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import sys
from pathlib import Path

# The klipper jinni is its own app: the `jinni` package lives here. It speaks the daemon's
# `protocol` package (the one thing the two apps share); the together tests also drive the daemon's
# `core` seam over the socket. Both are resolved from the sibling daemon app.
KLIPPER_JINNI_DIR = Path(__file__).resolve().parent.parent
DAEMON_DIR = KLIPPER_JINNI_DIR.parent.parent / "daemon"

sys.path.insert(0, str(DAEMON_DIR))
sys.path.insert(0, str(KLIPPER_JINNI_DIR))
