"""The wiring reversion record: the escape-hatch data (ADR-0037 decision 6).

As the jinni wires, it records each reversion as a declarative filesystem undo step in the plugin's
`wiring.json`, keyed by destination path so a second wire (e.g. the site-package links after the
config symlinks) accumulates into one record and a re-wire of the same path stays a single entry.
The return-to-stock hatch replays these over generic filesystem ops without the daemon or the jinni
running, so the record is the jinni's only obligation for the hatch; triggering and replaying it is
the app's. Shared by the symlink wiring and the device-file r/w facets.
"""
import json
from pathlib import Path

WIRING_RECORD = "wiring.json"
REVERT_UNLINK = "unlink"
REVERT_RESTORE = "restore"


def reversion(destination: Path, backup: Path) -> dict[str, str]:
    """How to undo a wiring: restore the backed-up stock original if one was kept, else just drop
    the symlink we created."""
    if backup.exists():
        return {"action": REVERT_RESTORE, "path": str(destination), "backup": str(backup)}
    return {"action": REVERT_UNLINK, "path": str(destination)}


def merge_record(record_path: Path, reversions: list[dict[str, str]]) -> None:
    by_path: dict[str, dict[str, str]] = {}
    if record_path.exists():
        existing = json.loads(record_path.read_text())
        by_path = {entry["path"]: entry for entry in existing.get("reversions", [])}
    for entry in reversions:
        by_path[entry["path"]] = entry
    record_path.write_text(json.dumps({"reversions": list(by_path.values())}, indent=2))
