# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The end of a service log, and only the live file's."""
from pathlib import Path

from jinni.log_tail import read_log_tail


def test_the_tail_is_the_last_bytes_of_a_big_log(tmp_path: Path) -> None:
    log_path = tmp_path / "klippy.log"
    log_path.write_text("old line\n" * 1000 + "the current error")
    assert read_log_tail(log_path, max_bytes=17) == "the current error"


def test_an_empty_log_never_falls_back_to_a_rotated_one(tmp_path: Path) -> None:
    # A rotated file holds an earlier run: its error says nothing about what broke now.
    (tmp_path / "klippy.log").write_text("")
    (tmp_path / "klippy.log.1").write_text("Section 'old_run' is not a valid config section")
    assert read_log_tail(tmp_path / "klippy.log") == ""
