"""Snapmaker U1 Jinni: the daemon-side half of the U1 adapter.

Shipped with the adapter and installed next to the daemon, which loads it via `make_jinni()`. It is
a klipper printer, so it extends `KlipperPrinterJinni` (the klipper path contract + facts) and
overrides only the genuinely U1-specific facts and service vocabulary. The logic-bearing concerns it
would otherwise mix in live in their own modules next to this one: wifi self-heal (wifi_watchdog),
service-script rendering (service_scripts), and failure diagnosis (device_health). This class is the
composition root: it declares the device's facts and wires those concerns to the contract methods.
"""
import json
import subprocess
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import service_scripts
from device_health import diagnose_broker
from jinni import KlipperPrinterJinni
from jinni.contracts import ControlScript, DeviceHealth
from wifi_watchdog import wifi_watchdog

# The single source of truth for the U1 path variables. Read here at runtime AND by the app-side
# client at enrollment; it deploys to the device with the rest of this jinni dir.
_PATHS_FILE = Path(__file__).resolve().parent / "paths.json"
_FIRMWARE_TIMEOUT_S = 3
JINNI_VERSION = "0.1.5"

# The U1's core-service restart commands, keyed by the generic hook a manifest declares. These are
# the device facts the daemon must not name itself; it asks the jinni via restart_command().
_RESTART_COMMANDS = {
    "klipper": "/etc/init.d/S60klipper restart",
    "moonraker": "/etc/init.d/S61moonraker restart",
    "web": "/usr/sbin/nginx -s reload",
    "lmd": "$BESPOK3D/etc/init.d/lmdctl restart",
}


class SnapmakerU1Jinni(KlipperPrinterJinni):
    id = "snapmaker-u1"

    def device_paths(self) -> dict[str, str]:
        paths: dict[str, str] = json.loads(_PATHS_FILE.read_text())
        return paths

    def hardware(self) -> list[str]:
        return ["camera-mipi", "rfid-spi", "npu-rknn"]

    def firmware_version(self) -> str:
        try:
            result = subprocess.run(
                ["cat", "/etc/FULLVERSION"],
                capture_output=True, text=True, timeout=_FIRMWARE_TIMEOUT_S, check=False,
            )
            raw = result.stdout.strip()
            return raw.split("_")[0] if raw else "unknown"
        except Exception:
            return "unknown"

    def version(self) -> str:
        return JINNI_VERSION

    def capability_flags(self) -> set[str]:
        return {"overlay", "managed-service", "lmd-control"}

    def restart_command(self, hook: str) -> str | None:
        return _RESTART_COMMANDS.get(hook)

    def deferred_service_markers(self) -> tuple[str, ...]:
        return ("init.d", "nginx")

    def display_service_tokens(self) -> tuple[str, ...]:
        return ("lmdctl",)

    def health(self) -> DeviceHealth:
        return diagnose_broker(super().health(), self.port_listening)

    def render_service_script(self, service: dict[str, Any], paths: dict[str, str]) -> str:
        return service_scripts.render_service_script(service, paths)

    def startup_control_scripts(self, paths: dict[str, str]) -> list[ControlScript]:
        return service_scripts.startup_control_scripts(paths)

    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return [wifi_watchdog()]


def make_jinni() -> SnapmakerU1Jinni:
    return SnapmakerU1Jinni()
