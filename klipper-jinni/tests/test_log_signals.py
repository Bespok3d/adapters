# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni reads its OWN service logs and pulls failure signals out of them (ADR-0037).

This is where the daemon's old log parsing moved: which config section / import / file a failure
names, plus the user-facing tail. The daemon then maps an identifier to a plugin; it never reads
this log itself.
"""
from pathlib import Path

from jinni.klipper_vocab import KLIPPER_SERVICE, MOONRAKER_SERVICE
from jinni.live_logs import HELD_OPEN, LiveLog
from jinni.log_signals import read_failure_signals

_KLIPPER_FAILED = frozenset({KLIPPER_SERVICE})
_MOONRAKER_FAILED = frozenset({MOONRAKER_SERVICE})
_BOTH_FAILED = _KLIPPER_FAILED | _MOONRAKER_FAILED


def _live_log(path: Path, text: str) -> LiveLog:
    path.write_text(text)
    return LiveLog(path, HELD_OPEN)


def test_reads_a_failing_config_section(tmp_path: Path) -> None:
    klipper = _live_log(tmp_path / "klippy.log",
                        "Section 'temperature_sensor Rockchip' is not a valid config section")
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.sections == ("temperature_sensor Rockchip",)


def test_reads_a_failing_import_module(tmp_path: Path) -> None:
    moonraker = _live_log(tmp_path / "moonraker.log",
                          "ModuleNotFoundError: No module named 'humanize'")
    signals = read_failure_signals(None, moonraker, "", _MOONRAKER_FAILED)
    assert signals.modules == ("humanize",)


def test_reads_a_traceback_file_and_the_user_tail(tmp_path: Path) -> None:
    extra = "/home/lava/klipper/klippy/extras/print_time_human.py"
    klipper = _live_log(tmp_path / "klippy.log",
                        f'Traceback (most recent call last):\n  File "{extra}", line 3\n    boom')
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.files == (extra,)
    assert f"--- Klipper log: {klipper.path} ({HELD_OPEN}) ---" in signals.log_tails


def test_the_state_message_beats_an_older_error_in_the_log(tmp_path: Path) -> None:
    # Junior: the log tail still held an old error for another section; Klipper's state message
    # names the one that halted it now, and only the first section found is attributed.
    klipper = _live_log(tmp_path / "klippy.log",
                        "Section 'old_dead_section' is not a valid config section")
    signals = read_failure_signals(klipper, None, "Section 'afc' is not a valid config section",
                                   _KLIPPER_FAILED)
    assert signals.sections == ("afc",)
    assert signals.log_tails.startswith("--- Klipper state ---\nSection 'afc'")


def test_an_error_from_an_earlier_klipper_run_is_not_blamed(tmp_path: Path) -> None:
    # The old error was fixed and Klipper restarted; this run halted with no section named.
    klipper = _live_log(tmp_path / "klippy.log", (
        "Section 'old_dead_section' is not a valid config section\n"
        "Start printer at Mon Nov  9 10:00:00 2026 (1.0 2.0)\n"
        "mcu 'mcu': Unable to connect"))
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.sections == ()
    assert "old_dead_section" in signals.log_tails


def test_klipper_traceback_file_beats_an_older_moonraker_one(tmp_path: Path) -> None:
    klipper_extra = "/home/lava/klipper/klippy/extras/broken_extra.py"
    moonraker_component = "/home/lava/moonraker/moonraker/components/old_component.py"
    klipper = _live_log(tmp_path / "klippy.log", f'File "{klipper_extra}", line 3')
    moonraker = _live_log(tmp_path / "moonraker.log", f'File "{moonraker_component}", line 9')
    signals = read_failure_signals(klipper, moonraker, "", _BOTH_FAILED)
    assert signals.files == (klipper_extra,)


def test_no_log_yields_empty_signals() -> None:
    signals = read_failure_signals(None, None, "", _BOTH_FAILED)
    assert signals.sections == () and signals.modules == () and signals.files == ()
    assert signals.log_tails == ""


def test_a_healthy_klipper_log_is_not_blamed_for_a_moonraker_failure(tmp_path: Path) -> None:
    # A G-code error left a plugin traceback in the running Klipper's log; Moonraker is what broke.
    klipper = _live_log(tmp_path / "klippy.log",
                        'File "/home/lava/klipper/klippy/extras/some_extra.py", line 3')
    moonraker = _live_log(tmp_path / "moonraker.log",
                          "ModuleNotFoundError: No module named 'humanize'")
    signals = read_failure_signals(klipper, moonraker, "", _MOONRAKER_FAILED)
    assert signals.files == ()
    assert signals.modules == ("humanize",)
    assert "some_extra.py" in signals.log_tails


def test_an_error_from_an_earlier_moonraker_run_is_not_blamed(tmp_path: Path) -> None:
    moonraker = _live_log(tmp_path / "moonraker.log", (
        "ModuleNotFoundError: No module named 'removed_component'\n"
        "-------------------- Log Start | Mon Nov  9 10:00:00 2026 --------------------\n"
        "Unable to bind to port 7125"))
    signals = read_failure_signals(None, moonraker, "", _MOONRAKER_FAILED)
    assert signals.modules == ()


_PLUGIN_EXTRA = "/home/lava/klipper/klippy/extras/afc.py"
_KLIPPER_CORE = "/home/lava/klipper/klippy/configfile.py"
_KLIPPY = "/home/lava/klipper/klippy/klippy.py"


def _traceback(*frame_files: str) -> str:
    frames = "".join(f'  File "{frame_file}", line 7, in load\n' for frame_file in frame_files)
    return f"Traceback (most recent call last):\n{frames}Exception: boom\n"


def test_a_core_file_raising_for_a_plugin_still_names_the_plugin(tmp_path: Path) -> None:
    klipper = _live_log(tmp_path / "klippy.log", _traceback(_KLIPPY, _PLUGIN_EXTRA, _KLIPPER_CORE))
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.files == (_KLIPPER_CORE, _PLUGIN_EXTRA, _KLIPPY)


def test_an_earlier_traceback_the_service_survived_is_not_blamed(tmp_path: Path) -> None:
    survived = "/home/lava/klipper/klippy/extras/survived.py"
    klipper = _live_log(tmp_path / "klippy.log",
                        _traceback(survived) + "still running\n" + _traceback(_PLUGIN_EXTRA))
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.files == (_PLUGIN_EXTRA,)


def test_a_chained_traceback_keeps_the_files_of_the_exception_it_grew_from(
        tmp_path: Path) -> None:
    chained = (_traceback(_PLUGIN_EXTRA)
               + "\nDuring handling of the above exception, another exception occurred:\n\n"
               + _traceback(_KLIPPY, _KLIPPER_CORE))
    klipper = _live_log(tmp_path / "klippy.log", chained)
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.files == (_KLIPPER_CORE, _KLIPPY, _PLUGIN_EXTRA)


def test_a_cause_raised_from_keeps_the_files_of_the_exception_it_wraps(tmp_path: Path) -> None:
    wrapped = (_traceback(_PLUGIN_EXTRA)
               + "\nThe above exception was the direct cause of the following exception:\n\n"
               + _traceback(_KLIPPY, _KLIPPER_CORE))
    klipper = _live_log(tmp_path / "klippy.log", wrapped)
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert signals.files == (_KLIPPER_CORE, _KLIPPY, _PLUGIN_EXTRA)


def test_every_member_of_an_exception_group_keeps_its_files(tmp_path: Path) -> None:
    group = ("  + Exception Group Traceback (most recent call last):\n"
             f'  |   File "{_KLIPPY}", line 7, in run\n'
             "  | ExceptionGroup: unhandled errors (2 sub-exceptions)\n"
             "  +-+---------------- 1 ----------------\n"
             "    | Traceback (most recent call last):\n"
             f'    |   File "{_PLUGIN_EXTRA}", line 7, in load\n'
             "    +---------------- 2 ----------------\n"
             "    | Traceback (most recent call last):\n"
             f'    |   File "{_KLIPPER_CORE}", line 7, in load\n')
    klipper = _live_log(tmp_path / "klippy.log", group)
    signals = read_failure_signals(klipper, None, "", _KLIPPER_FAILED)
    assert _PLUGIN_EXTRA in signals.files
