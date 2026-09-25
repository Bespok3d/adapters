# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The static facts a Linux printer host reports, and the `unknown` it reports instead of a guess.

A wrong fact here selects the wrong build of a plugin, so every read that can fail says so.
"""
import subprocess
from pathlib import Path

import linux_facts
import pytest


def _meminfo(total_kb: int) -> str:
    return f"MemTotal:      {total_kb} kB\nMemFree:         1000 kB\nBuffers:            0 kB\n"


def _point_at(
    attribute: str, tmp_path: Path, content: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / attribute
    source.write_text(content)
    monkeypatch.setattr(linux_facts, attribute, source)


def test_arch_is_what_the_host_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(linux_facts.platform, "machine", lambda: "aarch64")

    assert linux_facts.arch() == "aarch64"


def test_arch_is_unknown_when_the_host_reports_nothing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(linux_facts.platform, "machine", lambda: "")

    assert linux_facts.arch() == "unknown"


def test_a_starved_board_reads_below_the_ceiling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_at("_MEMINFO", tmp_path, _meminfo(480 * 1024), monkeypatch)

    assert linux_facts.board_class() == "constrained"


def test_a_pi_4_reads_above_the_ceiling(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _point_at("_MEMINFO", tmp_path, _meminfo(4 * 1024 * 1024), monkeypatch)

    assert linux_facts.board_class() == "standard"


def test_the_board_class_is_unknown_when_meminfo_cannot_be_read(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(linux_facts, "_MEMINFO", tmp_path / "absent")

    assert linux_facts.board_class() == "unknown"


def test_the_board_class_is_unknown_when_meminfo_has_no_total(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_at("_MEMINFO", tmp_path, "MemFree: 1000 kB\n", monkeypatch)

    assert linux_facts.board_class() == "unknown"


def test_the_os_version_is_the_release_id_this_host_publishes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Which Debian release this is decides whether the daemon's baked wheels fit its Python."""
    _point_at(
        "_OS_RELEASE", tmp_path,
        'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nVERSION_ID="12"\nID=debian\n', monkeypatch,
    )

    assert linux_facts.os_version() == "12"


def test_the_os_version_is_unknown_on_a_host_that_publishes_none(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_at("_OS_RELEASE", tmp_path, "ID=debian\n", monkeypatch)

    assert linux_facts.os_version() == "unknown"


def test_the_os_version_is_unknown_when_there_is_no_os_release(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(linux_facts, "_OS_RELEASE", tmp_path / "absent")

    assert linux_facts.os_version() == "unknown"


def _record_commands(monkeypatch: pytest.MonkeyPatch, stdout: str) -> list[list[str]]:
    asked: list[list[str]] = []

    def run(command: list[str], **_options: object) -> subprocess.CompletedProcess[str]:
        asked.append(command)
        return subprocess.CompletedProcess(command, 0, stdout=stdout, stderr="")

    monkeypatch.setattr(linux_facts.subprocess, "run", run)
    return asked


def test_the_kernel_release_is_read_from_uname(monkeypatch: pytest.MonkeyPatch) -> None:
    asked = _record_commands(monkeypatch, "6.12.25-v8+\n")

    assert linux_facts.kernel_release() == "6.12.25-v8+"
    assert asked == [["uname", "-r"]]


def test_the_kernel_release_is_unknown_when_uname_cannot_run(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def refuse(*_args: object, **_options: object) -> object:
        raise OSError("uname unavailable")

    monkeypatch.setattr(linux_facts.subprocess, "run", refuse)

    assert linux_facts.kernel_release() == "unknown"


def test_the_klipper_version_is_read_from_the_checkout_above_klippy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """KLIPPER_SRC points at `<checkout>/klippy`, and git describes the checkout, not that dir."""
    asked = _record_commands(monkeypatch, "v0.13.0-42-gfakehash\n")
    version = linux_facts.klipper_version("/home/pi/klipper/klippy")

    assert version == "v0.13.0-42-gfakehash"
    assert asked[0][:3] == ["git", "-C", "/home/pi/klipper"]


def test_the_klipper_version_is_unknown_when_git_reports_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _record_commands(monkeypatch, "")

    assert linux_facts.klipper_version("/home/pi/klipper/klippy") == "unknown"


def test_the_klipper_version_is_unknown_when_no_source_path_is_known() -> None:
    assert linux_facts.klipper_version("") == "unknown"
