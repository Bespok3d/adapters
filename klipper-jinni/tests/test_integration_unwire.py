# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The bespok3d-into-klipper integration unwire (ADR-0037): remove the include lines from the
printer's own config, prune the bespok3d include dirs, and self-heal dead include links.

Enrollment writes the includes client-side and the daemon never edits the device config, so removing
them is the jinni's. These guard the include removal, the user-file-preserving config-dir prune that
teardown relies on, and the dead-link self-heal that gets a service back up after a stale uninstall.
"""
from pathlib import Path

from jinni.klipper import KLIPPER_PATH_KEYS, KlipperPrinterJinni


class _Jinni(KlipperPrinterJinni):
    def __init__(self, paths: dict[str, str]) -> None:
        self._paths = {key: f"/dev/null/{key}" for key in KLIPPER_PATH_KEYS} | paths

    def device_paths(self) -> dict[str, str]:
        return self._paths


def test_remove_bespok3d_includes_drops_only_our_lines(tmp_path: Path) -> None:
    printer_cfg = tmp_path / "printer.cfg"
    moonraker_cfg = tmp_path / "moonraker.conf"
    printer_cfg.write_text("[include bespok3d/klipper/main.cfg]\n[printer]\nfoo: 1\n")
    moonraker_cfg.write_text("[include bespok3d/moonraker/main.cfg]\n[server]\n")
    jinni = _Jinni({"PRINTER_CFG": str(printer_cfg), "MOONRAKER_CFG": str(moonraker_cfg)})

    jinni.remove_bespok3d_includes()

    assert "bespok3d/klipper" not in printer_cfg.read_text()
    assert "[printer]" in printer_cfg.read_text()
    assert "foo: 1" in printer_cfg.read_text()
    assert "bespok3d/moonraker" not in moonraker_cfg.read_text()


def test_prune_config_dir_preserves_user_files_but_takes_back_links(tmp_path: Path) -> None:
    klipper = tmp_path / "config" / "bespok3d" / "klipper"
    klipper.mkdir(parents=True)
    target = tmp_path / "userdata" / "spoolman.cfg"
    target.parent.mkdir(parents=True)
    target.write_text("generated")
    (klipper / "spoolman.cfg").symlink_to(target)
    (klipper / "my-overrides.cfg").write_text("user stuff")

    _Jinni({"BESPOK3D_KLIPPER": str(klipper)}).prune_bespok3d_config_dir()

    assert not (klipper / "spoolman.cfg").is_symlink()
    assert (klipper / "my-overrides.cfg").read_text() == "user stuff"
    assert (tmp_path / "config" / "bespok3d").is_dir()


def test_prune_config_dir_removes_dir_when_only_our_links(tmp_path: Path) -> None:
    klipper = tmp_path / "config" / "bespok3d" / "klipper"
    klipper.mkdir(parents=True)
    target = tmp_path / "userdata" / "rfid.cfg"
    target.parent.mkdir(parents=True)
    target.write_text("x")
    (klipper / "rfid.cfg").symlink_to(target)

    _Jinni({"BESPOK3D_KLIPPER": str(klipper)}).prune_bespok3d_config_dir()

    assert not (tmp_path / "config" / "bespok3d").exists()


def test_prune_dead_config_links_removes_only_broken_links(tmp_path: Path) -> None:
    config_dir = tmp_path / "moonraker"
    config_dir.mkdir()
    real_target = tmp_path / "real.cfg"
    real_target.write_text("[spoolman]\n")
    (config_dir / "live.cfg").symlink_to(real_target)
    dead_link = config_dir / "gone.cfg"
    dead_link.symlink_to(tmp_path / "missing.cfg")
    jinni = _Jinni({"BESPOK3D_KLIPPER": str(tmp_path / "empty"),
                    "BESPOK3D_MOONRAKER": str(config_dir)})

    removed = jinni.prune_dead_config_links()

    assert removed == [str(dead_link)]
    assert not dead_link.is_symlink()
    assert (config_dir / "live.cfg").is_symlink()


def test_restore_includes_puts_our_lines_above_the_save_config_block(tmp_path: Path) -> None:
    printer_cfg = tmp_path / "printer.cfg"
    moonraker_cfg = tmp_path / "moonraker.conf"
    printer_cfg.write_text(
        "[printer]\nfoo: 1\n#*# <---------------------- SAVE_CONFIG\n#*# [bed_mesh]\n"
    )
    moonraker_cfg.write_text("[server]\n")
    jinni = _Jinni({"PRINTER_CFG": str(printer_cfg), "MOONRAKER_CFG": str(moonraker_cfg)})

    jinni.restore_bespok3d_includes()

    restored = printer_cfg.read_text()
    assert "[include bespok3d/klipper/*.cfg]" in restored
    assert restored.index("bespok3d/klipper") < restored.index("SAVE_CONFIG")
    assert "[include bespok3d/moonraker/*.cfg]" in moonraker_cfg.read_text()


def test_restore_includes_is_idempotent(tmp_path: Path) -> None:
    printer_cfg = tmp_path / "printer.cfg"
    moonraker_cfg = tmp_path / "moonraker.conf"
    printer_cfg.write_text("[include bespok3d/klipper/*.cfg]\n[printer]\n")
    moonraker_cfg.write_text("[include bespok3d/moonraker/*.cfg]\n[server]\n")
    jinni = _Jinni({"PRINTER_CFG": str(printer_cfg), "MOONRAKER_CFG": str(moonraker_cfg)})

    jinni.restore_bespok3d_includes()
    jinni.restore_bespok3d_includes()

    assert printer_cfg.read_text().count("bespok3d/klipper") == 1
    assert moonraker_cfg.read_text().count("bespok3d/moonraker") == 1


def test_switching_off_and_back_on_never_grows_the_config(tmp_path: Path) -> None:
    """Switching bespok3d off and on again leaves the printer's config byte for byte as it was.

    The blank line above the include used to be added rather than written, so every round trip
    left one more empty line behind and the include drifted down the file.
    """
    printer_cfg = tmp_path / "printer.cfg"
    moonraker_cfg = tmp_path / "moonraker.conf"
    printer_cfg.write_text(
        "[printer]\nfoo: 1\n\n#*# <---------------------- SAVE_CONFIG\n#*# [bed_mesh]\n"
    )
    moonraker_cfg.write_text("[server]\n")
    jinni = _Jinni({"PRINTER_CFG": str(printer_cfg), "MOONRAKER_CFG": str(moonraker_cfg)})

    jinni.restore_bespok3d_includes()
    after_first_switch_on = (printer_cfg.read_text(), moonraker_cfg.read_text())
    jinni.remove_bespok3d_includes()
    jinni.restore_bespok3d_includes()
    jinni.remove_bespok3d_includes()
    jinni.restore_bespok3d_includes()

    assert (printer_cfg.read_text(), moonraker_cfg.read_text()) == after_first_switch_on
    assert "\n\n\n" not in printer_cfg.read_text()
    assert "\n\n\n" not in moonraker_cfg.read_text()


class _JinniWithFirmwareCopies(_Jinni):
    """A device whose firmware puts its own copy of each config back over the live one on boot."""

    def __init__(self, paths: dict[str, str], firmware_copies: dict[str, Path]) -> None:
        super().__init__(paths)
        self._firmware_copies = firmware_copies

    def config_copies(self, path_key: str) -> list[Path]:
        return [*super().config_copies(path_key), self._firmware_copies[path_key]]


def _live_and_firmware_configs(tmp_path: Path) -> tuple[_JinniWithFirmwareCopies, list[Path]]:
    live = tmp_path / "live"
    origin = tmp_path / "origin"
    live.mkdir()
    origin.mkdir()
    for config_dir in (live, origin):
        (config_dir / "printer.cfg").write_text(
            "[printer]\n#*# <---------------------- SAVE_CONFIG\n#*# [bed_mesh]\n"
        )
        (config_dir / "moonraker.conf").write_text("[server]\n")
    jinni = _JinniWithFirmwareCopies(
        {"PRINTER_CFG": str(live / "printer.cfg"), "MOONRAKER_CFG": str(live / "moonraker.conf")},
        {"PRINTER_CFG": origin / "printer.cfg", "MOONRAKER_CFG": origin / "moonraker.conf"},
    )
    every_config = [config_dir / name for config_dir in (live, origin)
                    for name in ("printer.cfg", "moonraker.conf")]
    return jinni, every_config


def test_restore_includes_writes_the_firmware_copy_too(tmp_path: Path) -> None:
    """A firmware that puts its copy back over the live config on boot undoes a live-only line."""
    jinni, every_config = _live_and_firmware_configs(tmp_path)

    jinni.restore_bespok3d_includes()

    assert [cfg.name for cfg in every_config if "[include bespok3d/" not in cfg.read_text()] == []


def test_remove_includes_takes_the_line_out_of_the_firmware_copy_too(tmp_path: Path) -> None:
    """Switched off means gone: a line left in the copy comes back into the live config on boot."""
    jinni, every_config = _live_and_firmware_configs(tmp_path)
    jinni.restore_bespok3d_includes()

    jinni.remove_bespok3d_includes()

    assert [cfg.name for cfg in every_config if "bespok3d" in cfg.read_text()] == []


def test_status_reports_a_config_whose_firmware_copy_lacks_the_line(tmp_path: Path) -> None:
    """Live lines alone are not a wired printer: the next boot puts the copy without them back."""
    jinni, every_config = _live_and_firmware_configs(tmp_path)
    jinni.restore_bespok3d_includes()
    origin_printer_cfg = every_config[2]
    origin_printer_cfg.write_text("[printer]\n")

    assert jinni.bespok3d_include_status() == {"printer.cfg": False, "moonraker.conf": True}


def test_a_device_without_firmware_copies_wires_only_the_live_configs(tmp_path: Path) -> None:
    printer_cfg = tmp_path / "printer.cfg"
    moonraker_cfg = tmp_path / "moonraker.conf"
    printer_cfg.write_text("[printer]\n")
    moonraker_cfg.write_text("[server]\n")
    jinni = _Jinni({"PRINTER_CFG": str(printer_cfg), "MOONRAKER_CFG": str(moonraker_cfg)})

    jinni.restore_bespok3d_includes()

    assert jinni.config_copies("PRINTER_CFG") == [printer_cfg]
    assert jinni.bespok3d_include_status() == {"printer.cfg": True, "moonraker.conf": True}
