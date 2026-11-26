# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The screen app's log, which the jinni reads to learn what the screen did with Wi-Fi."""
import os
from dataclasses import dataclass
from pathlib import Path

SCREEN_LOG = Path("/home/lava/printer_data/logs/gui.log")
# The log grows by a few KB a minute, and a boot's Wi-Fi open is ~30 KB after the screen app's start
# banner, so its last MiB holds every line the jinni looks for.
LOG_READ_LIMIT_BYTES = 1024 * 1024


@dataclass(frozen=True)
class LogRead:
    """What one read of the log returned, and where in which file it started."""

    log_text: bytes
    read_start: int
    log_inode: int


def read_screen_log(screen_log: Path, read_from: int = 0) -> LogRead:
    """The log from read_from on, no more than its last LOG_READ_LIMIT_BYTES."""
    # The size and the inode come from the open file, so a log rotated meanwhile cannot mix two
    # files.
    with screen_log.open("rb") as log_file:
        log_size = log_file.seek(0, os.SEEK_END)
        read_start = max(read_from, log_size - LOG_READ_LIMIT_BYTES)
        log_file.seek(read_start)
        return LogRead(log_file.read(), read_start, os.fstat(log_file.fileno()).st_ino)
