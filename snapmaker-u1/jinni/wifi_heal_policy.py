# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Whether the U1 wants its Wi-Fi healed at all.

The watchdog restores the Wi-Fi config and restarts wlan0 whenever wlan0 has no IP. On a printer
that is online another way, through an Ethernet adapter say, or whose every saved network was
switched off on purpose, that restart cannot help and is repeated every round: wlan0 went down and
up every 30 seconds for as long as the printer ran, and the stock cloud service dropped its
connection each time. So in both cases the watchdog leaves the Wi-Fi alone.
"""
import re
import subprocess
from pathlib import Path

ROUTE_TIMEOUT_S = 10
ROUTE_DEVICE = re.compile(r"\bdev (\S+)")
# Read as bytes, like wifi_persistence: a network name need not be valid UTF-8.
SAVED_NETWORK_BLOCK = re.compile(rb"network\s*=\s*\{(.*?)\}", re.DOTALL)
DISABLED_SETTING = re.compile(rb"^\s*disabled\s*=\s*1\s*$", re.MULTILINE)


def _default_route_devices() -> list[str]:
    result = subprocess.run(
        ["ip", "-4", "route", "show", "default"],
        capture_output=True, text=True, timeout=ROUTE_TIMEOUT_S, check=False,
    )
    return ROUTE_DEVICE.findall(result.stdout)


def online_without(wlan_iface: str) -> bool:
    """The printer has a default route through an interface other than its Wi-Fi."""
    return any(device != wlan_iface for device in _default_route_devices())


def every_network_disabled(live_config: Path) -> bool:
    """The config saves at least one network, and every one of them is switched off."""
    # An unreadable config says nothing about what the owner wants, so it never stops a heal.
    try:
        config = live_config.read_bytes()
    except OSError:
        return False
    saved_networks = SAVED_NETWORK_BLOCK.findall(config)
    return bool(saved_networks) and all(
        DISABLED_SETTING.search(saved_network) for saved_network in saved_networks
    )


def wifi_heal_wanted(wlan_iface: str, live_config: Path) -> bool:
    """The Wi-Fi is worth restoring and restarting: nothing else connects the printer, and the
    owner has not switched off every network it could join."""
    return not online_without(wlan_iface) and not every_network_disabled(live_config)
