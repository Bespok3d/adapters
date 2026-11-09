# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import asyncio
import logging
import time
from datetime import datetime
from pathlib import Path

import pytest
import screen_wifi

BOOT_UPTIME_S = 60.0
FAILED_OPEN_LINE = "{rk_wifi_handler} Open wifi >>>>>>>> ret:-1"
WORKING_OPEN_LINE = "{rk_wifi_handler} Open wifi >>>>>>>> ret:0"
OPEN_START_LINE = "{rk_wifi_handler} Open Wifi >>>>>>>>"


def _gui_log_line(seconds_ago: float, message: str) -> str:
    stamp = datetime.fromtimestamp(time.time() - seconds_ago).strftime("%Y-%m-%d %H:%M:%S.%f")
    return f"{stamp[:-3]} (: 179) <Module RK Wifi> {message}\n"


def _boot_time() -> float:
    return time.time() - BOOT_UPTIME_S


def test_reads_a_failed_open_of_this_boot() -> None:
    gui_log = _gui_log_line(50, FAILED_OPEN_LINE).encode()
    assert screen_wifi.boot_open_result(gui_log, _boot_time()) == "-1"


def test_reads_the_last_open_of_this_boot() -> None:
    gui_log = (_gui_log_line(50, FAILED_OPEN_LINE) + _gui_log_line(10, WORKING_OPEN_LINE)).encode()
    assert screen_wifi.boot_open_result(gui_log, _boot_time()) == "0"


def test_ignores_an_open_from_an_earlier_boot() -> None:
    gui_log = _gui_log_line(3600, FAILED_OPEN_LINE).encode()
    assert screen_wifi.boot_open_result(gui_log, _boot_time()) == ""


def test_ignores_the_line_that_only_starts_the_open() -> None:
    gui_log = _gui_log_line(50, OPEN_START_LINE).encode()
    assert screen_wifi.boot_open_result(gui_log, _boot_time()) == ""


def test_reads_an_open_after_the_nul_bytes_a_power_cut_leaves() -> None:
    gui_log = b"\x00\x00\x00" + _gui_log_line(50, FAILED_OPEN_LINE).encode()
    assert screen_wifi.boot_open_result(gui_log, _boot_time()) == "-1"


def _fake_tool(tools_dir: Path, name: str, script: str) -> None:
    tool = tools_dir / name
    tool.write_text(f"#!/bin/sh\n{script}\n")
    tool.chmod(0o755)


def _boot_with(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, open_line: str, has_ip: bool = True,
) -> Path:
    """A printer BOOT_UPTIME_S into its boot whose screen app logged `open_line`; returns where
    the fake killall records the apps it ended."""
    (tmp_path / "uptime").write_text(f"{BOOT_UPTIME_S} 100.0\n")
    (tmp_path / "gui.log").write_text(_gui_log_line(50, open_line))
    _fake_tool(tmp_path, "pgrep", "exit 0")
    _fake_tool(tmp_path, "killall", f'echo "$1" >> "{tmp_path / "ended"}"')
    monkeypatch.setenv("PATH", str(tmp_path))
    monkeypatch.setattr(screen_wifi, "UPTIME_FILE", tmp_path / "uptime")
    monkeypatch.setattr(screen_wifi, "GUI_LOG", tmp_path / "gui.log")
    monkeypatch.setattr(screen_wifi, "RESTARTED_MARK", tmp_path / "restarted")
    monkeypatch.setattr(screen_wifi, "wlan_has_ip", lambda: has_ip)
    return tmp_path / "ended"


def _idle() -> tuple[bool, str]:
    return False, "standby"


def _printing() -> tuple[bool, str]:
    return True, "printing"


# The bug: the screen showed Wi-Fi off after a boot while the printer was connected.
def test_restarts_the_screen_app_when_its_open_failed_while_connected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    with caplog.at_level(logging.WARNING, logger="screen_wifi"):
        assert screen_wifi.screen_wifi_round(_idle) is True
    assert ended.read_text() == "gui\n"
    assert caplog.messages == [screen_wifi.SCREEN_RESTARTED]


def test_restarts_the_screen_app_once_per_boot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    screen_wifi.screen_wifi_round(_idle)
    assert screen_wifi.screen_wifi_round(_idle) is True
    assert ended.read_text() == "gui\n"


def test_leaves_the_screen_app_alone_when_its_open_worked(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, WORKING_OPEN_LINE)
    assert screen_wifi.screen_wifi_round(_idle) is True
    assert not ended.exists()


def test_waits_while_the_wifi_is_not_connected(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE, has_ip=False)
    assert screen_wifi.screen_wifi_round(_idle) is False
    assert not ended.exists()


def test_waits_while_the_printer_prints(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    assert screen_wifi.screen_wifi_round(_printing) is False
    assert not ended.exists()


def test_waits_while_nothing_would_start_the_screen_app_again(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    _fake_tool(tmp_path, "pgrep", '[ "$2" = lmd ] && exit 1; exit 0')
    assert screen_wifi.screen_wifi_round(_idle) is False
    assert not ended.exists()


def test_waits_while_the_screen_app_is_being_started_again(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    _fake_tool(tmp_path, "pgrep", '[ "$2" = gui ] && exit 1; exit 0')
    assert screen_wifi.screen_wifi_round(_idle) is False
    assert not ended.exists()


def test_waits_until_the_screen_app_opens_wifi(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    (tmp_path / "gui.log").unlink()
    assert screen_wifi.screen_wifi_round(_idle) is False
    assert not ended.exists()


def test_stops_once_the_boot_is_long_past(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    (tmp_path / "uptime").write_text(f"{screen_wifi.BOOT_WINDOW_S + 1} 100.0\n")
    assert screen_wifi.screen_wifi_round(_idle) is True
    assert not ended.exists()


def test_the_check_ends_once_the_round_has_nothing_left_to_do(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    ended = _boot_with(monkeypatch, tmp_path, FAILED_OPEN_LINE)
    monkeypatch.setattr(screen_wifi, "CHECK_INTERVAL_S", 0)
    asyncio.run(screen_wifi.screen_wifi_check(_idle))
    assert ended.read_text() == "gui\n"
