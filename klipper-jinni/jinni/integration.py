# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The bespok3d-into-klipper integration teardown facet (ADR-0037).

Enrollment writes the `[include bespok3d/...]` lines into the printer's own config CLIENT-side, and
the bespok3d include dirs hold the plugin `.cfg` symlinks the base layer globs. Editing those
configs and pruning those dirs is device-realm mutation, so the jinni owns it: the daemon never
edits printer.cfg, it asks the jinni to unwire and to wire back up. The include lines (in
include_lines) and the config dirs (here) are klipper device facts, never named in the generic
daemon. Inherits Layout for the resolved paths.
"""
from pathlib import Path

from .include_lines import (
    WIRED_CONFIGS,
    WiredConfig,
    ensure_include_line,
    has_include_line,
    remove_include_lines,
)
from .layout import Layout

_INCLUDE_DIR_KEYS = ("BESPOK3D_KLIPPER", "BESPOK3D_MOONRAKER")
_CONFIG_DIR_NAME = "bespok3d"


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

    def config_copies(self, path_key: str) -> list[Path]:
        """Every file that has to carry the include line for one of the printer's own configs: the
        live config, plus any copy the device's firmware puts back over it on boot. A device whose
        firmware does that adds its copy here, or the line is gone after the next boot."""
        return [Path(self.paths()[path_key])]

    def _wired_config_files(self) -> list[tuple[WiredConfig, Path]]:
        return [(wired, cfg_path) for wired in WIRED_CONFIGS
                for cfg_path in self.config_copies(wired.path_key)]

    def remove_bespok3d_includes(self) -> None:
        for wired, cfg_path in self._wired_config_files():
            remove_include_lines(cfg_path, wired.pattern)

    def restore_bespok3d_includes(self) -> None:
        for wired, cfg_path in self._wired_config_files():
            ensure_include_line(cfg_path, wired.pattern, wired.include_line)

    def bespok3d_include_status(self) -> dict[str, bool]:
        """A config counts as wired only when every copy of it carries the line: a copy the
        firmware restores from without it undoes the live line on the next boot."""
        return {
            wired.device_name: all(has_include_line(cfg_path, wired.pattern)
                                   for cfg_path in self.config_copies(wired.path_key))
            for wired in WIRED_CONFIGS
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
