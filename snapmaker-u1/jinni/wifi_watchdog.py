# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1's wifi self-heal watchdog.

A background loop that keeps the live Wi-Fi config linked to its copy in /userdata, and restores the
stock wifi credentials and bounces wlan0 whenever the interface is present but has lost its IP. This
is a device-realm resilience task the jinni runs in the background, NOT part of the jinni contract
surface, so it lives on its own next to the jinni class.
"""
import asyncio
import logging
import subprocess
from pathlib import Path

from wifi_persistence import keep_live_wifi, saved_network

WIFI_CRED_SRC = Path("/oem/printer_data/gui/wpa_supplicant.conf")
WIFI_CRED_DST = Path("/etc/wpa_supplicant.conf")
WIFI_PERSISTENT_CONFIG = Path("/userdata/cfg/wpa_config.conf")
WLAN_IFACE = "wlan0"
WATCHDOG_INTERVAL_S = 30
IP_TIMEOUT_S = 10
IFUPDOWN_TIMEOUT_S = 60
COPY_FAILED = (
    "The printer could not put the Wi-Fi saved on its screen in use,"
    " so its Wi-Fi may not come back: %s"
)
HEAL_FAILED = "The printer could not check or restart its Wi-Fi, and keeps trying: %s"
HEAL_WORKS_AGAIN = "The printer can check and restart its Wi-Fi again."

logger = logging.getLogger(__name__)


def _wlan_exists() -> bool:
    result = subprocess.run(
        ["ip", "link", "show", WLAN_IFACE], capture_output=True, timeout=IP_TIMEOUT_S, check=False,
    )
    return result.returncode == 0


def wlan_has_ip() -> bool:
    result = subprocess.run(
        ["ip", "-4", "addr", "show", WLAN_IFACE],
        capture_output=True, text=True, timeout=IP_TIMEOUT_S, check=False,
    )
    return "inet " in result.stdout


def _saved_network_kept(live_config: Path) -> bool:
    """A printer enrolled before keeps its network in /userdata, and the live config links there."""
    return live_config.is_symlink() and bool(saved_network(live_config))


def _copy_screen_wifi(screen_copy: Path, live_config: Path) -> None:
    # Writing through the link would replace the kept network with the screen's copy.
    if _saved_network_kept(live_config):
        return
    screen_wifi = saved_network(screen_copy)
    if screen_wifi:
        live_config.write_bytes(screen_wifi)


def _restore_stock_credentials() -> None:
    # A failed copy must not stop the Wi-Fi restart, which can still connect with the config there.
    try:
        _copy_screen_wifi(WIFI_CRED_SRC, WIFI_CRED_DST)
    except OSError as error:
        logger.warning(COPY_FAILED, error)


def _restore_wifi() -> None:
    _restore_stock_credentials()
    # ifdown exits non-zero when wlan0 is already down; ifup says if the restart worked.
    subprocess.run(
        ["ifdown", WLAN_IFACE], capture_output=True, timeout=IFUPDOWN_TIMEOUT_S, check=False,
    )
    subprocess.run(
        ["ifup", WLAN_IFACE], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, timeout=IFUPDOWN_TIMEOUT_S, check=True,
    )


def _check_and_heal() -> None:
    # The link goes back first, because the restore keeps a network only when the live config links
    # to it. A failure to put it back must not stop the restore, so the restore runs regardless.
    try:
        keep_live_wifi(WIFI_CRED_DST, WIFI_PERSISTENT_CONFIG)
    finally:
        if _wlan_exists() and not wlan_has_ip():
            _restore_wifi()


def _failure_detail(error: Exception) -> str:
    if isinstance(error, subprocess.CalledProcessError) and error.output:
        return f"{error} {error.output.strip()}"
    return str(error)


def _logged_failure(error: Exception, last_failure: str) -> str:
    """What failed, written to the log unless the last round failed the same way."""
    # The same failure every round would flood the daemon log. ifup's output changes from try to
    # try, so it is logged but does not count as a new failure.
    failure = str(error)
    if failure != last_failure:
        logger.warning(HEAL_FAILED, _failure_detail(error))
    return failure


def _heal_round(last_failure: str) -> str:
    """One check-and-heal. Returns what failed, or nothing when it went fine."""
    # The watchdog runs as a task nobody awaits, so an error raised in a round would end it
    # silently and the Wi-Fi would never be healed again. The next round tries again.
    try:
        _check_and_heal()
    except Exception as error:
        return _logged_failure(error, last_failure)
    # Warning level: the jinni sets up no logging, and only warnings reach the daemon log.
    if last_failure:
        logger.warning(HEAL_WORKS_AGAIN)
    return ""


async def wifi_watchdog() -> None:
    last_failure = ""
    while True:
        last_failure = await asyncio.to_thread(_heal_round, last_failure)
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
