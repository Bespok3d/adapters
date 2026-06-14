"""Snapmaker U1 Jinni: the daemon-side half of the U1 adapter.

Shipped with the adapter and installed next to the daemon, which loads it via `make_jinni()`. It is
a klipper printer, so it extends `KlipperPrinterJinni` (which carries the klipper path contract and
the klipper facts: klipper version, moonraker probe, print state) and overrides only what is
genuinely U1-specific: its paths (from the co-located paths.json, the single source of truth shared
with the app-side client), hardware, firmware, the SysV init script, and the wifi watchdog.
"""
import asyncio
import json
import subprocess
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

from jinni import KlipperPrinterJinni

# The single source of truth for the U1 path variables. Read here at runtime AND by the app-side
# client at enrollment; it deploys to the device with the rest of this jinni dir.
_PATHS_FILE = Path(__file__).resolve().parent / "paths.json"
WIFI_CRED_SRC = Path("/oem/printer_data/gui/wpa_supplicant.conf")
WIFI_CRED_DST = Path("/etc/wpa_supplicant.conf")
WLAN_IFACE = "wlan0"
WATCHDOG_INTERVAL_S = 30
_FIRMWARE_TIMEOUT_S = 3
JINNI_VERSION = "0.1.1"

# The managed-service init script is a real, editable shell file next to this jinni; the jinni
# fills its __SENTINELS__ per service. To change the script, edit service.sh, not a python string.
_SERVICE_TEMPLATE = Path(__file__).resolve().parent / "service.sh"

# The hardened lmd/unisrv control script (SIGKILL teardown, never SIGTERM). Edit lmd-control.sh,
# not a python string; the daemon places the rendered result at $BESPOK3D/etc/init.d/lmdctl.
_LMD_CONTROL_TEMPLATE = Path(__file__).resolve().parent / "lmd-control.sh"


def _wlan_exists() -> bool:
    result = subprocess.run(["ip", "link", "show", WLAN_IFACE], capture_output=True, check=False)
    return result.returncode == 0


def _wlan_has_ip() -> bool:
    result = subprocess.run(
        ["ip", "-4", "addr", "show", WLAN_IFACE], capture_output=True, text=True, check=False,
    )
    return "inet " in result.stdout


def _restore_wifi() -> None:
    if WIFI_CRED_SRC.exists():
        src_text = WIFI_CRED_SRC.read_text()
        if "network=" in src_text:
            WIFI_CRED_DST.write_text(src_text)
    subprocess.run(["ifdown", WLAN_IFACE], capture_output=True, check=False)
    subprocess.run(["ifup", WLAN_IFACE], capture_output=True, check=False)


def _check_and_heal() -> None:
    if _wlan_exists() and not _wlan_has_ip():
        _restore_wifi()


async def wifi_watchdog() -> None:
    while True:
        await asyncio.to_thread(_check_and_heal)
        await asyncio.sleep(WATCHDOG_INTERVAL_S)


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

    def render_service_script(self, service: dict, paths: dict[str, str]) -> str:
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

    def render_lmd_control_script(self, paths: dict[str, str]) -> str:
        return _LMD_CONTROL_TEMPLATE.read_text().replace("__BESPOK3D__", paths["BESPOK3D"])

    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return [wifi_watchdog()]


def make_jinni() -> SnapmakerU1Jinni:
    return SnapmakerU1Jinni()
