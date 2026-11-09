# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1's wifi self-heal watchdog.

A background loop that restores the stock wifi credentials and bounces wlan0 whenever the interface
is present but has lost its IP. This is a device-realm resilience task the jinni runs in the
background, NOT part of the jinni contract surface, so it lives on its own next to the jinni class.
"""
import asyncio
import logging
import subprocess
from pathlib import Path

WIFI_CRED_SRC = Path("/oem/printer_data/gui/wpa_supplicant.conf")
WIFI_CRED_DST = Path("/etc/wpa_supplicant.conf")
WLAN_IFACE = "wlan0"
WATCHDOG_INTERVAL_S = 30
SAVED_NETWORK_MARK = b"network="
COPY_FAILED = (
    "The printer could not put the Wi-Fi saved on its screen in use,"
    " so its Wi-Fi may not come back: %s"
)

logger = logging.getLogger(__name__)


def _wlan_exists() -> bool:
    result = subprocess.run(["ip", "link", "show", WLAN_IFACE], capture_output=True, check=False)
    return result.returncode == 0


def _wlan_has_ip() -> bool:
    result = subprocess.run(
        ["ip", "-4", "addr", "show", WLAN_IFACE], capture_output=True, text=True, check=False,
    )
    return "inet " in result.stdout


# Read as bytes: a network name need not be valid UTF-8, and decoding it could fail.
def _saved_network(config: Path) -> bytes:
    """The config as it is when it holds a saved network, else nothing."""
    if not config.is_file():
        return b""
    content = config.read_bytes()
    return content if SAVED_NETWORK_MARK in content else b""


def _saved_network_kept(live_config: Path) -> bool:
    """A printer enrolled before keeps its network in /userdata, and the live config links there."""
    return live_config.is_symlink() and bool(_saved_network(live_config))


def _copy_screen_wifi(screen_copy: Path, live_config: Path) -> None:
    # Writing through the link would replace the kept network with the screen's copy.
    if _saved_network_kept(live_config):
        return
    screen_wifi = _saved_network(screen_copy)
    if screen_wifi:
        live_config.write_bytes(screen_wifi)


def _restore_stock_credentials() -> None:
    # The watchdog runs as a task nobody awaits, so an error raised here would end it silently.
    try:
        _copy_screen_wifi(WIFI_CRED_SRC, WIFI_CRED_DST)
    except OSError as error:
        logger.warning(COPY_FAILED, error)


def _restore_wifi() -> None:
    _restore_stock_credentials()
    subprocess.run(["ifdown", WLAN_IFACE], capture_output=True, check=False)
    subprocess.run(["ifup", WLAN_IFACE], capture_output=True, check=False)


def _check_and_heal() -> None:
    if _wlan_exists() and not _wlan_has_ip():
        _restore_wifi()


async def wifi_watchdog() -> None:
    while True:
        await asyncio.to_thread(_check_and_heal)
        await asyncio.sleep(WATCHDOG_INTERVAL_S)
