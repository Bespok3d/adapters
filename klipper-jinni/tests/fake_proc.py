# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A fake /proc and fake service logs, standing in for the printer's in the live-log tests."""
import os
from pathlib import Path


def fake_log(path: Path, text: str, modified_at: float) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    os.utime(path, (modified_at, modified_at))
    return path


def fake_process(proc_root: Path, pid: int, argv: tuple[str, ...], *held: Path) -> None:
    """A process with its command line and one fd symlink per file it holds open."""
    pid_dir = proc_root / str(pid)
    (pid_dir / "fd").mkdir(parents=True)
    (pid_dir / "cmdline").write_bytes(b"\0".join(arg.encode() for arg in argv) + b"\0")
    for descriptor, held_file in enumerate(held, start=3):
        (pid_dir / "fd" / str(descriptor)).symlink_to(held_file)
