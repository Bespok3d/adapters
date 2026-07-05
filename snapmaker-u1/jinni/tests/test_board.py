"""Board-class detection from /proc/meminfo: the 512MB board reads `constrained`, a 1GB+ board reads
`standard`, and an unreadable meminfo reads `unknown` rather than mis-claiming a class."""
from pathlib import Path

import board
import pytest


def _meminfo(total_kb: int) -> str:
    return f"MemTotal:      {total_kb} kB\nMemFree:         1000 kB\nBuffers:            0 kB\n"


def _point_meminfo_at(tmp_path: Path, content: str, monkeypatch: pytest.MonkeyPatch) -> None:
    meminfo = tmp_path / "meminfo"
    meminfo.write_text(content)
    monkeypatch.setattr(board, "_MEMINFO", meminfo)


def test_constrained_board_reads_below_the_ceiling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_meminfo_at(tmp_path, _meminfo(480 * 1024), monkeypatch)
    assert board.board_class() == "constrained"


def test_standard_board_reads_above_the_ceiling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_meminfo_at(tmp_path, _meminfo(2 * 1024 * 1024), monkeypatch)
    assert board.board_class() == "standard"


def test_unknown_when_meminfo_is_missing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(board, "_MEMINFO", tmp_path / "absent")
    assert board.board_class() == "unknown"


def test_unknown_when_meminfo_has_no_memtotal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _point_meminfo_at(tmp_path, "MemFree: 1000 kB\n", monkeypatch)
    assert board.board_class() == "unknown"
