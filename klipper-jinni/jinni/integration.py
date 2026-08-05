# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The bespok3d-into-klipper integration teardown facet (ADR-0037).

Enrollment writes the `[include bespok3d/...]` lines into the printer's own config CLIENT-side, and
the bespok3d include dirs hold the plugin `.cfg` symlinks the base layer globs. Editing those
configs and pruning those dirs is device-realm mutation, so the jinni owns it: the daemon never
edits printer.cfg, it asks the jinni to unwire and to wire back up. The include patterns and config
dirs are klipper device facts, named here, never in the generic daemon. Inherits Layout for the
resolved paths.
"""
from pathlib import Path

from .layout import Layout

_KLIPPER_INCLUDE = "[include bespok3d/klipper"
_MOONRAKER_INCLUDE = "[include bespok3d/moonraker"
_KLIPPER_INCLUDE_LINE = "[include bespok3d/klipper/*.cfg]"
_MOONRAKER_INCLUDE_LINE = "[include bespok3d/moonraker/*.cfg]"
_SAVE_CONFIG_MARKER = "#*# <---------------------- SAVE_CONFIG"
_INCLUDE_DIR_KEYS = ("BESPOK3D_KLIPPER", "BESPOK3D_MOONRAKER")
_CONFIG_DIR_NAME = "bespok3d"


def _remove_matching_lines(cfg_path: Path, pattern: str) -> None:
    if not cfg_path.exists():
        return
    kept = [line for line in cfg_path.read_text().splitlines(keepends=True) if pattern not in line]
    cfg_path.write_text("".join(kept))


def _ensure_include_line(cfg_path: Path, pattern: str, include_line: str) -> None:
    """Put our include line back, above the SAVE_CONFIG block klipper owns at the tail of the file.

    Anything below that marker is klipper's to rewrite, so an include placed under it is lost the
    next time the printer saves. Idempotent: a config that already includes us is left alone.

    The blank line above the include is written, never added to what is already there. Taking the
    line out leaves its surrounding blank line behind, so a version that just prefixed another one
    grew the user's config by one empty line on every switch off and back on, and the include ended
    up pushed down a screenful of blank space.
    """
    if not cfg_path.exists():
        return
    content = cfg_path.read_text()
    if pattern in content:
        return
    marker_at = content.find(_SAVE_CONFIG_MARKER)
    head = (content if marker_at < 0 else content[:marker_at]).rstrip("\n")
    tail = "" if marker_at < 0 else f"\n{content[marker_at:]}"
    cfg_path.write_text(f"{head}\n\n{include_line}\n{tail}")


def _has_include_line(cfg_path: Path, pattern: str) -> bool:
    return cfg_path.exists() and pattern in cfg_path.read_text()


def _dead_links_in(directory: Path) -> list[Path]:
    if not directory.is_dir():
        return []
    return [entry for entry in sorted(directory.iterdir())
            if entry.is_symlink() and not entry.exists()]


def _prune_links_and_empty_dirs(root: Path) -> None:
    """Take back our symlinks and any directories left empty, keeping real files (a user may have
    dropped their own .cfg in the include dir). Never rmtree: only our links and empty dirs go."""
    if not root.is_dir():
        return
    for child in sorted(root.iterdir()):
        if child.is_symlink():
            child.unlink()
        elif child.is_dir():
            _prune_links_and_empty_dirs(child)
    if not any(root.iterdir()):
        root.rmdir()


class Integration:
    """Base (generic-box) integration teardown: a box with no bespok3d-into-printer config wiring
    has nothing to unwire or to wire back up, so every one of these is a no-op. The klipper tier
    overrides with the real cfg-include and config-dir operations below."""

    def prune_dead_config_links(self) -> list[str]:
        """Drop bespok3d include symlinks whose target no longer exists (junk from an earlier
        uninstall that breaks a service's include glob). None on a generic box."""
        return []

    def remove_bespok3d_includes(self) -> None:
        """Remove the bespok3d include lines from the printer's own config (enrollment wrote them
        client-side; the daemon never edits the device config). No-op on a generic box."""

    def restore_bespok3d_includes(self) -> None:
        """Put the bespok3d include lines back in the printer's own config, so a printer that still
        holds every plugin actually loads them again. No-op on a generic box."""

    def prune_bespok3d_config_dir(self) -> None:
        """Take back the bespok3d include dir (our symlinks and any now-empty dirs), keeping any
        user files. No-op on a generic box."""

    def bespok3d_include_status(self) -> dict[str, bool]:
        """Which of the printer's own configs currently carry our include line, keyed by the
        config's device name. The daemon's self-check reads this to tell a printer that loads its
        plugins from one that holds them and ignores them; it never learns which configs those
        are. A generic box has no config to wire, so it reports nothing to check."""
        return {}


class KlipperIntegration(Layout, Integration):
    def prune_dead_config_links(self) -> list[str]:
        paths = self.paths()
        removed: list[str] = []
        for key in _INCLUDE_DIR_KEYS:
            directory = paths.get(key)
            if directory:
                removed.extend(_prune_dir(Path(directory)))
        return removed

    def remove_bespok3d_includes(self) -> None:
        paths = self.paths()
        _remove_matching_lines(Path(paths["PRINTER_CFG"]), _KLIPPER_INCLUDE)
        _remove_matching_lines(Path(paths["MOONRAKER_CFG"]), _MOONRAKER_INCLUDE)

    def restore_bespok3d_includes(self) -> None:
        paths = self.paths()
        _ensure_include_line(Path(paths["PRINTER_CFG"]), _KLIPPER_INCLUDE, _KLIPPER_INCLUDE_LINE)
        _ensure_include_line(
            Path(paths["MOONRAKER_CFG"]), _MOONRAKER_INCLUDE, _MOONRAKER_INCLUDE_LINE,
        )

    def bespok3d_include_status(self) -> dict[str, bool]:
        paths = self.paths()
        return {
            "printer.cfg": _has_include_line(Path(paths["PRINTER_CFG"]), _KLIPPER_INCLUDE),
            "moonraker.conf": _has_include_line(Path(paths["MOONRAKER_CFG"]), _MOONRAKER_INCLUDE),
        }

    def prune_bespok3d_config_dir(self) -> None:
        config_dir = Path(self.paths()["BESPOK3D_KLIPPER"]).parent
        if config_dir.name == _CONFIG_DIR_NAME:
            _prune_links_and_empty_dirs(config_dir)


def _prune_dir(directory: Path) -> list[str]:
    removed: list[str] = []
    for dead in _dead_links_in(directory):
        dead.unlink()
        removed.append(str(dead))
    return removed
