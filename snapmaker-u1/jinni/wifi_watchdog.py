# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1's wifi self-heal watchdog.

A background loop that restores the stock wifi credentials and bounces wlan0 whenever the interface
is present but has lost its IP. This is a device-realm resilience task the jinni runs in the
background, NOT part of the jinni contract surface, so it lives on its own next to the jinni class.
"""
import asyncio
import subprocess
from pathlib import Path

WIFI_CRED_SRC = Path("/oem/printer_data/gui/wpa_supplicant.conf")
WIFI_CRED_DST = Path("/etc/wpa_supplicant.conf")
WLAN_IFACE = "wlan0"
WATCHDOG_INTERVAL_S = 30


def _wlan_exists() -> bool:
    result = subprocess.run(["ip", "link", "show", WLAN_IFACE], capture_output=True, check=False)
    return result.returncode == 0


def _wlan_has_ip() -> bool:
    result = subprocess.run(
        ["ip", "-4", "addr", "show", WLAN_IFACE], capture_output=True, text=True, check=False,
    )
    return "inet " in result.stdout


def _restore_stock_credentials() -> None:
    if not WIFI_CRED_SRC.exists():
        return
    stock = WIFI_CRED_SRC.read_text()
    if "network=" in stock:
        WIFI_CRED_DST.write_text(stock)


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
