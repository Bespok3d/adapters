# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path

import pytest
import wifi_watchdog


def test_heals_only_when_the_interface_is_up_without_an_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    healed = []
    monkeypatch.setattr(wifi_watchdog, "_restore_wifi", lambda: healed.append("heal"))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: True)
    monkeypatch.setattr(wifi_watchdog, "_wlan_has_ip", lambda: False)
    wifi_watchdog._check_and_heal()
    assert healed == ["heal"]


def test_does_not_heal_when_the_interface_has_an_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    healed = []
    monkeypatch.setattr(wifi_watchdog, "_restore_wifi", lambda: healed.append("heal"))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: True)
    monkeypatch.setattr(wifi_watchdog, "_wlan_has_ip", lambda: True)
    wifi_watchdog._check_and_heal()
    assert healed == []


def test_does_not_heal_when_there_is_no_wlan_interface(monkeypatch: pytest.MonkeyPatch) -> None:
    healed = []
    monkeypatch.setattr(wifi_watchdog, "_restore_wifi", lambda: healed.append("heal"))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: False)
    monkeypatch.setattr(wifi_watchdog, "_wlan_has_ip", lambda: True)
    wifi_watchdog._check_and_heal()
    assert healed == []


def test_restores_stock_credentials_only_for_a_real_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    src = tmp_path / "stock.conf"
    dst = tmp_path / "live.conf"
    src.write_text('network={ ssid="home" }')
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_SRC", src)
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_DST", dst)
    wifi_watchdog._restore_stock_credentials()
    assert dst.read_text() == src.read_text()


def test_skips_restore_when_the_source_has_no_network(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    src = tmp_path / "stock.conf"
    dst = tmp_path / "live.conf"
    src.write_text("# placeholder, no credentials yet")
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_SRC", src)
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_DST", dst)
    wifi_watchdog._restore_stock_credentials()
    assert not dst.exists()
