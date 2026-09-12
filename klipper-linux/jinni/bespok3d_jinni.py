# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Klipper on Linux Jinni: the daemon-side half of the adapter that enrols a Voron 2.4.

Shipped with the adapter and installed next to the daemon, which loads it via `make_jinni()`. The
host is a Debian style Linux box with systemd (MainsailOS, Fluidd, a KIAUH install), so it is a
klipper printer and this extends `KlipperPrinterJinni`, overriding only what this class of host
makes different from the printer tier's defaults.

Two things are genuinely different here, and each lives in its own module next to this one. The
layout is not fixed: where Klipper, Moonraker and the printer data sit is read off the host at
enrolment (layout_discovery) and applied over the templates at runtime (linux_layout). And the
services belong to systemd rather than to Bespok3d, so every restart goes through `sudo -n
systemctl` against the exact commands the sudoers drop-in allows, which is why none of them prompt.
The host's web server is not among them: a plugin's nginx location is refused here rather than
placed, because a file this account writes must never be one the host's root nginx reads.

This class is the composition root: it declares the host's facts and wires those modules to the
contract methods. One code base answers for both adapter ids the app registers (`voron-24` and
`klipper-generic`); which one this printer was enrolled as comes from the layout file, because it
is enrolment knowledge and not something the host can be asked.
"""
import json
import os
from pathlib import Path
from typing import Any

import linux_facts
import linux_layout
import service_scripts

from jinni import KlipperPrinterJinni

# The single source of truth for this host's path templates. Read here at runtime AND by the
# app-side client at enrolment; it deploys to the printer with the rest of this jinni dir.
_PATHS_FILE = Path(__file__).resolve().parent / "paths.json"
# Likewise the single source of truth for this jinni's version, so the printer half and the app can
# never report different versions.
_VERSION_FILE = Path(__file__).resolve().parent / "version.json"

# The id a jinni reports when it is running before an enrolment ever wrote a layout file: the code
# base's own name, never one of the two product ids, which would be a guess about the printer.
_DEFAULT_ID = "klipper-linux"

# The core-service restart commands, keyed by the generic hook a manifest declares. Every one is
# spelled exactly as the sudoers drop-in allows it, with `sudo -n` so it fails fast instead of
# waiting on a password prompt no one can answer.
_RESTART_COMMANDS = {
    "klipper": "sudo -n /usr/bin/systemctl restart klipper",
    "moonraker": "sudo -n /usr/bin/systemctl restart moonraker",
}

# A plugin's web location is a file the host's root nginx would parse and this account could write,
# which is a road to root this adapter does not open: the web server here belongs to the host, not
# to Bespok3d. The class is refused outright, so the daemon turns such a plugin away with a plain
# reason instead of placing a file that nothing includes.
_WEB_LOCATION = "web-location"
_WEB_LOCATION_REFUSAL = (
    "plugin web locations are not supported on this adapter: the printer's web server is the "
    "host's own and Bespok3d does not change its configuration"
)


def _home() -> str:
    return str(Path.home())


def _adapter_id(layout: dict[str, object]) -> str:
    adapter = layout.get("adapter")
    return adapter if isinstance(adapter, str) and adapter else _DEFAULT_ID


class KlipperLinuxJinni(KlipperPrinterJinni):
    def __init__(self) -> None:
        self._layout = linux_layout.read_layout(self.data_root())
        self.id = _adapter_id(self._layout)

    def data_root(self) -> str:
        """The workspace lives in the login user's home, so every upload and every daemon write
        needs no privilege. The unit exports the same value it was installed with."""
        return os.environ.get("BESPOK3D_DATA_ROOT") or f"{_home()}/bespok3d"

    def runtime_user(self) -> str:
        return linux_layout.current_user()

    def device_paths(self) -> dict[str, str]:
        templates: dict[str, str] = json.loads(_PATHS_FILE.read_text())
        return linux_layout.resolve_paths(templates, _home(), self._layout)

    def arch(self) -> str:
        return linux_facts.arch()

    def board_class(self) -> str:
        return linux_facts.board_class()

    def kernel_release(self) -> str:
        return linux_facts.kernel_release()

    def kernel_vermagic(self) -> str:
        """This adapter places no kernel module, so the magic a module would be built against is
        not a fact it needs; reading it would only invite a plugin to trust it."""
        return "unknown"

    def firmware_version(self) -> str:
        """A Linux host has no firmware version, and its OS release is what plays that part: it is
        what decides which Python and which wheels this printer can take."""
        return linux_facts.os_version()

    def klipper_version(self) -> str:
        return linux_facts.klipper_version(self.paths()["KLIPPER_SRC"])

    def version(self) -> str:
        version: dict[str, str] = json.loads(_VERSION_FILE.read_text())
        return version["jinni_version"]

    def capability_flags(self) -> set[str]:
        """No overlay (the filesystem is writable), no kernel modules, and no lmd: a Linux host has
        a display only if the user attached one, and it is not ours to drive."""
        return {"managed-service", "klipper-linux", "systemd"}

    def restart_command(self, hook: str) -> str | None:
        """Klipper and Moonraker, through the two commands the sudoers drop-in allows. There is no
        `web` hook: the web server is the host's, and reloading it is not something this account
        may ask for."""
        return _RESTART_COMMANDS.get(hook)

    def placement_destination(self, destination_class: str, name: str) -> str:
        if destination_class == _WEB_LOCATION:
            raise ValueError(_WEB_LOCATION_REFUSAL)
        return super().placement_destination(destination_class, name)

    def deferred_service_markers(self) -> tuple[str, ...]:
        """Every service command on this host goes through systemctl, so that one token marks the
        commands a multi-plugin install can batch into a single restart."""
        return ("systemctl",)

    def display_service_tokens(self) -> tuple[str, ...]:
        return ()

    def render_service_script(self, service: dict[str, Any], paths: dict[str, str]) -> str:
        return service_scripts.render_service_script(service, paths)


def make_jinni() -> KlipperLinuxJinni:
    return KlipperLinuxJinni()
