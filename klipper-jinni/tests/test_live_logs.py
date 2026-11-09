# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni finds the log a running Klipper or Moonraker really writes, never a stale one.

A fake /proc (cmdline + fd symlinks) stands in for the printer's: the running process proves its
live log by holding it open, Klipper's `info` names it as a second proof, and a configured path is
only a fallback when it was written recently, always labelled as such.
"""
from pathlib import Path

import pytest

from jinni import live_logs
from tests.fake_proc import fake_log as _log
from tests.fake_proc import fake_process as _process

MP = pytest.MonkeyPatch

_NOW = 1_000_000.0
_KLIPPY_ARGV = ("/usr/bin/python3", "/home/lava/klipper/klippy/klippy.py", "printer.cfg")
_MOONRAKER_ARGV = ("/usr/bin/python3", "/home/lava/moonraker/moonraker/moonraker.py", "-d", "/data")


def test_a_stale_decoy_next_to_the_live_log_is_ignored(tmp_path: Path) -> None:
    # Junior: the configured klippy.log is dead since a firmware update; the running Klipper writes
    # another one. A just-touched decoy is ignored too, because the running process proves its file.
    decoy = _log(tmp_path / "logs" / "klippy.log", "old error", _NOW)
    live = _log(tmp_path / "klippylogs" / "klippy.log", "current error", _NOW - 3600)
    proc_root = tmp_path / "proc"
    _process(proc_root, 1276, _KLIPPY_ARGV, live)

    found = live_logs.locate_klipper_log({}, str(decoy), proc_root, _NOW)

    assert found == live_logs.LiveLog(live, live_logs.HELD_OPEN)


def test_the_klipper_pid_from_info_picks_its_own_log(tmp_path: Path) -> None:
    this_printer = _log(tmp_path / "printer_one.log", "", _NOW - 60)
    other_printer = _log(tmp_path / "printer_two.log", "", _NOW)
    proc_root = tmp_path / "proc"
    _process(proc_root, 100, _KLIPPY_ARGV, this_printer)
    _process(proc_root, 200, _KLIPPY_ARGV, other_printer)

    found = live_logs.locate_klipper_log({"process_id": 100}, "", proc_root, _NOW)

    assert found is not None and found.path == this_printer


def test_the_service_log_beats_a_newer_plugin_log_held_by_klipper(tmp_path: Path) -> None:
    klipper_log = _log(tmp_path / "klippylogs" / "klippy.log", "", _NOW - 3600)
    plugin_log = _log(tmp_path / "plugin" / "afc.log", "", _NOW)
    proc_root = tmp_path / "proc"
    _process(proc_root, 1276, _KLIPPY_ARGV, plugin_log, klipper_log)

    found = live_logs.locate_klipper_log({}, "/dead/klippy.log", proc_root, _NOW)

    assert found == live_logs.LiveLog(klipper_log, live_logs.HELD_OPEN)


def test_a_relative_log_file_from_klipper_is_not_trusted(tmp_path: Path, monkeypatch: MP) -> None:
    monkeypatch.chdir(tmp_path)
    _log(tmp_path / "klippy.log", "", _NOW)

    found = live_logs.locate_klipper_log({"log_file": "klippy.log"}, "", tmp_path / "no", _NOW)

    assert found is None


def test_klipper_info_names_the_log_when_fds_are_unreadable(tmp_path: Path) -> None:
    live = _log(tmp_path / "klippylogs" / "klippy.log", "", _NOW - 86400)
    info = {"process_id": 1276, "log_file": str(live)}

    found = live_logs.locate_klipper_log(info, "", tmp_path / "no-proc", _NOW)

    assert found == live_logs.LiveLog(live, live_logs.REPORTED_BY_KLIPPER)


def test_the_configured_path_is_used_only_when_freshly_written(tmp_path: Path) -> None:
    fresh = _log(tmp_path / "fresh.log", "", _NOW - 30)
    stale = _log(tmp_path / "stale.log", "", _NOW - live_logs.FRESH_LOG_WINDOW_S - 1)
    no_proc = tmp_path / "no-proc"

    found = live_logs.locate_klipper_log({}, str(fresh), no_proc, _NOW)

    assert found is not None and found.path == fresh
    assert "no running process holds it" in found.origin
    assert live_logs.locate_klipper_log({}, str(stale), no_proc, _NOW) is None


def test_moonraker_log_comes_from_the_running_moonraker(tmp_path: Path) -> None:
    decoy = _log(tmp_path / "printer_data" / "moonraker.log", "", _NOW)
    live = _log(tmp_path / "logs" / "moonraker.log", "", _NOW - 600)
    database = _log(tmp_path / "moonraker.db", "", _NOW)
    proc_root = tmp_path / "proc"
    _process(proc_root, 1291, _MOONRAKER_ARGV, database, live)

    found = live_logs.locate_moonraker_log(str(decoy), proc_root, _NOW)

    assert found == live_logs.LiveLog(live, live_logs.HELD_OPEN)


def test_a_shell_that_mentions_the_script_is_not_the_service(tmp_path: Path) -> None:
    proc_root = tmp_path / "proc"
    _process(proc_root, 5602, ("bash", "-c", "pgrep -f moonraker.py"))
    _process(proc_root, 1291, _MOONRAKER_ARGV)

    assert live_logs.service_pids(live_logs.MOONRAKER_SCRIPTS, proc_root) == (1291,)


def test_a_deleted_log_is_not_held(tmp_path: Path) -> None:
    # /proc shows a file deleted while held open as "<path> (deleted)".
    rotated_away = tmp_path / "klippy.log"
    proc_root = tmp_path / "proc"
    _process(proc_root, 1276, _KLIPPY_ARGV, Path(f"{rotated_away} (deleted)"))

    assert live_logs.held_logs(1276, proc_root) == ()


def test_the_log_klipper_names_wins_among_the_logs_it_holds(tmp_path: Path) -> None:
    # The running Klipper names a log unlike the configured one; a plugin's newer log must not win.
    klipper_log = _log(tmp_path / "klippylogs" / "printer.log", "", _NOW - 3600)
    plugin_log = _log(tmp_path / "plugin" / "afc.log", "", _NOW)
    proc_root = tmp_path / "proc"
    _process(proc_root, 1276, _KLIPPY_ARGV, plugin_log, klipper_log)
    info = {"process_id": 1276, "log_file": str(klipper_log)}

    found = live_logs.locate_klipper_log(info, "/dead/klippy.log", proc_root, _NOW)

    assert found == live_logs.LiveLog(klipper_log, live_logs.HELD_OPEN)


def test_a_log_klipper_names_that_is_gone_is_not_used(tmp_path: Path) -> None:
    fresh = _log(tmp_path / "fresh.log", "", _NOW - 30)
    info = {"log_file": str(tmp_path / "wiped" / "klippy.log")}

    found = live_logs.locate_klipper_log(info, str(fresh), tmp_path / "no-proc", _NOW)

    assert found is not None and found.path == fresh
