# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path

import pytest
import wifi_heal_policy
from default_routes import (
    UNPLUGGED_WIRED_ROUTE,
    UNREACHABLE_IPV6_ROUTE,
    WIFI_IPV6_ROUTE,
    WIFI_ROUTE,
    WIRED_IPV6_ROUTE,
    WIRED_ROUTE,
    print_default_routes,
)

WLAN = "wlan0"


def _config(tmp_path: Path, content: str) -> Path:
    live_config = tmp_path / "live.conf"
    live_config.write_text(content)
    return live_config


@pytest.mark.parametrize(
    ("ipv4_routes", "ipv6_routes", "online"),
    [
        (WIRED_ROUTE, "", True),
        (WIFI_ROUTE + WIRED_ROUTE, "", True),
        (WIFI_ROUTE, "", False),
        ("", "", False),
        ("", WIRED_IPV6_ROUTE, True),
        (WIFI_ROUTE, WIFI_IPV6_ROUTE + WIRED_IPV6_ROUTE, True),
        ("", WIFI_IPV6_ROUTE, False),
        (UNPLUGGED_WIRED_ROUTE, "", False),
        ("", UNREACHABLE_IPV6_ROUTE, False),
    ],
    ids=[
        "wired", "wired-and-wifi", "wifi-only", "no-route",
        "wired-ipv6-only", "wired-ipv6-and-wifi", "wifi-ipv6-only",
        "cable-pulled", "unreachable-ipv6",
    ],
)
def test_online_without_the_wifi_only_counts_other_interfaces(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    ipv4_routes: str,
    ipv6_routes: str,
    online: bool,
) -> None:
    print_default_routes(monkeypatch, tmp_path, ipv4_routes, ipv6_routes)
    assert wifi_heal_policy.online_without(WLAN) is online


def _saved_network(ssid: str, *settings: str) -> str:
    """A network block as wpa_supplicant writes it, with the given extra settings."""
    lines = [f'\tssid="{ssid}"', *(f"\t{setting}" for setting in settings)]
    return "network={\n" + "\n".join(lines) + "\n}\n"


@pytest.mark.parametrize(
    ("content", "switched_off"),
    [
        (_saved_network("home", "priority=1", "disabled=1"), True),
        (_saved_network("home", "disabled=1") + _saved_network("away", "disabled=1"), True),
        (_saved_network("home", "priority=1"), False),
        (_saved_network("home", "disabled=1") + _saved_network("away"), False),
        (_saved_network("home", "disabled=0"), False),
        ("ctrl_interface=/var/run/wpa_supplicant\n", False),
        (_saved_network("lab}net", 'psk="pass}word"', "disabled=1"), True),
        (_saved_network("lab}net", 'psk="pass}word"', "priority=1"), False),
    ],
    ids=[
        "one-off", "all-off", "one-on", "one-of-two-on", "disabled-0", "no-network",
        "brace-in-name-off", "brace-in-name-on",
    ],
)
def test_every_network_disabled_needs_each_saved_network_off(
    tmp_path: Path, content: str, switched_off: bool,
) -> None:
    assert wifi_heal_policy.every_network_disabled(_config(tmp_path, content)) is switched_off


def test_an_unreadable_config_does_not_stop_a_heal(tmp_path: Path) -> None:
    assert wifi_heal_policy.every_network_disabled(tmp_path / "missing.conf") is False


def test_a_heal_is_wanted_only_offline_with_a_network_to_join(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    switched_on = _config(tmp_path, _saved_network("home"))
    print_default_routes(monkeypatch, tmp_path, "")
    assert wifi_heal_policy.wifi_heal_wanted(WLAN, switched_on) is True
    print_default_routes(monkeypatch, tmp_path, WIRED_ROUTE)
    assert wifi_heal_policy.wifi_heal_wanted(WLAN, switched_on) is False
