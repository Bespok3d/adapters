# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The device-file read/write facet of the jinni (ADR-0037).

The patch path: the daemon FETCHES a stock file (the pristine baseline), patches a copy in its own
tree, and asks the jinni to WRITE the patched result back; restore writes the pristine back. Reading
and writing a device file is the jinni's, not the daemon's. A write that carries `restore_from` (the
daemon's pristine copy) records its undo in the plugin's wiring.json. `fetch` is a read (off the
actuation queue); `write_files` is an actuation (serialized).
"""
from pathlib import Path

from protocol import ActionResult

from .reversion_record import REVERT_RESTORE, WIRING_RECORD, merge_record


def _write_one_file(path: Path, content: str) -> ActionResult:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)
    except OSError as exc:
        return ActionResult(ok=False, output=str(exc))
    return ActionResult(ok=True, output="")


class DeviceFiles:
    def fetch(self, path: str) -> str | None:
        """Read a device file's current content for the daemon to patch (the pristine baseline), or
        None if it does not exist. Read bytes-then-decode (not read_text) so the original line
        endings survive: the baseline is the byte-exact restore source. A read, off the queue."""
        target = Path(path)
        if not target.is_file():
            return None
        return target.read_bytes().decode(errors="replace")

    def write_files(self, plugin_dir: str, writes: list[dict]) -> list[ActionResult]:
        """Write each `{path, content}` to the device (a patched source, or a pristine baseline on
        restore). A write carrying `restore_from` (the daemon's pristine copy) records a restore
        reversion so the off-host hatch can undo the instrumentation."""
        outcomes: list[ActionResult] = []
        reversions: list[dict[str, str]] = []
        for write in writes:
            outcome = _write_one_file(Path(write["path"]), write["content"])
            outcomes.append(outcome)
            if outcome.ok and write.get("restore_from"):
                reversions.append({"action": REVERT_RESTORE, "path": write["path"],
                                   "backup": write["restore_from"]})
        if reversions:
            merge_record(Path(plugin_dir) / WIRING_RECORD, reversions)
        return outcomes
