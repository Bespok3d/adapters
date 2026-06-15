"""Render the U1's service shell scripts from the editable templates next to this module.

Two scripts: the SysV init script for a managed plugin service, and the hardened lmd/unisrv control
script the daemon places at startup. Template-fill only: the scripts are real shell files
(service.sh, lmd-control.sh) edited as shell, never as python strings.
"""
from pathlib import Path
from typing import Any

from jinni.contracts import ControlScript

_SERVICE_TEMPLATE = Path(__file__).resolve().parent / "service.sh"
_LMD_CONTROL_TEMPLATE = Path(__file__).resolve().parent / "lmd-control.sh"


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


def startup_control_scripts(paths: dict[str, str]) -> list[ControlScript]:
    data_root = paths["BESPOK3D"]
    content = _LMD_CONTROL_TEMPLATE.read_text().replace("__BESPOK3D__", data_root)
    return [ControlScript(path=f"{data_root}/etc/init.d/lmdctl", content=content, mode=0o755)]
