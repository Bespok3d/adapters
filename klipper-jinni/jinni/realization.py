# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The realization facet of the jinni: turn an install intent into a concrete target or command.

When the daemon places a file, instruments a source, restarts a service, generates a service script,
seeds a startup control script, or asks what a generated command does to the device's services, it
does not hardcode where or how; it asks the jinni. The base tier owns the bespok3d-layout placement
classes and otherwise realizes nothing (a generic box has no klipper config dir, no restart command,
no service to restart); the klipper tier and the device jinni add their classes, commands, and
service tokens, deferring to `super()` for the base ones.
"""
from collections.abc import Coroutine
from typing import Any

from protocol import CommandEffect, ControlScript

from .classification import INERT_COMMAND, classify_one

# Placement classes the bespok3d layout owns directly (over the daemon's own $BESPOK3D tree). They
# resolve to a $VAR-templated path the executor expands; the value names no concrete device. Klipper
# placement classes live on the klipper tier (jinni/klipper.py).
_BESPOK3D_PLACEMENTS = {
    "system-bin": "$BESPOK3D/bin/{name}",
    "web-location": "$BESPOK3D/etc/nginx/locations/{name}",
    "kernel-module": "$BESPOK3D/lib/modules/{name}",
}


class Realization:
    def placement_destination(self, destination_class: str, name: str) -> str:
        """The $VAR-templated path a placed file of `destination_class` lands at. The base tier owns
        the bespok3d-layout classes; a printer tier adds its own and defers to super() for these."""
        template = _BESPOK3D_PLACEMENTS.get(destination_class)
        if template is None:
            raise ValueError(f"unsupported destination class: {destination_class}")
        return template.format(name=name)

    def instrument_destination(self, instrument_class: str, name: str) -> str:
        """The $VAR-templated path an instrumentation diff patches. The base tier instruments
        nothing; a printer tier adds its source classes and defers to super() for the unknown."""
        raise ValueError(f"unsupported instrument class: {instrument_class}")

    def restart_command(self, hook: str) -> str | None:
        """The shell command that restarts the core service named by `hook` (klipper, moonraker,
        web, lmd), or None when the device has no such service. The commands are genuine device
        facts, so the base tier knows none; a device jinni supplies them."""
        return None

    def classify_commands(self, commands: list[str]) -> list[CommandEffect]:
        """How each generated start command acts on the device's services. A generic box has no
        services, so nothing is a service action; the klipper tier judges the real ones."""
        return [INERT_COMMAND for _ in commands]

    def render_service_script(self, service: dict, paths: dict[str, str]) -> str:
        raise NotImplementedError("managed-service")

    def render_module_script(self, kmodule: dict, paths: dict[str, str]) -> str:
        """The kernel-module loader script (mknod device nodes, insmod, rmmod). Device-realm
        knowledge, so the base tier renders none; a device jinni that advertises `kernel-modules`
        supplies it."""
        raise NotImplementedError("kernel-module")

    def startup_control_scripts(self, paths: dict[str, str]) -> list[ControlScript]:
        """Control scripts the daemon writes into the persistent bespok3d tree on startup (e.g. a
        display control script). The base tier declares none; a device jinni returns its own."""
        return []

    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return []


# Placement and instrument classes a klipper printer adds, resolving to $VAR-templated paths over
# the klipper layout contract (KLIPPER_PATH_KEYS). The executor expands the variables from the
# device jinni's paths; the values name no concrete device.
_KLIPPER_PLACEMENTS = {
    "klipper-config": "$BESPOK3D_KLIPPER/{name}",
    "moonraker-config": "$BESPOK3D_MOONRAKER/{name}",
    "klipper-extra": "$KLIPPER_EXTRAS/{name}",
    "moonraker-component": "$MOONRAKER_COMPONENTS/{name}",
}
_KLIPPER_INSTRUMENTS = {
    "klipper-source": "$KLIPPER_SRC/{name}",
}


class KlipperRealization(Realization):
    """Realization for a klipper printer: its config/extra/component placement classes and its
    klipper-source instrumentation class, deferring to the base tier for the bespok3d-layout
    classes."""

    def placement_destination(self, destination_class: str, name: str) -> str:
        template = _KLIPPER_PLACEMENTS.get(destination_class)
        if template is None:
            return super().placement_destination(destination_class, name)
        return template.format(name=name)

    def instrument_destination(self, instrument_class: str, name: str) -> str:
        template = _KLIPPER_INSTRUMENTS.get(instrument_class)
        if template is None:
            return super().instrument_destination(instrument_class, name)
        return template.format(name=name)

    def classify_commands(self, commands: list[str]) -> list[CommandEffect]:
        markers = self.deferred_service_markers()
        display = self.display_service_tokens()
        return [classify_one(command, markers, display) for command in commands]

    def deferred_service_markers(self) -> tuple[str, ...]:
        """Device tokens that mark a batchable service command (e.g. the init-script dir, the web
        server). A device jinni supplies its own; the bare klipper tier names none."""
        return ()

    def display_service_tokens(self) -> tuple[str, ...]:
        """Device tokens that mark a display-service restart (it interrupts a print). A device jinni
        supplies its own; the bare klipper tier names none."""
        return ()
