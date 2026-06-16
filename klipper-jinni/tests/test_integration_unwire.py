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
