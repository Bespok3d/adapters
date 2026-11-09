# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read the end of a service log, and find where the service's current run starts in it.

A failure must be blamed on what the running service logged, never on an error an earlier run left
in the same file. Klipper and Moonraker each write a fixed line every time they start, before they
load their config or components, so the text after the last such line is the current run.
"""
import os
from pathlib import Path

LOG_TAIL_BYTES = 16384
# Klipper's Printer.run() logs it on every start and restart, before it reads printer.cfg.
KLIPPER_RUN_START = "Start printer at "
# Moonraker's LogManager writes this header on every start, before it loads any component. It
# also opens a fresh file after a size rollover, where no earlier text is left to cut.
MOONRAKER_RUN_START = " Log Start | "


def read_log_tail(path: Path, max_bytes: int = LOG_TAIL_BYTES) -> str:
    """The end of the live log only, never a rotated sibling: that holds an earlier run, which says
    nothing about what broke now. Seek instead of reading it all: a live log can be tens of MB on a
    printer short of memory."""
    try:
        with path.open("rb") as log_file:
            log_size = log_file.seek(0, os.SEEK_END)
            log_file.seek(max(0, log_size - max_bytes))
            return log_file.read(max_bytes).decode(errors="replace")
    except OSError:
        return ""


def current_run(log_tail: str, run_start: str) -> str:
    """The text from the last `run_start` line on. No such line in the tail means the whole tail
    is the current run."""
    _, found_start, run_text = log_tail.rpartition(run_start)
    return found_start + run_text if found_start else log_tail
