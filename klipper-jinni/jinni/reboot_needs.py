# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The states this box has got into that only a power cycle clears.

Some faults have no software recovery: a display pipe that has stopped drawing, a driver that no
longer re-initialises, a service that comes back but not the hardware behind it. The printer is the
only thing that can recognise its own, so it names them as tokens and the app turns each token into
one line for the person standing in front of the machine.

A generic linux box knows of no such state, so it reports none and the app offers nothing. A device
tier that does know overrides this.
"""
import subprocess


class RebootNeeds:
    def reboot_required(self) -> list[str]:
        """The tokens for every condition on this box that only a boot clears, empty when there is
        none. A generic box has no device knowledge to recognise one, so it always answers empty."""
        return []

    def watch_line(self, line: str) -> str | None:
        """The token of a condition only a boot clears when this kernel log line reports one, None
        otherwise. A generic box recognises no line."""
        return None

    def reboot_printer(self) -> None:
        """Start a reboot and return at once. The reboot runs in its own session, detached from the
        jinni, because it ends the jinni and its caller before any answer could come back."""
        subprocess.Popen(
            ["reboot"], start_new_session=True,
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
