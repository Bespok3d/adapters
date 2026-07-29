# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The actuation facet of the jinni: run the device actions the daemon resolved (ADR-0037).

The daemon orchestrates: it resolves a plugin's start/restart/stop commands (via the realization
facet and the device's restart commands), groups and dedupes them, and asks the jinni to RUN them.
Running a command is the device-realm actuation, so it lives here, not in the daemon. The execution
is generic (any linux box runs a shell command); the COMMANDS are the device's, resolved upstream.

These calls are the actuation queue's work: the service serializes them so two ops never bounce a
service at once, while read verbs stay concurrent (jinni/service.py).
"""
import os
import subprocess

from protocol import ActionResult

# Cap the captured output so one chatty command cannot flood a reply frame. Matches the daemon's own
# result cap; kept local so the jinni shares nothing with the daemon but the protocol.
_MAX_OUTPUT_BYTES = 4096

# A predictable PATH for a command the daemon resolved: the init scripts and service binaries live
# in the standard sbin/bin dirs, which a stripped service environment may not carry.
_DEVICE_PATH = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"


def _device_env() -> dict[str, str]:
    return {**os.environ, "PATH": _DEVICE_PATH}


def _run_one(command: str, env: dict[str, str]) -> ActionResult:
    result = subprocess.run(command, shell=True, capture_output=True, check=False, env=env)
    raw = (result.stdout + result.stderr).decode(errors="replace")
    output = raw[:_MAX_OUTPUT_BYTES] + ("…" if len(raw) > _MAX_OUTPUT_BYTES else "")
    return ActionResult(ok=result.returncode == 0, output=output.strip())


class Actuation:
    def run_actions(self, commands: list[str]) -> list[ActionResult]:
        """Run each resolved device action in order, reporting per-command success and output. The
        daemon hands over already-resolved, already-deduped commands; the jinni only executes."""
        env = _device_env()
        return [_run_one(command, env) for command in commands]
