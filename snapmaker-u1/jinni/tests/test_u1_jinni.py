import json
from pathlib import Path

import bespok3d_jinni
from bespok3d_jinni import SnapmakerU1Jinni, make_jinni
from jinni import KlipperPrinterJinni

_PATHS_FILE = Path(bespok3d_jinni.__file__).resolve().parent / "paths.json"


def test_make_jinni_returns_the_u1_jinni() -> None:
    assert isinstance(make_jinni(), SnapmakerU1Jinni)


def test_u1_is_a_klipper_printer_jinni() -> None:
    assert isinstance(make_jinni(), KlipperPrinterJinni)


def test_paths_expose_the_u1_klipper_layout() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["KLIPPER_EXTRAS"] == "/home/lava/klipper/klippy/extras"
    assert paths["KLIPPER_SRC"] == "/home/lava/klipper/klippy"
    assert paths["RUNTIME_USER"] == "lava"


def test_paths_come_from_the_shared_paths_json() -> None:
    assert SnapmakerU1Jinni().paths() == json.loads(_PATHS_FILE.read_text())


def test_paths_expose_site_packages_and_service_logs() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["PYTHON_SITE_PACKAGES"] == "/usr/lib/python3.11/site-packages"
    assert paths["KLIPPER_LOG"] == "/oem/printer_data/logs/klippy.log"
    assert paths["MOONRAKER_LOG"] == "/oem/printer_data/logs/moonraker.log"


def test_capability_flags_advertise_overlay_managed_service_and_lmd_control() -> None:
    assert SnapmakerU1Jinni().capability_flags() == {"overlay", "managed-service", "lmd-control"}


def test_hardware_lists_the_u1_devices() -> None:
    assert SnapmakerU1Jinni().hardware() == ["camera-mipi", "rfid-spi", "npu-rknn"]


def test_render_service_script_uses_start_stop_daemon() -> None:
    service = {"name": "remote-screen", "command": "/usr/bin/python3", "args": ["-u", "fb.py"]}
    script = SnapmakerU1Jinni().render_service_script(service, {"BESPOK3D": "/userdata/bespok3d"})
    assert script.startswith("#!/bin/sh")
    assert "start-stop-daemon -S" in script
    assert "PIDFILE=/userdata/bespok3d/run/remote-screen.pid" in script
    assert "exec /usr/bin/python3 -u fb.py >>$LOG 2>&1" in script


def test_render_lmd_control_script_stops_with_sigkill_never_sigterm() -> None:
    script = SnapmakerU1Jinni().render_lmd_control_script({"BESPOK3D": "/userdata/bespok3d"})
    assert script.startswith("#!/bin/sh")
    assert "BESPOK3D=/userdata/bespok3d" in script
    assert "killall -9 unisrv lmd rkaiq_3A_" in script
    assert "kill -9" in script
    assert "card0-DPI-1" in script
    assert "/sys/class/graphics/fb0/blank" in script
    # SIGTERM (the crash trigger) must never appear in the lmd teardown path
    assert "start-stop-daemon -K" not in script
    assert "__BESPOK3D__" not in script
    # start delegates to the camera while its capture owns lmd, else starts plain lmd
    assert "s65camera-hw" in script
    assert "start-stop-daemon -S" in script
