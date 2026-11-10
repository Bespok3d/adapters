# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import asyncio
import logging
from collections.abc import Callable
from functools import partial
from pathlib import Path

import pytest
import wifi_persistence
import wifi_watchdog

SCREEN_NETWORK = 'network={ ssid="old-lan" }'
KEPT_NETWORK = 'network={ ssid="home" }'


# The watchdog's real configs are this machine's own, so no test may reach them.
@pytest.fixture(autouse=True)
def _no_real_wifi_config(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_SRC", tmp_path / "unused-screen.conf")
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_DST", tmp_path / "unused-live.conf")
    monkeypatch.setattr(wifi_watchdog, "WIFI_PERSISTENT_CONFIG", tmp_path / "unused-kept.conf")


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
    assert kept_network.stat().st_mode & 0o777 == wifi_persistence.NEW_CONFIG_MODE
    assert live_config.is_symlink()


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
    assert live_config.is_symlink()


# The bug: the restore rewrote the config in place, so a power cut could leave it half written.
# A config renamed into place is a new file: a power cut leaves the old one or the new, never half.
def test_the_restore_puts_the_screen_copy_in_place_whole(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    live_config.write_text("ctrl_interface=/var/run/wpa_supplicant")
    first_config = live_config.stat().st_ino
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert live_config.read_text() == SCREEN_NETWORK
    assert live_config.stat().st_ino != first_config
    assert {entry.name for entry in tmp_path.iterdir()} == {screen_copy.name, live_config.name}


def test_copies_a_network_name_that_is_not_utf8(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_bytes(b'network={ ssid="caf\xe9" }')
    _point_at(monkeypatch, screen_copy, live_config)
    wifi_watchdog._restore_stock_credentials()
    assert live_config.read_bytes() == b'network={ ssid="caf\xe9" }'
    assert live_config.stat().st_mode & 0o777 == wifi_persistence.NEW_CONFIG_MODE


def test_a_live_config_that_links_to_itself_fails_as_a_file_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    live_config = tmp_path / "live.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    live_config.symlink_to(live_config)
    _point_at(monkeypatch, screen_copy, live_config)
    with pytest.raises(OSError):
        wifi_watchdog._restore_stock_credentials()


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
    assert "The printer could not check, restore or restart its Wi-Fi" in caplog.text


def _lose_the_ip(monkeypatch: pytest.MonkeyPatch, tools_dir: Path) -> None:
    monkeypatch.setenv("PATH", str(tools_dir))
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: True)
    monkeypatch.setattr(wifi_watchdog, "wlan_has_ip", lambda: False)


def _install_wlan_tools(tools_dir: Path, ifup_script: str) -> None:
    """Stand-ins for ifdown, which always works, and ifup, which runs the given script."""
    (tools_dir / "ifdown").write_text("#!/bin/sh\nexit 0\n")
    (tools_dir / "ifup").write_text(f"#!/bin/sh\n{ifup_script}\n")
    (tools_dir / "ifdown").chmod(0o755)
    (tools_dir / "ifup").chmod(0o755)


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
    _install_wlan_tools(tmp_path, 'echo "no wpa_supplicant $$" >&2\nexit 1')
    _lose_the_ip(monkeypatch, tmp_path)
    assert "ifup" in _heal_twice(caplog)
    assert len(caplog.records) == 1
    assert "no wpa_supplicant" in caplog.text


# The bug: a restore that kept failing logged the same failure every 30 seconds.
def test_a_failed_restore_still_restarts_the_wifi_and_logs_once(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    restarted = tmp_path / "restarted"
    screen_copy.write_text(SCREEN_NETWORK)
    _point_at(monkeypatch, screen_copy, tmp_path / "missing-dir" / "live.conf")
    _install_wlan_tools(tmp_path, f": > {restarted}")
    _lose_the_ip(monkeypatch, tmp_path)
    assert "live.conf" in _heal_twice(caplog)
    assert restarted.exists()
    assert len(caplog.records) == 1
    assert "could not check, restore or restart its Wi-Fi" in caplog.text


# The bug: a restart that failed too hid why the restore failed.
def test_a_failed_restore_and_restart_log_both_failures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    _point_at(monkeypatch, screen_copy, tmp_path / "missing-dir" / "live.conf")
    _install_wlan_tools(tmp_path, 'echo "no wpa_supplicant $$" >&2\nexit 1')
    _lose_the_ip(monkeypatch, tmp_path)
    failure = _heal_twice(caplog)
    assert "ifup" in failure
    assert "live.conf" in failure
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


SCREEN_SAVED_CONFIG = 'ctrl_interface=/var/run/wpa_supplicant\nnetwork={ ssid="new-lan" }\n'


def _wifi_configs(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> tuple[Path, Path]:
    """The live and the persistent Wi-Fi config, on a printer whose wlan0 is missing."""
    live_config = tmp_path / "wpa_supplicant.conf"
    persistent_config = tmp_path / "wpa_config.conf"
    monkeypatch.setattr(wifi_watchdog, "WIFI_CRED_DST", live_config)
    monkeypatch.setattr(wifi_watchdog, "WIFI_PERSISTENT_CONFIG", persistent_config)
    monkeypatch.setattr(wifi_watchdog, "_wlan_exists", lambda: False)
    return live_config, persistent_config


# The bug: the screen's wpa_supplicant saved by renaming a new file over the link, so later Wi-Fi
# changes stayed in the overlay and were lost on a firmware update.
def test_puts_the_link_back_after_the_screen_replaced_it(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    wifi_watchdog._keep_wifi()
    assert persistent_config.read_text() == SCREEN_SAVED_CONFIG
    assert live_config.is_symlink()
    assert live_config.readlink() == persistent_config
    config_names = {entry.name for entry in tmp_path.iterdir()}
    assert config_names == {live_config.name, persistent_config.name}


def test_leaves_a_live_config_that_still_links(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.symlink_to(persistent_config)
    wifi_watchdog._keep_wifi()
    assert persistent_config.read_text() == KEPT_NETWORK
    assert live_config.readlink() == persistent_config


def test_leaves_a_live_config_without_a_network(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text("ctrl_interface=/var/run/wpa_supplicant\n")
    wifi_watchdog._keep_wifi()
    assert persistent_config.read_text() == KEPT_NETWORK
    assert not live_config.is_symlink()


def test_leaves_a_printer_that_never_set_up_the_persistent_config(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    wifi_watchdog._keep_wifi()
    assert not persistent_config.exists()
    assert live_config.read_text() == SCREEN_SAVED_CONFIG


def _staging_of(config: Path) -> Path:
    return config.with_name(config.name + wifi_persistence.STAGING_SUFFIX)


def _block_the_staging(config: Path) -> None:
    """A directory where the config's new copy or link is staged cannot be cleared: it fails."""
    _staging_of(config).mkdir()


async def _stop_the_watchdog(_seconds: float) -> None:
    raise _WatchdogStopped


# The bug: a failed restart replaced the failed keep's error, so the log never said the Wi-Fi
# was not kept.
def test_logs_a_failed_keep_even_when_the_restart_fails_too(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path / "configs")
    live_config.parent.mkdir()
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    _block_the_staging(persistent_config)
    _lose_the_ip(monkeypatch, tmp_path)
    monkeypatch.setattr(wifi_watchdog.asyncio, "sleep", _stop_the_watchdog)
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"), pytest.raises(_WatchdogStopped):
        asyncio.run(wifi_watchdog.wifi_watchdog())
    assert "could not keep its Wi-Fi safe from a firmware update" in caplog.text
    assert "could not check, restore or restart its Wi-Fi" in caplog.text
    assert persistent_config.read_text() == KEPT_NETWORK


def _point_restore_at(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, live_config: Path, persistent_config: Path,
) -> None:
    screen_copy = tmp_path / "gui.conf"
    screen_copy.write_text(SCREEN_NETWORK)
    _point_at(monkeypatch, screen_copy, live_config)
    monkeypatch.setattr(wifi_watchdog, "WIFI_PERSISTENT_CONFIG", persistent_config)


# The bug: the restore put the screen's copy in a live config without a network, and the next
# round saved it over the kept network.
def test_the_restore_links_back_to_the_kept_network(tmp_path: Path) -> None:
    live_config = tmp_path / "wpa_supplicant.conf"
    persistent_config = tmp_path / "wpa_config.conf"
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text("ctrl_interface=/var/run/wpa_supplicant\n")
    with pytest.MonkeyPatch.context() as monkeypatch:
        _point_restore_at(monkeypatch, tmp_path, live_config, persistent_config)
        wifi_watchdog._restore_stock_credentials()
    wifi_persistence.keep_live_wifi(live_config, persistent_config)
    assert persistent_config.read_text() == KEPT_NETWORK
    assert live_config.readlink() == persistent_config


# The bug: with the link not back and no IP, the restore overwrote the network just saved on the
# screen with the screen app's older copy.
def test_the_restore_leaves_a_new_network_the_link_could_not_keep(tmp_path: Path) -> None:
    live_config = tmp_path / "wpa_supplicant.conf"
    persistent_config = tmp_path / "wpa_config.conf"
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    _block_the_staging(persistent_config)
    with pytest.raises(OSError):
        wifi_persistence.keep_live_wifi(live_config, persistent_config)
    with pytest.MonkeyPatch.context() as monkeypatch:
        _point_restore_at(monkeypatch, tmp_path, live_config, persistent_config)
        wifi_watchdog._restore_stock_credentials()
    assert live_config.read_text() == SCREEN_SAVED_CONFIG
    assert persistent_config.read_text() == KEPT_NETWORK


NEWER_SAVED_CONFIG = 'network={ ssid="newer-lan" }\n'


def _copy_then_save(
    copy_live_config: Callable[[Path, bytes], None],
    live_config: Path,
    config: Path,
    content: bytes,
) -> None:
    copy_live_config(config, content)
    newer_save = live_config.with_name(live_config.name + ".tmp")
    newer_save.write_text(NEWER_SAVED_CONFIG)
    newer_save.replace(live_config)


def _save_during_the_copy(monkeypatch: pytest.MonkeyPatch, live_config: Path) -> None:
    """wpa_supplicant saves again while the watchdog copies the live config to /userdata."""
    copy_then_save = partial(_copy_then_save, wifi_persistence._replace_file, live_config)
    monkeypatch.setattr(wifi_persistence, "_replace_file", copy_then_save)


# The bug: a save between the read and the link swap vanished under the link.
def test_keeps_a_save_that_lands_during_the_copy(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    _save_during_the_copy(monkeypatch, live_config)
    wifi_watchdog._keep_wifi()
    assert live_config.read_text() == NEWER_SAVED_CONFIG
    assert not live_config.is_symlink()
    monkeypatch.undo()
    wifi_persistence.keep_live_wifi(live_config, persistent_config)
    assert persistent_config.read_text() == NEWER_SAVED_CONFIG
    assert live_config.readlink() == persistent_config


def _record_owner(
    given_owners: list[tuple[int, int]], _fd: int, owner_id: int, group_id: int,
) -> None:
    given_owners.append((owner_id, group_id))


def test_the_kept_copy_keeps_its_permissions(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    persistent_config.chmod(0o600)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    kept_owner = (persistent_config.stat().st_uid, persistent_config.stat().st_gid)
    # The test user already owns the file, so only the call itself shows the owner is carried over.
    given_owners: list[tuple[int, int]] = []
    monkeypatch.setattr(wifi_persistence.os, "fchown", partial(_record_owner, given_owners))
    wifi_watchdog._keep_wifi()
    assert persistent_config.stat().st_mode & 0o777 == 0o600
    assert given_owners == [kept_owner]


# The bug: a link that kept failing rewrote /userdata every round, wearing the storage.
def test_a_failing_link_does_not_rewrite_the_kept_copy_every_round(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    _block_the_staging(live_config)
    with pytest.raises(OSError):
        wifi_watchdog._keep_wifi()
    first_copy = persistent_config.stat().st_ino
    with pytest.raises(OSError):
        wifi_watchdog._keep_wifi()
    assert persistent_config.stat().st_ino == first_copy
    assert persistent_config.read_text() == SCREEN_SAVED_CONFIG


def test_a_failing_keep_logs_once_and_says_when_it_works_again(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    live_config, persistent_config = _wifi_configs(monkeypatch, tmp_path)
    persistent_config.write_text(KEPT_NETWORK)
    live_config.write_text(SCREEN_SAVED_CONFIG)
    _block_the_staging(live_config)
    with caplog.at_level(logging.WARNING, logger="wifi_watchdog"):
        first_failure = wifi_watchdog._keep_round("")
        second_failure = wifi_watchdog._keep_round(first_failure)
        _staging_of(live_config).rmdir()
        assert wifi_watchdog._keep_round(second_failure) == ""
    assert len(caplog.records) == 2
    assert "could not keep its Wi-Fi safe from a firmware update" in caplog.messages[0]
    assert caplog.messages[1] == wifi_watchdog.KEEP_WORKS_AGAIN
    assert live_config.readlink() == persistent_config


# Enrollment sets the link up from the client's paths; the watchdog must heal the same ones.
def test_heals_the_paths_enrollment_links(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.undo()
    client_paths_file = Path(__file__).resolve().parents[2] / "client" / "wifi-persistence.ts"
    client_paths = client_paths_file.read_text()
    assert f"WIFI_LIVE_CONFIG = '{wifi_watchdog.WIFI_CRED_DST}'" in client_paths
    assert f"WIFI_PERSISTENT_CONFIG = '{wifi_watchdog.WIFI_PERSISTENT_CONFIG}'" in client_paths
    assert f"WIFI_SCREEN_COPY = '{wifi_watchdog.WIFI_CRED_SRC}'" in client_paths
