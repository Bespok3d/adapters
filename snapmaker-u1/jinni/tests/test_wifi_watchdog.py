# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import asyncio
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
    monkeypatch.setattr(wifi_watchdog, "wlan_has_ip", lambda: False)
    wifi_watchdog._check_and_heal()
    assert healed == ["heal"]


def test_does_not_heal_when_the_interface_has_an_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    healed = []
    monkeypatch.setattr(wifi_watchdog, "_restore_wifi", lambda: healed.append("heal"))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: True)
    monkeypatch.setattr(wifi_watchdog, "wlan_has_ip", lambda: True)
    wifi_watchdog._check_and_heal()
    assert healed == []


def test_does_not_heal_when_there_is_no_wlan_interface(monkeypatch: pytest.MonkeyPatch) -> None:
    healed = []
    monkeypatch.setattr(wifi_watchdog, "_restore_wifi", lambda: healed.append("heal"))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: False)
    monkeypatch.setattr(wifi_watchdog, "wlan_has_ip", lambda: True)
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


class _WatchdogStopped(BaseException):
    """Ends the endless watchdog loop in a test; the watchdog lets it through like a cancel."""


def _failing_round(rounds: list[str]) -> None:
    if len(rounds) == 2:
        raise _WatchdogStopped
    rounds.append("failed")
    raise FileNotFoundError("ifdown")


# The bug: one failed round ended the watchdog, and the Wi-Fi was never healed again.
def test_logs_a_failed_round_and_tries_again(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    rounds: list[str] = []
    monkeypatch.setattr(wifi_watchdog, "WATCHDOG_INTERVAL_S", 0)
    monkeypatch.setattr(wifi_watchdog, "_check_and_heal", lambda: _failing_round(rounds))
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"), pytest.raises(_WatchdogStopped):
        asyncio.run(wifi_watchdog.wifi_watchdog())
    assert rounds == ["failed", "failed"]
    assert len(caplog.records) == 1
    assert "The printer could not check or restart its Wi-Fi" in caplog.text


def _lose_the_ip(monkeypatch: pytest.MonkeyPatch, tools_dir: Path) -> None:
    monkeypatch.setenv("PATH", str(tools_dir))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: True)
    monkeypatch.setattr(wifi_watchdog, "wlan_has_ip", lambda: False)
    monkeypatch.setattr(wifi_watchdog, "_restore_stock_credentials", lambda: None)


def _heal_twice(caplog: pytest.LogCaptureFixture) -> str:
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"):
        first_failure = wifi_watchdog._heal_round("")
        return wifi_watchdog._heal_round(first_failure)


def test_logs_once_when_ifdown_cannot_start(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    _lose_the_ip(monkeypatch, tmp_path)
    assert "ifdown" in _heal_twice(caplog)
    assert len(caplog.records) == 1


# ifup's output differs from try to try (here its process id), and that is still the same failure.
def test_logs_why_ifup_failed_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    (tmp_path / "ifdown").write_text("#!/bin/sh\nexit 0\n")
    (tmp_path / "ifup").write_text('#!/bin/sh\necho "no wpa_supplicant $$" >&2\nexit 1\n')
    (tmp_path / "ifdown").chmod(0o755)
    (tmp_path / "ifup").chmod(0o755)
    _lose_the_ip(monkeypatch, tmp_path)
    assert "ifup" in _heal_twice(caplog)
    assert len(caplog.records) == 1
    assert "no wpa_supplicant" in caplog.text


def test_a_round_that_works_again_says_so(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(wifi_watchdog, "_check_and_heal", lambda: None)
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"):
        assert wifi_watchdog._heal_round("ifdown not found") == ""
        assert wifi_watchdog._heal_round("") == ""
    assert caplog.messages == [wifi_watchdog.HEAL_WORKS_AGAIN]
