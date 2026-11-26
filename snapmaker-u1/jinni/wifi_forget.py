# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Whether the owner forgot the U1's Wi-Fi network on the screen.

Forgetting a network on the screen removes it from the live config, the printer loses its IP, and
the watchdog's restore put the network back within 30 seconds: from the kept copy, or from the
screen's own copy, which a forget leaves untouched. The live config alone cannot tell a forget from
a firmware update, which can also leave it with no network. The screen's log can: it writes a line
for every network it forgets.

So a forget counts when the screen logs it after the jinni last saw a network in the live config.
That is read by position in the log, not by time, so a clock that jumps at boot cannot misplace it,
and a forget logged before the jinni started never counts. Once seen, the forget is marked in
/userdata, so it outlasts the log's rotation and a reboot. The mark goes as soon as the live config
holds a network again.
"""
import os
import re
from dataclasses import dataclass
from pathlib import Path

from wifi_persistence import saved_network

SCREEN_LOG = Path("/home/lava/printer_data/logs/gui.log")
# Beside the kept Wi-Fi config it guards, where a firmware update does not reach either.
FORGOTTEN_MARK = Path("/userdata/cfg/bespok3d-wifi-forgotten")
# The screen's log grows by a few KB a minute, so a round never has more than this to read.
LOG_READ_LIMIT_BYTES = 1024 * 1024
# The screen app's own line on firmware 2.1.0 and 2.1.2, as logged on a U1:
# "... {module_rk_forget_remembered_wifi} Forget Remembered Wifi ret:0 ssid:<name> key_type:1"
FORGET_LOGGED = re.compile(rb"\{module_rk_forget_remembered_wifi\} Forget Remembered Wifi ret:0\b")
LINE_END = b"\n"


@dataclass(frozen=True)
class LogPosition:
    """How far the jinni has read the screen's log: which file, and up to which byte."""

    log_inode: int
    read_up_to: int


def _log_end(screen_log: Path) -> LogPosition | None:
    # No log means no screen line to go by, so nothing can count as a forget.
    try:
        log_stat = os.stat(screen_log)
    except FileNotFoundError:
        return None
    return LogPosition(log_stat.st_ino, log_stat.st_size)


def _unread_start(last_read: LogPosition, log_end: LogPosition) -> int:
    # A rotated or truncated log holds only lines written after the last read. A forget logged
    # into the old file just before it rotated is missed, and the network comes back as before.
    if log_end.log_inode != last_read.log_inode or log_end.read_up_to < last_read.read_up_to:
        return 0
    return last_read.read_up_to


def _read_whole_lines(screen_log: Path, unread_start: int) -> tuple[bytes, LogPosition]:
    """The whole lines logged from unread_start on, and the position right after them."""
    with screen_log.open("rb") as log_file:
        log_size = log_file.seek(0, os.SEEK_END)
        read_start = max(unread_start, log_size - LOG_READ_LIMIT_BYTES)
        log_file.seek(read_start)
        unread = log_file.read()
        log_inode = os.fstat(log_file.fileno()).st_ino
    # A line still being written is left for the next round, so a forget is never cut in two.
    whole_lines = unread[: unread.rfind(LINE_END) + 1]
    return whole_lines, LogPosition(log_inode, read_start + len(whole_lines))


class ForgetWatch:
    """Follows the live config and the screen's log, round by round, for a forgotten network."""

    def __init__(self, screen_log: Path, forgotten_mark: Path) -> None:
        self._screen_log = screen_log
        self._forgotten_mark = forgotten_mark
        # Nothing read yet: a forget counts only after this run has seen a network.
        self._last_read: LogPosition | None = None

    def follow(self, live_config: Path) -> None:
        """One round: notes where the log stands while the config holds a network, and marks a
        forget the screen logged since."""
        # The log's end is taken before the config is read, so a forget landing in between is
        # read next round instead of skipped.
        log_end = _log_end(self._screen_log)
        if saved_network(live_config):
            self._last_read = log_end
            self._forgotten_mark.unlink(missing_ok=True)
            return
        if self._last_read is None or log_end is None or self._forgotten_mark.exists():
            return
        whole_lines, self._last_read = _read_whole_lines(
            self._screen_log, _unread_start(self._last_read, log_end),
        )
        if FORGET_LOGGED.search(whole_lines):
            self._forgotten_mark.touch()

    def network_forgotten(self, live_config: Path) -> bool:
        """The owner forgot the network on the screen, so nothing may bring it back."""
        return self._forgotten_mark.exists() and not saved_network(live_config)
