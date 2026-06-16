"""The jinni reads its OWN service logs and pulls failure signals out of them (ADR-0037).

This is where the daemon's old log parsing moved: which config section / import / file a failure
names, plus the user-facing tail. The daemon then maps an identifier to a plugin; it never reads
this log itself.
"""
from pathlib import Path

from jinni.log_signals import read_failure_signals


def _write(path: Path, text: str) -> Path:
    path.write_text(text)
    return path


def test_reads_a_failing_config_section(tmp_path: Path) -> None:
    klipper = _write(tmp_path / "klippy.log",
                     "Section 'temperature_sensor Rockchip' is not a valid config section")
    signals = read_failure_signals(str(klipper), "")
    assert signals.sections == ("temperature_sensor Rockchip",)


def test_reads_a_failing_import_module(tmp_path: Path) -> None:
    moonraker = _write(tmp_path / "moonraker.log",
                       "ModuleNotFoundError: No module named 'humanize'")
    signals = read_failure_signals("", str(moonraker))
    assert signals.modules == ("humanize",)


def test_reads_a_traceback_file_and_the_user_tail(tmp_path: Path) -> None:
    extra = "/home/lava/klipper/klippy/extras/print_time_human.py"
    klipper = _write(tmp_path / "klippy.log",
                     f'Traceback (most recent call last):\n  File "{extra}", line 3\n    boom')
    signals = read_failure_signals(str(klipper), "")
    assert signals.files == (extra,)
    assert "Klipper log" in signals.log_tails


def test_no_log_yields_empty_signals() -> None:
    signals = read_failure_signals("", "")
    assert signals.sections == () and signals.modules == () and signals.files == ()
    assert signals.log_tails == ""
