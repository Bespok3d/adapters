"""The bespok3d-into-klipper integration teardown facet (ADR-0037).

Enrollment writes the `[include bespok3d/...]` lines into the printer's own config CLIENT-side, and
the bespok3d include dirs hold the plugin `.cfg` symlinks the base layer globs. Editing those
configs and pruning those dirs is device-realm mutation, so the jinni owns it: the daemon never
edits printer.cfg, it asks the jinni to unwire. The include patterns and config dirs are klipper
device facts, named here, never in the generic daemon. Inherits Layout for the resolved paths.
"""
from pathlib import Path

from .layout import Layout

_KLIPPER_INCLUDE = "[include bespok3d/klipper"
_MOONRAKER_INCLUDE = "[include bespok3d/moonraker"
_INCLUDE_DIR_KEYS = ("BESPOK3D_KLIPPER", "BESPOK3D_MOONRAKER")
_CONFIG_DIR_NAME = "bespok3d"


def _remove_matching_lines(cfg_path: Path, pattern: str) -> None:
    if not cfg_path.exists():
        return
    kept = [line for line in cfg_path.read_text().splitlines(keepends=True) if pattern not in line]
    cfg_path.write_text("".join(kept))


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
    has nothing to unwire, so all three are no-ops. The klipper tier overrides with the real
    cfg-include and config-dir operations below."""

    def prune_dead_config_links(self) -> list[str]:
        """Drop bespok3d include symlinks whose target no longer exists (junk from an earlier
        uninstall that breaks a service's include glob). None on a generic box."""
        return []

    def remove_bespok3d_includes(self) -> None:
        """Remove the bespok3d include lines from the printer's own config (enrollment wrote them
        client-side; the daemon never edits the device config). No-op on a generic box."""

    def prune_bespok3d_config_dir(self) -> None:
        """Take back the bespok3d include dir (our symlinks and any now-empty dirs), keeping any
        user files. No-op on a generic box."""


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
