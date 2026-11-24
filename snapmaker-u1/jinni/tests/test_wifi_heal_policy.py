# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path

import pytest
import wifi_heal_policy

WLAN = "wlan0"
WIRED_ROUTE = "default via 192.0.2.1 dev eth0 proto dhcp src 192.0.2.6 metric 1002\n"
WIFI_ROUTE = "default via 192.0.2.1 dev wlan0 proto dhcp src 192.0.2.7 metric 3004\n"


def _print_default_routes(monkeypatch: pytest.MonkeyPatch, tools_dir: Path, routes: str) -> None:
    """Puts a stand-in for ip first on PATH, printing the given default routes."""
    (tools_dir / "ip").write_text(f"#!/bin/sh\nprintf '%s' '{routes}'\n")
    (tools_dir / "ip").chmod(0o755)
    monkeypatch.setenv("PATH", str(tools_dir))


def _config(tmp_path: Path, content: str) -> Path:
    live_config = tmp_path / "live.conf"
    live_config.write_text(content)
    return live_config


@pytest.mark.parametrize(
    ("routes", "online"),
    [
        (WIRED_ROUTE, True),
        (WIFI_ROUTE + WIRED_ROUTE, True),
        (WIFI_ROUTE, False),
        ("", False),
    ],
    ids=["wired", "wired-and-wifi", "wifi-only", "no-route"],
)
def test_online_without_the_wifi_only_counts_other_interfaces(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, routes: str, online: bool,
) -> None:
    _print_default_routes(monkeypatch, tmp_path, routes)
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
    ],
    ids=["one-off", "all-off", "one-on", "one-of-two-on", "disabled-0", "no-network"],
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
    _print_default_routes(monkeypatch, tmp_path, "")
    assert wifi_heal_policy.wifi_heal_wanted(WLAN, switched_on) is True
    _print_default_routes(monkeypatch, tmp_path, WIRED_ROUTE)
    assert wifi_heal_policy.wifi_heal_wanted(WLAN, switched_on) is False
