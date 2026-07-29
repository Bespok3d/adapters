# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni reads the kernel's out-of-memory evidence and reports the kill and its victim.

Detection for the constrained-board safety net (ADR-0037): /proc/vmstat's cumulative `oom_kill`
counter gates whether the killer fired, the ring buffer's `Killed process` line names the most
recent victim. The daemon relays the report and prevents nothing. The core-versus-auxiliary verdict
is NOT reported (the victim comm is `python3` for a klipper/moonraker kill, unknowable from text
alone; a follow-up once real hardware exists). Pure logic tested over text; the device-read wiring
is tested by monkeypatching the two reads.
"""
import pytest

from jinni import kernel_log, oom, oom_probe
from jinni.klipper import KLIPPER_PATH_KEYS, KlipperPrinterJinni

MP = pytest.MonkeyPatch


class _PrinterJinni(KlipperPrinterJinni):
    def device_paths(self) -> dict[str, str]:
        return {key: f"/dev/null/{key}" for key in KLIPPER_PATH_KEYS}


def test_no_kill_reports_an_empty_report() -> None:
    report = oom.build_report("oom_kill 0\n", "Killed process 1 (python3)")
    assert report.kills == 0
    assert report.token == ""
    assert report.detail == ""


def test_missing_counter_reads_zero() -> None:
    assert oom.oom_kill_count("nr_free_pages 12345\npgfault 42\n") == 0


def test_counter_reads_the_cumulative_value() -> None:
    assert oom.oom_kill_count("pgfault 42\noom_kill 7\n") == 7


def test_a_kill_reports_the_token_and_the_victim() -> None:
    ring = "Out of memory: Killed process 900 (camera-stream) total-vm:80000kB"
    report = oom.build_report("oom_kill 1\n", ring)
    assert report.kills == 1
    assert report.token == "oom-kill"
    assert "camera-stream" in report.detail


def test_a_kill_whose_victim_line_aged_out_reports_a_generic_detail() -> None:
    report = oom.build_report("oom_kill 3\n", "no victim line survives here")
    assert report.kills == 3
    assert report.token == "oom-kill"
    assert report.detail == "an out-of-memory kill occurred"


def test_latest_victim_takes_the_most_recent_line() -> None:
    ring = "Killed process 1 (older-victim)\nKilled process 2 (camera-stream)\n"
    assert oom.latest_victim(ring) == "camera-stream"


def test_oom_report_wires_the_device_reads(monkeypatch: MP) -> None:
    monkeypatch.setattr(oom_probe, "_proc_vmstat", lambda: "oom_kill 1\n")
    monkeypatch.setattr(kernel_log, "ring_buffer", lambda: "Killed process 412 (python3)")
    report = _PrinterJinni().oom_report()
    assert report.kills == 1
    assert report.token == "oom-kill"
    assert "python3" in report.detail


def test_oom_report_reads_no_kill_when_the_kernel_is_quiet(monkeypatch: MP) -> None:
    monkeypatch.setattr(oom_probe, "_proc_vmstat", lambda: "oom_kill 0\n")
    monkeypatch.setattr(kernel_log, "ring_buffer", lambda: "")
    assert _PrinterJinni().oom_report().token == ""
