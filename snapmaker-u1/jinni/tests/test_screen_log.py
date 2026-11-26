# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path

import pytest
import screen_log
from screen_log import read_screen_log

OLD_LINES = b"old line\n" * 4
LAST_LINE = b"last line\n"


@pytest.fixture
def long_log(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    monkeypatch.setattr(screen_log, "LOG_READ_LIMIT_BYTES", len(LAST_LINE))
    log_path = tmp_path / "gui.log"
    log_path.write_bytes(OLD_LINES + LAST_LINE)
    return log_path


def test_a_long_log_is_read_only_at_its_end(long_log: Path) -> None:
    log_read = read_screen_log(long_log)
    assert log_read.log_text == LAST_LINE
    assert log_read.read_start == len(OLD_LINES)


def test_a_later_start_wins_over_the_limit(long_log: Path) -> None:
    log_read = read_screen_log(long_log, len(OLD_LINES) + len(b"last "))
    assert log_read.log_text == b"line\n"


def test_the_read_names_the_file_it_came_from(long_log: Path) -> None:
    assert read_screen_log(long_log).log_inode == long_log.stat().st_ino
