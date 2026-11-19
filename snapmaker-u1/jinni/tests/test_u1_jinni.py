# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
import json
import subprocess
from pathlib import Path

import bespok3d_jinni
import pytest
from bespok3d_jinni import SnapmakerU1Jinni, make_jinni
from device_health import BROKER_DOWN
from screen_stuck import SCREEN_STUCK

from jinni import KlipperPrinterJinni
from jinni.include_lines import WIRED_CONFIGS, WiredConfig
from jinni.klipper_vocab import KLIPPER_SERVICE, RESTART_DISPLAY
from protocol import DeviceHealth, ServiceHealth

_PATHS_FILE = Path(bespok3d_jinni.__file__).resolve().parent / "paths.json"
_VERSION_FILE = Path(bespok3d_jinni.__file__).resolve().parent / "version.json"
_EXECUTABLE_MODE = 0o755
_SLEEP_AND_WAKE_LOG = (
    "[  610.204511] rockchip-vop2 ff400000.vop: *ERROR* wait win close timeout\n"
    "[  611.204617] rockchip-vop2 ff400000.vop: *ERROR* wait for vp0 dsp_hold timeout\n"
)
_STUCK_SCREEN_LINE = (
    "[  612.304702] rockchip-vop2 ff400000.vop: [drm:vop2_crtc_atomic_flush] *ERROR* vp0 failed to"
    " attach dma mapping, -16"
)


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
    # Firmware 2.0 and later log here; earlier firmware logs to the second path.
    assert paths["KLIPPER_LOG"] == "/oem/klippylogs/klippy.log:/oem/printer_data/logs/klippy.log"
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


def _kernel_log_reads(monkeypatch: pytest.MonkeyPatch, ring_buffer: str) -> None:
    monkeypatch.setattr(bespok3d_jinni.screen_stuck.kernel_log, "ring_buffer", lambda: ring_buffer)


def test_a_screen_that_went_to_sleep_is_never_reported_as_needing_a_power_cycle(
    monkeypatch: pytest.MonkeyPatch, stuck_latch: Path,
) -> None:
    """The U1's screen blanks itself after a few idle minutes, and the kernel prints its display
    warnings on that ordinary blank and again on the ordinary wake. Reading those as a dead screen
    accused a perfectly healthy printer every single time it dimmed."""
    _kernel_log_reads(monkeypatch, _SLEEP_AND_WAKE_LOG)
    assert SnapmakerU1Jinni().reboot_required() == []


def test_a_live_stuck_screen_line_is_named_and_then_reported(
    monkeypatch: pytest.MonkeyPatch, stuck_latch: Path,
) -> None:
    jinni = SnapmakerU1Jinni()
    _kernel_log_reads(monkeypatch, _SLEEP_AND_WAKE_LOG)
    assert jinni.watch_line(_SLEEP_AND_WAKE_LOG.splitlines()[0]) is None
    assert jinni.watch_line(_STUCK_SCREEN_LINE) == SCREEN_STUCK
    assert jinni.reboot_required() == [SCREEN_STUCK]


def test_paths_name_the_firmware_copies_the_boot_restores_the_configs_from() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["PRINTER_CFG_ORIGIN"] == "/home/lava/origin_printer_data/config/printer.cfg"
    assert paths["MOONRAKER_CFG_ORIGIN"] == "/home/lava/origin_printer_data/config/moonraker.conf"


# The real paths.json names /oem files. A test that does not set up the newer mainboard's config or
# a marker that stops the boot restore points it at a missing file, so it never reads or writes a
# real printer's files.
_NEWER_MAINBOARD_KEYS = ("PRINTER_V2_CFG", "PRINTER_V2_CFG_ORIGIN")
_RESTORE_MARKER_KEYS = ("ADVANCED_MODE_MARKER", "FACTORY_MARKER")
_KEYS_KEPT_OFF_THE_PRINTER = (*_NEWER_MAINBOARD_KEYS, *_RESTORE_MARKER_KEYS)


def _u1_with_configs(monkeypatch: pytest.MonkeyPatch, config_paths: dict[str, Path]) -> None:
    shared_paths = json.loads(_PATHS_FILE.read_text())
    absent_config = config_paths["PRINTER_CFG"].parent / "no-such-config"
    test_paths = ({key: str(absent_config) for key in _KEYS_KEPT_OFF_THE_PRINTER}
                  | {key: str(path) for key, path in config_paths.items()})
    monkeypatch.setattr(SnapmakerU1Jinni, "device_paths", lambda _self: shared_paths | test_paths)


def test_config_copies_add_the_firmware_copy_the_boot_restores_from(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_printer_cfg = tmp_path / "printer.cfg"
    origin_printer_cfg = tmp_path / "origin_printer.cfg"
    origin_printer_cfg.write_text("[printer]\n")
    _u1_with_configs(monkeypatch, {"PRINTER_CFG": live_printer_cfg,
                                   "PRINTER_CFG_ORIGIN": origin_printer_cfg})

    assert SnapmakerU1Jinni().config_copies("PRINTER_CFG") == [live_printer_cfg, origin_printer_cfg]


def test_config_copies_leave_out_a_firmware_copy_this_firmware_lacks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    live_printer_cfg = tmp_path / "printer.cfg"
    _u1_with_configs(monkeypatch, {"PRINTER_CFG": live_printer_cfg,
                                   "PRINTER_CFG_ORIGIN": tmp_path / "missing" / "printer.cfg"})

    assert SnapmakerU1Jinni().config_copies("PRINTER_CFG") == [live_printer_cfg]


_LIVE_CONFIG_FILES = {"PRINTER_CFG": "printer.cfg", "MOONRAKER_CFG": "moonraker.conf"}


def _stock_live_and_origin_configs(tmp_path: Path) -> dict[str, Path]:
    (tmp_path / "live").mkdir()
    (tmp_path / "origin").mkdir()
    config_paths = {
        **{key: tmp_path / "live" / name for key, name in _LIVE_CONFIG_FILES.items()},
        **{f"{key}_ORIGIN": tmp_path / "origin" / name for key, name in _LIVE_CONFIG_FILES.items()},
    }
    for config in config_paths.values():
        config.write_text("[stock]\n")
    return config_paths


def test_restored_includes_survive_the_boot_putting_the_firmware_copy_back(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """What S48setup-lava-env does on firmware 2.0: a live config that differs from its copy is
    overwritten by the copy. With the line in both, the copy it puts back still carries it."""
    config_paths = _stock_live_and_origin_configs(tmp_path)
    _u1_with_configs(monkeypatch, config_paths)

    SnapmakerU1Jinni().restore_bespok3d_includes()
    for live_key in _LIVE_CONFIG_FILES:
        config_paths[live_key].write_text(config_paths[f"{live_key}_ORIGIN"].read_text())

    assert SnapmakerU1Jinni().bespok3d_include_status() == {
        "printer.cfg": True, "moonraker.conf": True,
    }


def _stock_configs_on_a_printer_whose_boot_skips_the_restore(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, marker_key: str,
) -> dict[str, Path]:
    config_paths = _stock_live_and_origin_configs(tmp_path)
    config_paths[marker_key] = tmp_path / "marker"
    config_paths[marker_key].touch()
    _u1_with_configs(monkeypatch, config_paths)
    return config_paths


@pytest.mark.parametrize("marker_key", _RESTORE_MARKER_KEYS)
def test_origin_copies_without_the_line_do_not_flag_a_printer_whose_boot_never_restores_them(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, marker_key: str,
) -> None:
    """S48setup-lava-env skips the restore when Advanced mode (enrollment turns it on) or the
    factory marker is on, so only the live configs load bespok3d there."""
    config_paths = _stock_configs_on_a_printer_whose_boot_skips_the_restore(
        tmp_path, monkeypatch, marker_key)
    for wired in WIRED_CONFIGS:
        config_paths[wired.path_key].write_text(f"[stock]\n{wired.include_line}\n")

    assert SnapmakerU1Jinni().bespok3d_include_status() == {
        "printer.cfg": True, "moonraker.conf": True,
    }


def test_a_folder_at_the_marker_path_does_not_stop_the_boot_restoring_the_backup_copies(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """S48setup-lava-env tests the markers with [ -f ], so only a file stops the restore."""
    config_paths = _stock_live_and_origin_configs(tmp_path)
    config_paths["ADVANCED_MODE_MARKER"] = tmp_path / "marker-folder"
    config_paths["ADVANCED_MODE_MARKER"].mkdir()
    _u1_with_configs(monkeypatch, config_paths)
    config_paths["PRINTER_CFG"].write_text(f"[stock]\n{_PRINTER_CFG_WIRING.include_line}\n")

    assert SnapmakerU1Jinni().bespok3d_include_status()["printer.cfg"] is False


def test_restoring_the_includes_still_wires_the_origin_copies_the_boot_skips(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_paths = _stock_configs_on_a_printer_whose_boot_skips_the_restore(
        tmp_path, monkeypatch, "ADVANCED_MODE_MARKER")

    SnapmakerU1Jinni().restore_bespok3d_includes()

    assert _PRINTER_CFG_WIRING.include_line in config_paths["PRINTER_CFG_ORIGIN"].read_text()


def test_switching_bespok3d_off_still_unwires_the_origin_copies_the_boot_skips(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_paths = _stock_configs_on_a_printer_whose_boot_skips_the_restore(
        tmp_path, monkeypatch, "ADVANCED_MODE_MARKER")
    SnapmakerU1Jinni().restore_bespok3d_includes()

    SnapmakerU1Jinni().remove_bespok3d_includes()

    assert _PRINTER_CFG_WIRING.include_line not in config_paths["PRINTER_CFG_ORIGIN"].read_text()


def test_paths_name_the_markers_that_stop_the_boot_restoring_the_backup_copies() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["ADVANCED_MODE_MARKER"] == "/oem/printer_data/.fluidd"
    assert paths["FACTORY_MARKER"] == "/oem/.factory"


def test_paths_name_the_config_the_newer_mainboard_starts_klipper_on() -> None:
    paths = SnapmakerU1Jinni().paths()
    assert paths["PRINTER_V2_CFG"] == "/oem/printer_data/config/printer_v2.cfg"
    assert paths["PRINTER_V2_CFG_ORIGIN"] == "/home/lava/origin_printer_data/config/printer_v2.cfg"


def _stock_configs_with_the_newer_mainboard_config(tmp_path: Path) -> dict[str, Path]:
    config_paths = _stock_live_and_origin_configs(tmp_path)
    config_paths["PRINTER_V2_CFG"] = tmp_path / "live" / "printer_v2.cfg"
    config_paths["PRINTER_V2_CFG_ORIGIN"] = tmp_path / "origin" / "printer_v2.cfg"
    config_paths["PRINTER_V2_CFG"].write_text("[stock]\n")
    config_paths["PRINTER_V2_CFG_ORIGIN"].write_text("[stock]\n")
    return config_paths


def test_config_copies_add_the_config_the_newer_mainboard_starts_klipper_on(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_paths = _stock_configs_with_the_newer_mainboard_config(tmp_path)
    _u1_with_configs(monkeypatch, config_paths)

    assert SnapmakerU1Jinni().config_copies("PRINTER_CFG") == [
        config_paths["PRINTER_CFG"], config_paths["PRINTER_CFG_ORIGIN"],
        config_paths["PRINTER_V2_CFG"], config_paths["PRINTER_V2_CFG_ORIGIN"],
    ]


_PRINTER_CFG_WIRING = next(wired for wired in WIRED_CONFIGS if wired.path_key == "PRINTER_CFG")


def _wire_live_and_origin(config_paths: dict[str, Path], wired: WiredConfig) -> None:
    for path_key in (wired.path_key, f"{wired.path_key}_ORIGIN"):
        config_paths[path_key].write_text(f"[stock]\n{wired.include_line}\n")


def test_a_newer_mainboard_config_without_the_line_counts_as_unwired(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A printer on the gd32h757 board starts klipper on printer_v2.cfg and never reads
    printer.cfg, so printer.cfg alone carrying the line still loads no plugin there."""
    config_paths = _stock_configs_with_the_newer_mainboard_config(tmp_path)
    _u1_with_configs(monkeypatch, config_paths)
    for wired in WIRED_CONFIGS:
        _wire_live_and_origin(config_paths, wired)

    assert SnapmakerU1Jinni().bespok3d_include_status()["printer.cfg"] is False


def test_restoring_the_includes_wires_the_newer_mainboard_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_paths = _stock_configs_with_the_newer_mainboard_config(tmp_path)
    _u1_with_configs(monkeypatch, config_paths)

    SnapmakerU1Jinni().restore_bespok3d_includes()

    assert _PRINTER_CFG_WIRING.include_line in config_paths["PRINTER_V2_CFG"].read_text()
    assert _PRINTER_CFG_WIRING.include_line in config_paths["PRINTER_V2_CFG_ORIGIN"].read_text()


def test_switching_bespok3d_off_unwires_the_newer_mainboard_config(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    config_paths = _stock_configs_with_the_newer_mainboard_config(tmp_path)
    _u1_with_configs(monkeypatch, config_paths)
    SnapmakerU1Jinni().restore_bespok3d_includes()

    SnapmakerU1Jinni().remove_bespok3d_includes()

    assert _PRINTER_CFG_WIRING.include_line not in config_paths["PRINTER_V2_CFG"].read_text()
    assert _PRINTER_CFG_WIRING.include_line not in config_paths["PRINTER_V2_CFG_ORIGIN"].read_text()
