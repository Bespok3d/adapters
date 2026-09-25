# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The composition root: which facts this host reports, and which layout answers for its paths."""
import json
from pathlib import Path

import bespok3d_jinni
import pytest
from bespok3d_jinni import KlipperLinuxJinni, make_jinni

from jinni import KLIPPER_PATH_KEYS, KlipperPrinterJinni

_JINNI_DIR = Path(bespok3d_jinni.__file__).resolve().parent
_VERSION_FILE = _JINNI_DIR / "version.json"
_MANIFEST_FILE = _JINNI_DIR / "manifest.json"

# The two ids the app registers against this one code base. Every test about reading the enrolment
# id back runs under both, so neither can quietly become the only one that works.
_ADAPTER_IDS = ["voron-24", "klipper-generic"]


@pytest.fixture
def printer_home(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """A freshly enrolled printer's home directory, before any layout file was written: the stock
    MainsailOS layout, which is what the templates describe."""
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USER", "pi")
    monkeypatch.delenv("BESPOK3D_DATA_ROOT", raising=False)
    return tmp_path


def _write_layout(home: Path, layout: dict[str, object]) -> None:
    layout_file = home / "bespok3d" / "etc" / "layout.json"
    layout_file.parent.mkdir(parents=True, exist_ok=True)
    layout_file.write_text(json.dumps(layout))


def test_make_jinni_returns_the_klipper_linux_jinni(printer_home: Path) -> None:
    assert isinstance(make_jinni(), KlipperLinuxJinni)


def test_the_host_is_a_klipper_printer(printer_home: Path) -> None:
    assert isinstance(make_jinni(), KlipperPrinterJinni)


def test_id_is_the_code_base_when_no_enrolment_has_written_a_layout(printer_home: Path) -> None:
    assert make_jinni().id == "klipper-linux"


@pytest.mark.parametrize("adapter_id", _ADAPTER_IDS)
def test_id_is_the_adapter_the_printer_was_enrolled_as(printer_home: Path, adapter_id: str) -> None:
    """One code base answers for two adapter ids, and which one this printer is enrolled as is
    enrolment knowledge: the host itself cannot be asked whether it is a Voron."""
    _write_layout(printer_home, {"adapter": adapter_id})

    assert make_jinni().id == adapter_id


def test_the_two_ids_change_nothing_about_this_host_but_which_adapter_answered(
    printer_home: Path,
) -> None:
    """What the variant engine matches a manifest's `when` against is read off the host, so the id
    the printer was enrolled under is the one fact in it that either id can change."""
    _write_layout(printer_home, {"adapter": "voron-24"})
    voron_facts = make_jinni().variant_facts()
    _write_layout(printer_home, {"adapter": "klipper-generic"})
    generic_facts = make_jinni().variant_facts()

    assert voron_facts["adapter"] == "voron-24"
    assert generic_facts["adapter"] == "klipper-generic"
    assert {fact: value for fact, value in voron_facts.items() if fact != "adapter"} == {
        fact: value for fact, value in generic_facts.items() if fact != "adapter"
    }


def test_id_is_the_code_base_when_the_layout_names_no_adapter(printer_home: Path) -> None:
    _write_layout(printer_home, {"PRINTER_CFG": "/home/pi/printer_data/config/printer.cfg"})

    assert make_jinni().id == "klipper-linux"


def test_paths_follow_the_home_directory_of_whatever_account_logged_in(printer_home: Path) -> None:
    paths = make_jinni().paths()

    assert paths["KLIPPER_SRC"] == f"{printer_home}/klipper/klippy"
    assert paths["PRINTER_CFG"] == f"{printer_home}/printer_data/config/printer.cfg"
    assert "$HOME" not in json.dumps(paths)


def test_paths_name_the_runtime_user_rather_than_the_template(printer_home: Path) -> None:
    assert make_jinni().paths()["RUNTIME_USER"] == "pi"


@pytest.mark.parametrize("adapter_id", _ADAPTER_IDS)
def test_the_layout_a_discovery_wrote_wins_over_the_templates(
    printer_home: Path, adapter_id: str
) -> None:
    """A host that keeps Klipper somewhere else is still understood, because enrolment read the
    truth off the printer and wrote it down."""
    _write_layout(printer_home, {"KLIPPER_SRC": "/opt/klipper/klippy", "adapter": adapter_id})
    paths = make_jinni().paths()

    assert paths["KLIPPER_SRC"] == "/opt/klipper/klippy"
    assert paths["MOONRAKER_CFG"] == f"{printer_home}/printer_data/config/moonraker.conf"


@pytest.mark.parametrize("adapter_id", _ADAPTER_IDS)
def test_the_layout_entries_that_are_not_path_variables_are_not_paths(
    printer_home: Path, adapter_id: str
) -> None:
    _write_layout(printer_home, {"adapter": adapter_id, "home": "/home/pi", "sites": []})
    paths = make_jinni().paths()

    assert "adapter" not in paths
    assert "sites" not in paths


def test_the_klipper_path_contract_resolves(printer_home: Path) -> None:
    """What the daemon's jinni loader gates at startup: a klipper printer that leaves one of these
    empty fails to load rather than producing a broken install later."""
    paths = make_jinni().paths()

    assert all(paths.get(key) for key in KLIPPER_PATH_KEYS)


def test_no_single_interpreter_is_offered_for_a_python_dependency(printer_home: Path) -> None:
    """Klipper and Moonraker each run in their own venv here, so there is no one site-packages to
    link a plugin's dependency into. Empty is what makes the daemon refuse such a plugin instead of
    linking into the wrong interpreter."""
    assert make_jinni().paths()["PYTHON_SITE_PACKAGES"] == ""


def test_data_root_follows_the_environment_the_unit_exports(
    printer_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("BESPOK3D_DATA_ROOT", "/srv/bespok3d")

    assert make_jinni().data_root() == "/srv/bespok3d"


def test_data_root_is_under_the_login_user_home_by_default(printer_home: Path) -> None:
    """Everything Bespok3d runs as the login user, so its workspace is that user's to write."""
    assert make_jinni().data_root() == f"{printer_home}/bespok3d"


def test_version_comes_from_the_shared_version_json(printer_home: Path) -> None:
    assert make_jinni().version() == json.loads(_VERSION_FILE.read_text())["jinni_version"]


def test_the_published_package_advertises_the_version_the_jinni_reports() -> None:
    manifest = json.loads(_MANIFEST_FILE.read_text())

    assert manifest["version"] == json.loads(_VERSION_FILE.read_text())["jinni_version"], (
        "bump manifest.json and version.json together"
    )


def test_capability_flags_advertise_what_this_host_class_supports(printer_home: Path) -> None:
    """`klipper-generic` is in there because it is the flag a manifest asks for when it means "any
    Klipper printer", which is what this host class is under either id it was enrolled as."""
    assert make_jinni().capability_flags() == {
        "managed-service",
        "klipper-linux",
        "klipper-generic",
        "systemd",
    }


def test_restart_commands_go_through_systemd_without_a_prompt(printer_home: Path) -> None:
    host = make_jinni()

    assert host.restart_command("klipper") == "sudo -n /usr/bin/systemctl restart klipper"
    assert host.restart_command("moonraker") == "sudo -n /usr/bin/systemctl restart moonraker"


def test_there_is_no_web_hook_because_the_web_server_is_the_hosts(printer_home: Path) -> None:
    """The host's nginx is not Bespok3d's to reload: a config this account could write and root's
    nginx would read is a road to root, so neither the hook nor the sudo rule for it exists."""
    assert make_jinni().restart_command("web") is None


def test_a_plugin_web_location_is_refused_rather_than_placed(printer_home: Path) -> None:
    with pytest.raises(ValueError, match="web locations are not supported on this adapter"):
        make_jinni().placement_destination("web-location", "camera.conf")


def test_every_other_placement_class_still_resolves(printer_home: Path) -> None:
    host = make_jinni()

    assert host.placement_destination("klipper-extra", "foo.py") == "$KLIPPER_EXTRAS/foo.py"
    assert host.placement_destination("system-bin", "tool") == "$BESPOK3D/bin/tool"


def test_restart_command_is_none_for_a_hook_this_host_has_no_service_for(
    printer_home: Path,
) -> None:
    assert make_jinni().restart_command("lmd") is None


def test_service_commands_are_recognised_by_the_one_token_they_all_carry(
    printer_home: Path,
) -> None:
    host = make_jinni()

    assert host.deferred_service_markers() == ("systemctl",)
    assert host.display_service_tokens() == ()


def test_the_host_reports_no_special_hardware(printer_home: Path) -> None:
    assert make_jinni().hardware() == []


def test_the_os_release_plays_the_part_of_a_firmware_version(
    printer_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(bespok3d_jinni.linux_facts, "os_version", lambda: "12")

    assert make_jinni().firmware_version() == "12"


def test_the_variant_dimensions_are_read_from_this_host(
    printer_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(bespok3d_jinni.linux_facts, "arch", lambda: "aarch64")
    monkeypatch.setattr(bespok3d_jinni.linux_facts, "board_class", lambda: "constrained")
    monkeypatch.setattr(bespok3d_jinni.linux_facts, "kernel_release", lambda: "6.12.0-rpi")
    host = make_jinni()

    assert host.arch() == "aarch64"
    assert host.board_class() == "constrained"
    assert host.kernel_release() == "6.12.0-rpi"


def test_no_kernel_version_magic_is_claimed(printer_home: Path) -> None:
    """This adapter places no kernel module, so reporting a magic would only invite a plugin to
    trust a fact nothing here checks."""
    assert make_jinni().kernel_vermagic() == "unknown"


def test_klipper_version_is_read_from_the_checkout_the_layout_points_at(
    printer_home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    asked: list[str] = []

    def describe(source: str) -> str:
        asked.append(source)
        return "v0.13.0-42-gfake"

    monkeypatch.setattr(bespok3d_jinni.linux_facts, "klipper_version", describe)
    version = make_jinni().klipper_version()

    assert version == "v0.13.0-42-gfake"
    assert asked == [f"{printer_home}/klipper/klippy"]


def test_the_daemon_places_no_control_script_and_runs_no_background_task(
    printer_home: Path,
) -> None:
    """The U1 needs both for its display; this host has no device of its own to babysit."""
    host = make_jinni()

    assert host.startup_control_scripts(host.paths()) == []
    assert host.background_tasks() == []
