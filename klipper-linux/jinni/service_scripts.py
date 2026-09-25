# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Render a managed plugin service's init script from the editable template next to this module.

Template fill only: service.sh is a real shell file, edited as shell and never as a python string,
so the script a printer runs is the script a reviewer read. The host's own services (Klipper,
Moonraker, nginx, the daemon) are systemd's; this is only for the services a plugin declares, which
run unprivileged under the bespok3d-plugins unit.
"""
from pathlib import Path
from typing import Any

_SERVICE_TEMPLATE = Path(__file__).resolve().parent / "service.sh"


def render_service_script(service: dict[str, Any], paths: dict[str, str]) -> str:
    name = service["name"]
    data_root = paths["BESPOK3D"]
    exec_line = " ".join([service["command"], *service.get("args", [])]).strip()
    return (
        _SERVICE_TEMPLATE.read_text()
        .replace("__PIDFILE__", f"{data_root}/run/{name}.pid")
        .replace("__LOG__", f"{data_root}/var/log/{name}.log")
        .replace("__EXEC__", exec_line)
        .replace("__NAME__", name)
    )
