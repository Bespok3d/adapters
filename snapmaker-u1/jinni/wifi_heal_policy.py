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
# Only a plain default route that still has its link leads anywhere: an unreachable or blackhole
# default starts with its type instead, and a cable pulled out leaves its route marked linkdown.
WORKING_DEFAULT_ROUTE = re.compile(r"^default\b(?!.*\blinkdown\b).*?\bdev (\S+)", re.MULTILINE)
# Read as bytes, like wifi_persistence: a network name need not be valid UTF-8. wpa_supplicant
# ends a network block only at a line holding just "}", so a "}" in a quoted name or password
# does not end it.
SAVED_NETWORK_BLOCK = re.compile(
    rb"^\s*network\s*=\s*\{\s*$(.*?)^\s*\}\s*$", re.DOTALL | re.MULTILINE,
)
DISABLED_SETTING = re.compile(rb"^\s*disabled\s*=\s*1\s*$", re.MULTILINE)


def _default_route_devices(address_family: str) -> list[str]:
    result = subprocess.run(
        ["ip", address_family, "route", "show", "default"],
        capture_output=True, text=True, timeout=ROUTE_TIMEOUT_S, check=False,
    )
    return WORKING_DEFAULT_ROUTE.findall(result.stdout)


def online_without(wlan_iface: str) -> bool:
    """The printer has an IPv4 or IPv6 default route through an interface other than its Wi-Fi."""
    devices = _default_route_devices("-4") + _default_route_devices("-6")
    return any(device != wlan_iface for device in devices)


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
