# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read a systemd service's configuration: the fields of its unit and its EnvironmentFile.

Klipper and Moonraker are both started by a unit that keeps the real arguments in an environment
file, so every question about where this host keeps things is answered by parsing those two shapes.
This module knows only the shapes; what a value means is layout_discovery's concern.
"""
import shlex
from pathlib import Path


def env_value(text: str | None, name: str) -> str:
    """The value of `NAME="..."` in an environment file, unquoted. The last assignment wins, the
    way it does when systemd reads the file."""
    return _last_assignment(text, f"{name}=").strip("'")


def env_args(text: str | None, name: str) -> list[str]:
    """One argument assignment, split the way the shell starting the unit would split it, so a path
    with a space in it stays one argument."""
    return shlex.split(env_value(text, name))


def unit_field(text: str | None, field: str) -> str:
    """The value of a `Field=` line in a unit file, for the two fields that name a path:
    `EnvironmentFile` and `ExecStart`."""
    return _last_assignment(text, f"{field}=")


def _last_assignment(text: str | None, prefix: str) -> str:
    assignments = [
        line.strip()[len(prefix):].strip().strip('"')
        for line in (text or "").splitlines() if line.strip().startswith(prefix)
    ]
    return assignments[-1] if assignments else ""


def token_at(tokens: list[str], index: int) -> str:
    """The token at that position, or empty when the list is shorter. Every read here is of a file
    written by an installer we do not control, so a short list is an answer, not an error."""
    return tokens[index] if index < len(tokens) else ""


def flag_value(args: list[str], flag: str) -> str:
    """What follows `flag` in an argument list, or empty when the flag is absent."""
    return token_at(args, args.index(flag) + 1) if flag in args else ""


def positional_args(args: list[str]) -> list[str]:
    """The arguments that are neither a flag nor a flag's value: the script Klipper starts and the
    config it starts with."""
    after_flag = {index + 1 for index, token in enumerate(args) if token.startswith("-")}
    return [
        token for index, token in enumerate(args)
        if not token.startswith("-") and index not in after_flag
    ]


def venv_root(exec_start: str) -> str:
    """The virtualenv an `ExecStart=<env>/bin/python $ARGS` line runs out of, or empty when the
    unit starts something that is not a python in a venv."""
    interpreter = token_at(exec_start.split(), 0)
    if not interpreter.endswith(("python", "python3")):
        return ""
    return str(Path(interpreter).parent.parent)
