# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import logging
from pathlib import Path

import pytest
import wifi_watchdog

SCREEN_NETWORK = 'network={ ssid="old-lan" }'
KEPT_NETWORK = 'network={ ssid="home" }'


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


def _point_at(monkeypatch: pytest.MonkeyPatch, screen_copy: Path, live_config: Path) -> None:
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_SRC", screen_copy)
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_DST", live_config)


# The bug: the restore followed the link and overwrote the kept network with the screen's copy.
def test_keeps_the_saved_network_of_a_printer_enrolled_before(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    kept_network = tmp_path / "wpa_config.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    kept_network.write_text(KEPT_NETWORK)
    live_config.symlink_to(kept_network)
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert kept_network.read_text() == KEPT_NETWORK
    assert live_config.is_symlink()


def test_puts_the_screen_copy_back_when_the_saved_network_is_gone(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    kept_network = tmp_path / "wpa_config.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    live_config.symlink_to(kept_network)
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert kept_network.read_text() == SCREEN_NETWORK


def test_puts_the_screen_copy_back_when_the_kept_file_has_no_network(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    kept_network = tmp_path / "wpa_config.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    kept_network.write_text("ctrl_interface=/var/run/wpa_supplicant")
    live_config.symlink_to(kept_network)
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert kept_network.read_text() == SCREEN_NETWORK


def test_copies_a_network_name_that_is_not_utf8(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_bytes(b'network={ ssid="caf\xe9" }')
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert live_config.read_bytes() == b'network={ ssid="caf\xe9" }'


def _restore_and_log(caplog: pytest.LogCaptureFixture) -> str:
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"):
        wifi_watchdog._restore_stock_credentials()
    return caplog.text


def test_logs_a_plain_message_and_goes_on_when_the_copy_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "missing-dir" / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    _point_at(monkeypatch, screen_copy, live_config)
    assert "could not put the Wi-Fi saved on its screen in use" in _restore_and_log(caplog)
    assert not live_config.exists()


def test_logs_a_plain_message_when_the_live_config_links_to_itself(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    live_config.symlink_to(live_config)
    _point_at(monkeypatch, screen_copy, live_config)
    assert "could not put the Wi-Fi saved on its screen in use" in _restore_and_log(caplog)
