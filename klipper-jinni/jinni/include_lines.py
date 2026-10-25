# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The bespok3d include lines in a printer's own configs, and the edits that put them in or take
them out (ADR-0037).

Each config bespok3d wires is named once here, with the path variable that locates it and the line
it carries, so the integration facet walks one table instead of repeating each config by hand. The
client writes the same lines at enrollment; its test reads this file to prove the two halves agree.
"""
from dataclasses import dataclass
from pathlib import Path

_KLIPPER_INCLUDE = "[include bespok3d/klipper"
_MOONRAKER_INCLUDE = "[include bespok3d/moonraker"
_KLIPPER_INCLUDE_LINE = "[include bespok3d/klipper/*.cfg]"
_MOONRAKER_INCLUDE_LINE = "[include bespok3d/moonraker/*.cfg]"
_SAVE_CONFIG_MARKER = "#*# <---------------------- SAVE_CONFIG"


@dataclass(frozen=True)
class WiredConfig:
    """One of the printer's own configs that carries a bespok3d include line."""

    # The config's device name, the key the daemon's self-check reports it under.
    device_name: str
    # The path variable that locates the live config.
    path_key: str
    # What any form of our include line looks like, so an existing one is recognised.
    pattern: str
    include_line: str


WIRED_CONFIGS = (
    WiredConfig("printer.cfg", "PRINTER_CFG", _KLIPPER_INCLUDE, _KLIPPER_INCLUDE_LINE),
    WiredConfig("moonraker.conf", "MOONRAKER_CFG", _MOONRAKER_INCLUDE, _MOONRAKER_INCLUDE_LINE),
)


def remove_include_lines(cfg_path: Path, pattern: str) -> None:
    if not cfg_path.exists():
        return
    kept = [line for line in cfg_path.read_text().splitlines(keepends=True) if pattern not in line]
    cfg_path.write_text("".join(kept))


def ensure_include_line(cfg_path: Path, pattern: str, include_line: str) -> None:
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


def has_include_line(cfg_path: Path, pattern: str) -> bool:
    return cfg_path.exists() and pattern in cfg_path.read_text()
