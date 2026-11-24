# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1's wifi self-heal watchdog.

A background loop that keeps the live Wi-Fi config linked to its copy in /userdata, and restores the
stock wifi credentials and bounces wlan0 whenever the interface is present but has lost its IP,
unless the printer is online another way or every saved network is switched off. This
is a device-realm resilience task the jinni runs in the background, NOT part of the jinni contract
surface, so it lives on its own next to the jinni class.
"""
import asyncio
import logging
import subprocess
from collections.abc import Callable
from pathlib import Path

from wifi_heal_policy import wifi_heal_wanted
from wifi_persistence import keep_live_wifi, restore_live_network

WIFI_CRED_SRC = Path("/oem/printer_data/gui/wpa_supplicant.conf")
WIFI_CRED_DST = Path("/etc/wpa_supplicant.conf")
WIFI_PERSISTENT_CONFIG = Path("/userdata/cfg/wpa_config.conf")
WLAN_IFACE = "wlan0"
WATCHDOG_INTERVAL_S = 30
IP_TIMEOUT_S = 10
IFUPDOWN_TIMEOUT_S = 60
HEAL_FAILED = "The printer could not check, restore or restart its Wi-Fi, and keeps trying: %s"
HEAL_WORKS_AGAIN = "The printer can check and restart its Wi-Fi again."
KEEP_FAILED = (
    "The printer could not keep its Wi-Fi safe from a firmware update, and keeps trying: %s"
)
KEEP_WORKS_AGAIN = "The printer can keep its Wi-Fi safe from a firmware update again."

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


def _restore_stock_credentials() -> None:
    restore_live_network(WIFI_CRED_SRC, WIFI_CRED_DST, WIFI_PERSISTENT_CONFIG)


def _restart_wlan() -> None:
    # ifdown exits non-zero when wlan0 is already down; ifup says if the restart worked.
    subprocess.run(
        ["ifdown", WLAN_IFACE], capture_output=True, timeout=IFUPDOWN_TIMEOUT_S, check=False,
    )
    subprocess.run(
        ["ifup", WLAN_IFACE], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, timeout=IFUPDOWN_TIMEOUT_S, check=True,
    )


def _restore_wifi() -> None:
    # A failed restore must not stop the restart, which can still connect with the config there.
    # Its error then reaches the round, which logs it once, not every 30 seconds.
    try:
        _restore_stock_credentials()
    finally:
        _restart_wlan()


def _keep_wifi() -> None:
    keep_live_wifi(WIFI_CRED_DST, WIFI_PERSISTENT_CONFIG)


def _check_and_heal() -> None:
    if _wlan_exists() and not wlan_has_ip() and wifi_heal_wanted(WLAN_IFACE, WIFI_CRED_DST):
        _restore_wifi()


def _failure_text(error: BaseException) -> str:
    # A restart that fails after a failed restore carries the restore's error as its context. The
    # restore is why the Wi-Fi cannot come back, so the log names both.
    if error.__context__ is None:
        return str(error)
    return f"{error}, after: {error.__context__}"


def _failure_detail(error: Exception) -> str:
    if isinstance(error, subprocess.CalledProcessError) and error.output:
        return f"{_failure_text(error)} {error.output.strip()}"
    return _failure_text(error)


def _logged_failure(error: Exception, failed_message: str, last_failure: str) -> str:
    """What failed, written to the log unless the last round failed the same way."""
    # The same failure every round would flood the daemon log. ifup's output changes from try to
    # try, so it is logged but does not count as a new failure.
    failure = _failure_text(error)
    if failure != last_failure:
        logger.warning(failed_message, _failure_detail(error))
    return failure


def _guarded_round(
    round_step: Callable[[], None],
    failed_message: str,
    works_again_message: str,
    last_failure: str,
) -> str:
    """One round of a watchdog step. Returns what failed, or nothing when it went fine."""
    # The watchdog runs as a task nobody awaits, so an error raised in a round would end it
    # silently and the Wi-Fi would never be healed again. The next round tries again.
    try:
        round_step()
    except Exception as error:
        return _logged_failure(error, failed_message, last_failure)
    # Warning level: the jinni sets up no logging, and only warnings reach the daemon log.
    if last_failure:
        logger.warning(works_again_message)
    return ""


def _keep_round(last_failure: str) -> str:
    return _guarded_round(_keep_wifi, KEEP_FAILED, KEEP_WORKS_AGAIN, last_failure)


def _heal_round(last_failure: str) -> str:
    return _guarded_round(_check_and_heal, HEAL_FAILED, HEAL_WORKS_AGAIN, last_failure)


async def wifi_watchdog() -> None:
    last_keep_failure = ""
    last_heal_failure = ""
    while True:
        # Each step logs its own failure, so a failed restart never hides a failed keep. The keep
        # goes first, so the restore finds the live config linked to the kept network.
        last_keep_failure = await asyncio.to_thread(_keep_round, last_keep_failure)
        last_heal_failure = await asyncio.to_thread(_heal_round, last_heal_failure)
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
