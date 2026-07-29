# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Render the U1's kernel-module loader script from the editable template next to this module.

The loader is a real shell file (module-loader.sh) edited as shell, never as python strings; the
jinni fills the __SENTINELS__ per module. It mknods the module's declared device nodes, insmods the
placed .ko (under the bespok3d modules dir), and rmmods on stop. insmod/mknod/rmmod are the device
realm, so this rendering is the U1 jinni's, not the daemon's (ADR-0037).
"""
from pathlib import Path, PurePosixPath
from typing import Any

_MODULE_TEMPLATE = Path(__file__).resolve().parent / "module-loader.sh"


def render_module_script(kmodule: dict[str, Any], paths: dict[str, str]) -> str:
    data_root = paths["BESPOK3D"]
    module_path = f"{data_root}/lib/modules/{kmodule['module']}"
    return (
        _MODULE_TEMPLATE.read_text()
        .replace("__MODULE__", module_path)
        .replace("__NAME__", _in_kernel_name(kmodule["name"]))
        .replace("__MKNODS__", _mknod_block(kmodule.get("device_nodes", [])))
    )


def _in_kernel_name(name: str) -> str:
    """The name `lsmod`/`/proc/modules` shows and `rmmod` takes: the kernel normalizes a hyphen to
    an underscore, so `foo-bar.ko` loads as `foo_bar`. Match that, so is_loaded and rmmod hit."""
    return name.replace("-", "_")


def _mknod_block(device_nodes: list[str]) -> str:
    return "\n".join(_mknod_line(node) for node in device_nodes)


def _mknod_line(node: str) -> str:
    """One idempotent mknod for a `<path> <type> <major> <minor>` device-node spec, creating the
    parent dir first so a node under a not-yet-present dir (e.g. /dev/net/tun) still lands."""
    path = node.split()[0]
    parent = PurePosixPath(path).parent
    return f"[ -e {path} ] || {{ mkdir -p {parent} && mknod {node}; }}"
