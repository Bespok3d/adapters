# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1 firmware's klipper config for each mainboard.

On firmware 2.0 the stock boot script S60klipper asks the main MCU for its model and starts klipper
on printer_v2.cfg when it is a gd32h757, on printer.cfg otherwise. Both files ship on every printer,
and the newer mainboard never reads printer.cfg, so the include line goes into both: a printer on
that board otherwise loads no plugin at all.
"""
from pathlib import Path

_OTHER_MAINBOARD_KEYS_OF_LIVE_KEY = {
    "PRINTER_CFG": ("PRINTER_V2_CFG",),
}


def other_mainboard_config_keys(paths: dict[str, str], live_key: str) -> list[str]:
    """The path keys of the configs the other mainboards boot instead of this one, when this
    firmware has them. A firmware without them boots every board on the one config."""
    return [key for key in _OTHER_MAINBOARD_KEYS_OF_LIVE_KEY.get(live_key, ())
            if Path(paths[key]).exists()]
