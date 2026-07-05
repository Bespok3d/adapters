import json
import subprocess
from pathlib import Path

import bespok3d_jinni
import pytest
from bespok3d_jinni import SnapmakerU1Jinni, make_jinni
from device_health import BROKER_DOWN

from jinni import KlipperPrinterJinni
from jinni.klipper_vocab import KLIPPER_SERVICE, RESTART_DISPLAY
from protocol import DeviceHealth, ServiceHealth

_PATHS_FILE = Path(bespok3d_jinni.__file__).resolve().parent / "paths.json"
_VERSION_FILE = Path(bespok3d_jinni.__file__).resolve().parent / "version.json"
_EXECUTABLE_MODE = 0o755


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


def test_version_comes_from_the_shared_version_json() -> None:
    assert make_jinni().version() == json.loads(_VERSION_FILE.read_text())["jinni_version"]


def test_version_is_not_a_module_constant() -> None:
    assert not hasattr(bespok3d_jinni, "JINNI_VERSION")


def test_paths_expose_site_packages_and_service_logs() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["PYTHON_SITE_PACKAGES"] == "/usr/lib/python3.11/site-packages"
    assert paths["KLIPPER_LOG"] == "/oem/printer_data/logs/klippy.log"
    assert paths["MOONRAKER_LOG"] == "/oem/printer_data/logs/moonraker.log"


def test_capability_flags_advertise_the_u1_supported_mechanisms() -> None:
    assert SnapmakerU1Jinni().capability_flags() == {
        "overlay", "managed-service", "lmd-control", "kernel-modules"
    }


def test_restart_command_maps_each_hook_to_a_u1_command() -> None:
    u1 = SnapmakerU1Jinni()
    assert u1.restart_command("klipper") == "/etc/init.d/S60klipper restart"
    assert u1.restart_command("moonraker") == "/etc/init.d/S61moonraker restart"
    assert u1.restart_command("web") == "/usr/sbin/nginx -s reload"
    assert u1.restart_command("lmd") == "$BESPOK3D/etc/init.d/lmdctl restart"


def test_restart_command_is_none_for_an_unknown_hook() -> None:
    assert SnapmakerU1Jinni().restart_command("database") is None


def test_classify_commands_uses_the_u1_display_and_service_tokens() -> None:
    u1 = SnapmakerU1Jinni()
    assert u1.deferred_service_markers() == ("init.d", "nginx")
    assert u1.display_service_tokens() == ("lmdctl",)
    klipper, lmd, config_gen = u1.classify_commands([
        "/etc/init.d/S60klipper restart",
        "$BESPOK3D/etc/init.d/lmdctl restart",
        "chown lava:lava /b/spoolman.cfg",
    ])
    assert KLIPPER_SERVICE in klipper.restarts_services and klipper.deferrable
    assert lmd.blocking_token == RESTART_DISPLAY and KLIPPER_SERVICE not in lmd.restarts_services
    assert not config_gen.deferrable


def _klipper_report(ready: bool) -> DeviceHealth:
    return DeviceHealth(services={KLIPPER_SERVICE: ServiceHealth(ready=ready, detail="")})


def test_health_diagnoses_a_down_broker_with_a_token_not_prose(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    u1 = SnapmakerU1Jinni()
    monkeypatch.setattr(KlipperPrinterJinni, "health", lambda _self: _klipper_report(ready=False))
    monkeypatch.setattr(u1, "port_listening", lambda _port: False)  # broker on 1883 is down
    report = u1.health()
    assert report.diagnosis == BROKER_DOWN
    assert " " not in report.diagnosis  # a machine token, not a sentence (the app localizes it)


def test_health_does_not_diagnose_a_broker_when_klipper_is_up(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    u1 = SnapmakerU1Jinni()
    monkeypatch.setattr(KlipperPrinterJinni, "health", lambda _self: _klipper_report(ready=True))
    monkeypatch.setattr(u1, "port_listening", lambda _port: False)
    assert u1.health().diagnosis == ""


def test_hardware_lists_the_u1_devices() -> None:
    assert SnapmakerU1Jinni().hardware() == ["camera-mipi", "rfid-spi", "npu-rknn"]


def test_arch_is_aarch64() -> None:
    assert SnapmakerU1Jinni().arch() == "aarch64"


def test_board_class_delegates_to_the_board_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(bespok3d_jinni.board, "board_class", lambda: "constrained")
    assert SnapmakerU1Jinni().board_class() == "constrained"


def test_variant_facts_report_the_u1_selection_dimensions() -> None:
    facts = SnapmakerU1Jinni().variant_facts()
    assert facts["adapter"] == "snapmaker-u1"
    assert facts["arch"] == "aarch64"
    assert set(facts) == {
        "adapter", "firmware_version", "arch", "board_class", "kernel_release", "vermagic"
    }


def test_kernel_release_reads_uname(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        bespok3d_jinni.subprocess, "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args, 0, stdout="6.1.99\n", stderr=""),
    )
    assert SnapmakerU1Jinni().kernel_release() == "6.1.99"


def test_kernel_release_is_unknown_when_uname_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def boom(*args: object, **kwargs: object) -> object:
        raise OSError("uname unavailable")

    monkeypatch.setattr(bespok3d_jinni.subprocess, "run", boom)
    assert SnapmakerU1Jinni().kernel_release() == "unknown"


def test_kernel_vermagic_reads_a_loaded_module_via_modinfo(monkeypatch: pytest.MonkeyPatch) -> None:
    magic = "6.1.99 SMP preempt mod_unload aarch64"
    monkeypatch.setattr(bespok3d_jinni.kernel_facts, "running_vermagic", lambda: magic)
    assert SnapmakerU1Jinni().kernel_vermagic() == magic


def test_kernel_capability_fact_derives_release_from_the_version_magic(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        bespok3d_jinni.kernel_facts, "running_vermagic",
        lambda: "6.1.99 SMP preempt mod_unload aarch64",
    )
    kernel = SnapmakerU1Jinni().capabilities()["kernel"]
    assert kernel == {"release": "6.1.99", "vermagic": "6.1.99 SMP preempt mod_unload aarch64"}


def test_render_service_script_uses_start_stop_daemon() -> None:
    service = {"name": "remote-screen", "command": "/usr/bin/python3", "args": ["-u", "fb.py"]}
    script = SnapmakerU1Jinni().render_service_script(service, {"BESPOK3D": "/userdata/bespok3d"})
    assert script.startswith("#!/bin/sh")
    assert "start-stop-daemon -S" in script
    assert "PIDFILE=/userdata/bespok3d/run/remote-screen.pid" in script
    assert "exec /usr/bin/python3 -u fb.py >>$LOG 2>&1" in script


def test_render_module_script_mknods_the_nodes_and_insmods_the_module() -> None:
    kmodule = {"name": "tun", "module": "tun.ko", "device_nodes": ["/dev/net/tun c 10 200"]}
    script = SnapmakerU1Jinni().render_module_script(kmodule, {"BESPOK3D": "/userdata/bespok3d"})
    assert script.startswith("#!/bin/sh")
    assert "MODULE=/userdata/bespok3d/lib/modules/tun.ko" in script
    assert "NAME=tun" in script
    assert 'insmod "$MODULE"' in script
    assert "mkdir -p /dev/net && mknod /dev/net/tun c 10 200" in script
    assert "__MODULE__" not in script and "__MKNODS__" not in script


def test_render_module_script_with_no_device_nodes_still_loads() -> None:
    script = SnapmakerU1Jinni().render_module_script(
        {"name": "8733bs", "module": "8733bs.ko", "device_nodes": []},
        {"BESPOK3D": "/userdata/bespok3d"},
    )
    assert "mknod" not in script
    assert "MODULE=/userdata/bespok3d/lib/modules/8733bs.ko" in script


def test_render_module_script_normalizes_a_hyphen_to_the_in_kernel_name() -> None:
    # the kernel loads foo-bar.ko as `foo_bar`, so is_loaded/rmmod must use the underscore form
    script = SnapmakerU1Jinni().render_module_script(
        {"name": "foo-bar", "module": "foo-bar.ko"}, {"BESPOK3D": "/userdata/bespok3d"}
    )
    assert "NAME=foo_bar" in script
    assert "foo-bar" not in script.replace("foo-bar.ko", "")  # only the .ko filename keeps the dash


def test_startup_control_scripts_render_the_lmdctl_script() -> None:
    scripts = SnapmakerU1Jinni().startup_control_scripts({"BESPOK3D": "/userdata/bespok3d"})
    assert len(scripts) == 1
    lmdctl = scripts[0]
    assert lmdctl.path == "/userdata/bespok3d/etc/init.d/lmdctl"
    assert lmdctl.mode == _EXECUTABLE_MODE
    script = lmdctl.content
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
    # restart re-bounces a bounded number of times if the display does not come back healthy, so an
    # intermittent VOP2 wedge during a multi-install does not leave the screen black until reboot
    assert "RESTART_TRIES=3" in script
    assert "do_restart()" in script
    assert "restart) do_restart" in script
    assert "re-bouncing" in script
