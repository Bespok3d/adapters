# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The init script a managed plugin service gets, rendered from the shell template next to it."""
import service_scripts

_PATHS = {"BESPOK3D": "/home/pi/bespok3d"}


def test_a_service_script_starts_its_command_under_start_stop_daemon() -> None:
    service = {"name": "remote-screen", "command": "/usr/bin/python3", "args": ["-u", "fb.py"]}
    script = service_scripts.render_service_script(service, _PATHS)

    assert script.startswith("#!/bin/sh")
    assert "start-stop-daemon -S" in script
    assert "PIDFILE=/home/pi/bespok3d/run/remote-screen.pid" in script
    assert "LOG=/home/pi/bespok3d/var/log/remote-screen.log" in script
    assert "exec /usr/bin/python3 -u fb.py >>$LOG 2>&1" in script


def test_a_service_with_no_arguments_still_renders() -> None:
    script = service_scripts.render_service_script(
        {"name": "spoolman-bridge", "command": "/home/pi/bespok3d/bin/bridge"}, _PATHS
    )

    assert "exec /home/pi/bespok3d/bin/bridge >>$LOG 2>&1" in script


def test_no_sentinel_survives_the_rendering() -> None:
    """A sentinel left in place is a path the printer would take literally."""
    script = service_scripts.render_service_script(
        {"name": "spoolman-bridge", "command": "/home/pi/bespok3d/bin/bridge"}, _PATHS
    )

    assert not any(
        sentinel in script for sentinel in ("__PIDFILE__", "__LOG__", "__EXEC__", "__NAME__")
    )


def test_the_script_asks_for_no_privilege() -> None:
    """The whole bespok3d tree belongs to the login user, so a plugin service never needs root and
    must never be written as if it could get it."""
    script = service_scripts.render_service_script(
        {"name": "spoolman-bridge", "command": "/home/pi/bespok3d/bin/bridge"}, _PATHS
    )

    assert "sudo" not in script
