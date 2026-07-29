# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The symlink wiring facet of the jinni (ADR-0037).

The daemon places a plugin's files in the bespok3d tree and resolves where each one belongs, then
asks the jinni to WIRE them: symlink each into its destination, preserving any stock original it
shadows (moved to the plugin's symlink_orig dir) so the firmware can be restored exactly. Creating,
backing up, and removing those symlinks is device-realm mutation, so it lives here, not in the
daemon. Each wiring records its reversion (jinni/reversion_record.py) for the escape hatch.

These calls are the actuation queue's work: the service serializes them so two ops never wire at
once, while reads stay concurrent (jinni/service.py).
"""
import shutil
from pathlib import Path

from protocol import ActionResult

from . import stale_dentry
from .reversion_record import WIRING_RECORD, merge_record, reversion

_SYMLINK_ORIG_DIR = "symlink_orig"


def _backup_path(backup_root: Path, destination: Path) -> Path:
    key = destination.as_posix().strip("/").replace("/", "__") or "root"
    return backup_root / key


def _is_stock_original(path: Path) -> bool:
    """A real dir/file (the stock original worth preserving), not a symlink or overlay whiteout."""
    return (path.is_dir() or path.is_file()) and not path.is_symlink()


def _clear_existing_destination(destination: Path) -> None:
    if destination.is_symlink():
        destination.unlink()
        return
    if destination.is_dir():
        shutil.rmtree(destination)
        return
    if destination.exists():
        destination.unlink()


def _displace_existing_destination(destination: Path, backup: Path) -> None:
    """Make room for our symlink while preserving any stock original so teardown can restore it. A
    real dir/file is MOVED to the plugin-owned backup the first time only (pristine original wins
    over a regenerated copy); a symlink or overlay whiteout is just cleared, never saved."""
    if not _is_stock_original(destination) or backup.exists():
        _clear_existing_destination(destination)
        return
    backup.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(str(destination), str(backup))


def _place_symlink(source: Path, destination: Path, backup: Path) -> dict[str, str]:
    destination.parent.mkdir(parents=True, exist_ok=True)
    _displace_existing_destination(destination, backup)
    destination.symlink_to(source)
    return reversion(destination, backup)


def _rewire_past_stale_dentry(source: Path, destination: Path, backup: Path) -> tuple[ActionResult, dict[str, str]]:  # noqa: E501
    """A destination wedged by an orphaned overlay name yields to nothing but a dentry-cache drop,
    so clear it and place the link once more before calling the wiring a failure."""
    stale_dentry.drop_dentry_cache()
    try:
        return ActionResult(ok=True, output=""), _place_symlink(source, destination, backup)
    except OSError as exc:
        return ActionResult(ok=False, output=str(exc)), {}


def _wire_one(source: Path, destination: Path, backup_root: Path) -> tuple[ActionResult, dict[str, str]]:  # noqa: E501
    backup = _backup_path(backup_root, destination)
    try:
        return ActionResult(ok=True, output=""), _place_symlink(source, destination, backup)
    except OSError as exc:
        if not stale_dentry.is_stale_handle(exc):
            return ActionResult(ok=False, output=str(exc)), {}
    return _rewire_past_stale_dentry(source, destination, backup)


def _unwire_one(destination: Path, backup_root: Path) -> ActionResult:
    backup = _backup_path(backup_root, destination)
    try:
        if destination.is_symlink():
            destination.unlink()
        if backup.exists() and not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(backup), str(destination))
    except OSError as exc:
        return ActionResult(ok=False, output=str(exc))
    return ActionResult(ok=True, output="")


class Wiring:
    def wire(self, plugin_dir: str, links: list[dict[str, str]]) -> list[ActionResult]:
        """Symlink each link's `source` into its `destination`, backing up any stock original under
        the plugin's symlink_orig dir, and record every reversion to the plugin's wiring.json so the
        off-host hatch can undo it. One ActionResult per link, for the daemon's phase log."""
        base = Path(plugin_dir)
        backup_root = base / _SYMLINK_ORIG_DIR
        outcomes: list[ActionResult] = []
        reversions: list[dict[str, str]] = []
        for link in links:
            result, undo = _wire_one(Path(link["source"]), Path(link["destination"]), backup_root)
            outcomes.append(result)
            if undo:
                reversions.append(undo)
        merge_record(base / WIRING_RECORD, reversions)
        return outcomes

    def unwire(self, plugin_dir: str, destinations: list[str]) -> list[ActionResult]:
        """Drop each symlink we created and restore any stock original from its backup. The inverse
        of wire, used when a plugin is taken off the system."""
        backup_root = Path(plugin_dir) / _SYMLINK_ORIG_DIR
        return [_unwire_one(Path(destination), backup_root) for destination in destinations]
