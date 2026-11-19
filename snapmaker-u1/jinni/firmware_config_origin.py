# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1 firmware's own copy of each printer config, which its boot can put back over the live one.

On firmware 2.0.0.205 the stock boot script S48setup-lava-env (it logs as `lavaenv`) compares each
live config under /oem/printer_data/config with its copy under /home/lava/origin_printer_data/config
and, when the two differ, restores the copy ("restore changed config file printer.cfg" in the
syslog). An include line written only into the live config is then gone after the next boot, so the
copy carries it too. The copy sits on the root filesystem, kept across reboots by the same write
layer (/oem/.debug) that keeps the rest of the enrollment.

The script skips that restore when /oem/printer_data/.fluidd (Advanced mode, which enrollment turns
on) or /oem/.factory exists. The copy then has no say in what the printer loads, so it does not
count when telling whether the printer is wired. It is still written and cleaned with the live
config, so it is right again the day the restore comes back on.
"""
from pathlib import Path

_ORIGIN_KEY_OF_LIVE_KEY = {
    "PRINTER_CFG": "PRINTER_CFG_ORIGIN",
    "MOONRAKER_CFG": "MOONRAKER_CFG_ORIGIN",
    "PRINTER_V2_CFG": "PRINTER_V2_CFG_ORIGIN",
}
_MARKERS_THAT_STOP_THE_RESTORE = ("ADVANCED_MODE_MARKER", "FACTORY_MARKER")


def boot_restores_origin_copies(paths: dict[str, str]) -> bool:
    return not any(Path(paths[marker]).is_file() for marker in _MARKERS_THAT_STOP_THE_RESTORE)


def copies_the_printer_loads(paths: dict[str, str], config_copies: list[Path]) -> list[Path]:
    if boot_restores_origin_copies(paths):
        return config_copies
    origin_copy_paths = {Path(paths[origin_key]) for origin_key in _ORIGIN_KEY_OF_LIVE_KEY.values()}
    return [copy for copy in config_copies if copy not in origin_copy_paths]


def origin_copies(paths: dict[str, str], live_key: str) -> list[Path]:
    """The firmware's copy of one live config, when this firmware has it. A firmware without the
    copy has nothing to restore from, and counting a copy that is not there as unwired would flag
    every such printer as broken."""
    origin_key = _ORIGIN_KEY_OF_LIVE_KEY.get(live_key)
    if origin_key is None:
        return []
    origin_copy = Path(paths[origin_key])
    return [origin_copy] if origin_copy.exists() else []
