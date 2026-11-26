# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1's boot check that the screen shows the Wi-Fi it really has.

At boot both the stock network scripts and the screen app start wpa_supplicant on wlan0. When the
screen app loses that race, its log says "Open wifi ... ret:-1" and the screen shows Wi-Fi off,
while the network works. The screen app's supervisor (lmd) starts it again after it ends, and the
new one opens Wi-Fi fine. So once per boot, when the screen app's Wi-Fi open failed while wlan0 has
an IP, nothing prints and lmd runs, this check ends the screen app.
"""
import asyncio
import logging
import re
import subprocess
import time
from collections.abc import Callable
from datetime import datetime
from pathlib import Path

from screen_log import SCREEN_LOG, read_screen_log
from wifi_watchdog import wlan_has_ip

UPTIME_FILE = Path("/proc/uptime")
# /run is emptied at every boot, so this file keeps the restart to once per boot, even when the
# jinni itself restarts.
RESTARTED_MARK = Path("/run/bespok3d-screen-wifi-restarted")
SCREEN_APP = "gui"
SCREEN_SUPERVISOR = "lmd"
# A power cut can leave NUL bytes in the log ahead of the next boot's first line.
OPEN_RESULT = re.compile(
    rb"^\x00*(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+) .*\{rk_wifi_handler\} Open wifi .* ret:(-?\d+)",
    re.MULTILINE,
)
LOG_TIME_FORMAT = "%Y-%m-%d %H:%M:%S.%f"
FAILED_OPEN = "-1"
BOOT_WINDOW_S = 300
CHECK_INTERVAL_S = 5
# The clock starts from the RTC and then steps to network time, seen 7 s apart on a U1, so a line
# written early in this boot can carry a time before the boot time computed now.
BOOT_CLOCK_SLACK_S = 30
PROCESS_TIMEOUT_S = 10
SCREEN_RESTARTED = (
    "The screen showed Wi-Fi off while the printer was connected, so the printer restarted the"
    " screen app."
)

logger = logging.getLogger(__name__)


def _uptime() -> float:
    return float(UPTIME_FILE.read_text().split()[0])


def _gui_log_tail() -> bytes:
    # No log yet means the screen app has not opened Wi-Fi yet.
    try:
        return read_screen_log(SCREEN_LOG).log_text
    except FileNotFoundError:
        return b""


def boot_open_result(log_tail: bytes, boot_time: float) -> str:
    """How the screen app's last Wi-Fi open of this boot ended ("0", "-1"), or nothing yet."""
    opens = OPEN_RESULT.findall(log_tail)
    if not opens:
        return ""
    opened_at, open_result = opens[-1]
    opened_time = datetime.strptime(opened_at.decode(), LOG_TIME_FORMAT).timestamp()
    return open_result.decode() if opened_time >= boot_time - BOOT_CLOCK_SLACK_S else ""


def _process_running(process_name: str) -> bool:
    result = subprocess.run(
        ["pgrep", "-x", process_name], capture_output=True, timeout=PROCESS_TIMEOUT_S, check=False,
    )
    return result.returncode == 0


def _safe_to_restart(print_active: Callable[[], tuple[bool, str]]) -> bool:
    # A screen app that is not running is being started again and opens Wi-Fi anew. Without lmd
    # nothing would start the screen app again, and the screen would stay dark.
    return (
        wlan_has_ip() and _process_running(SCREEN_APP) and _process_running(SCREEN_SUPERVISOR)
        and not print_active()[0]
    )


def _restart_screen_app() -> None:
    RESTARTED_MARK.touch()
    # A plain kill (SIGTERM), as tested by hand on a U1: lmd starts the screen app again.
    subprocess.run(
        ["killall", SCREEN_APP], capture_output=True, timeout=PROCESS_TIMEOUT_S, check=True,
    )
    # Warning level: the jinni sets up no logging, and only warnings reach the daemon log.
    logger.warning(SCREEN_RESTARTED)


def _restart_when_safe(print_active: Callable[[], tuple[bool, str]]) -> bool:
    """True once the screen app was restarted, False while it is not safe yet."""
    if not _safe_to_restart(print_active):
        return False
    _restart_screen_app()
    return True


def screen_wifi_round(print_active: Callable[[], tuple[bool, str]]) -> bool:
    """One look at the screen's Wi-Fi. True when nothing is left to do this boot."""
    uptime = _uptime()
    if RESTARTED_MARK.exists() or uptime > BOOT_WINDOW_S:
        return True
    open_result = boot_open_result(_gui_log_tail(), time.time() - uptime)
    if open_result == FAILED_OPEN:
        return _restart_when_safe(print_active)
    # No open yet this boot means waiting for it; an open that worked leaves nothing to do.
    return bool(open_result)


async def screen_wifi_check(print_active: Callable[[], tuple[bool, str]]) -> None:
    while not await asyncio.to_thread(screen_wifi_round, print_active):
        await asyncio.sleep(CHECK_INTERVAL_S)
