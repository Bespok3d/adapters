# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reading a host's real Klipper layout off its own service files.

Every fixture here is a verbatim shape from MainsailOS, KIAUH or Moonraker's own installer, because
the whole point of this module is that it reads what those three actually write.
"""
import json
from collections.abc import Callable
from pathlib import Path

import layout_discovery
import pytest

_HOME = Path("/home/pi")
_KLIPPER_ENV = str(_HOME / "printer_data/systemd/klipper.env")
_MOONRAKER_ENV = str(_HOME / "printer_data/systemd/moonraker.env")
_KLIPPER_UNIT = "/etc/systemd/system/klipper.service"
_MOONRAKER_UNIT = "/etc/systemd/system/moonraker.service"

_MAINSAIL_KLIPPER_ENV = (
    'KLIPPER_ARGS="/home/pi/klipper/klippy/klippy.py /home/pi/printer_data/config/printer.cfg '
    "-l /home/pi/printer_data/logs/klippy.log -I /home/pi/printer_data/comms/klippy.serial "
    '-a /home/pi/printer_data/comms/klippy.sock"\n'
)
_MAINSAIL_MOONRAKER_ENV = (
    'MOONRAKER_DATA_PATH="/home/pi/printer_data"\n'
    'MOONRAKER_ARGS="-m moonraker"\n'
    'PYTHONPATH="/home/pi/moonraker"\n'
)
_KLIPPER_UNIT_TEXT = (
    "[Service]\nType=simple\nUser=pi\n"
    "EnvironmentFile=/home/pi/printer_data/systemd/klipper.env\n"
    "ExecStart=/home/pi/klippy-env/bin/python $KLIPPER_ARGS\n"
)


def _reader(files: dict[str, str]) -> Callable[[Path], str | None]:
    def read_text(path: Path) -> str | None:
        return files.get(str(path))

    return read_text


def _no_directories(_path: Path) -> list[Path]:
    return []


def _discover(files: dict[str, str]) -> dict[str, object]:
    return layout_discovery.discover(_HOME, _reader(files), _no_directories)


def test_a_stock_mainsailos_host_is_read_out_of_its_environment_files() -> None:
    layout = _discover({
        _KLIPPER_ENV: _MAINSAIL_KLIPPER_ENV,
        _MOONRAKER_ENV: _MAINSAIL_MOONRAKER_ENV,
        _KLIPPER_UNIT: _KLIPPER_UNIT_TEXT,
    })

    assert layout["KLIPPER_SRC"] == "/home/pi/klipper/klippy"
    assert layout["KLIPPER_EXTRAS"] == "/home/pi/klipper/klippy/extras"
    assert layout["PRINTER_CFG"] == "/home/pi/printer_data/config/printer.cfg"
    assert layout["KLIPPER_LOG"] == "/home/pi/printer_data/logs/klippy.log"
    assert layout["KLIPPER_UDS"] == "/home/pi/printer_data/comms/klippy.sock"
    assert layout["KLIPPER_ENV"] == "/home/pi/klippy-env"


def test_moonrakers_own_layout_is_derived_from_its_data_path_and_checkout() -> None:
    layout = _discover({
        _KLIPPER_ENV: _MAINSAIL_KLIPPER_ENV, _MOONRAKER_ENV: _MAINSAIL_MOONRAKER_ENV,
    })

    assert layout["PRINTER_DATA"] == "/home/pi/printer_data"
    assert layout["MOONRAKER_SRC"] == "/home/pi/moonraker"
    assert layout["MOONRAKER_COMPONENTS"] == "/home/pi/moonraker/moonraker/components"
    assert layout["MOONRAKER_CFG"] == "/home/pi/printer_data/config/moonraker.conf"
    assert layout["MOONRAKER_LOG"] == "/home/pi/printer_data/logs/moonraker.log"
    assert layout["MOONRAKER_UDS"] == "/home/pi/printer_data/comms/moonraker.sock"


def test_an_older_moonraker_environment_file_is_read_the_same() -> None:
    """Before the data path became its own variable, the installer passed the script and `-d`."""
    layout = _discover({
        _MOONRAKER_ENV: (
            'MOONRAKER_ARGS="/home/pi/moonraker/moonraker/moonraker.py '
            '-d /home/pi/printer_data"\n'
        ),
    })

    assert layout["PRINTER_DATA"] == "/home/pi/printer_data"
    assert layout["MOONRAKER_SRC"] == "/home/pi/moonraker"


def test_a_host_that_keeps_its_data_elsewhere_is_followed_there() -> None:
    layout = _discover({
        _KLIPPER_ENV: (
            'KLIPPER_ARGS="/opt/klipper/klippy/klippy.py /srv/printer/config/printer.cfg '
            '-l /srv/printer/logs/klippy.log -a /srv/printer/comms/klippy.sock"\n'
        ),
        _MOONRAKER_ENV: 'MOONRAKER_DATA_PATH="/srv/printer"\nPYTHONPATH="/opt/moonraker"\n',
    })

    assert layout["KLIPPER_SRC"] == "/opt/klipper/klippy"
    assert layout["PRINTER_CFG"] == "/srv/printer/config/printer.cfg"
    assert layout["MOONRAKER_CFG"] == "/srv/printer/config/moonraker.conf"
    assert layout["MOONRAKER_COMPONENTS"] == "/opt/moonraker/moonraker/components"


def test_an_environment_file_the_unit_names_is_read_when_the_usual_one_is_absent() -> None:
    """KIAUH writes the same content, and an older install may keep it somewhere else entirely."""
    layout = _discover({
        _KLIPPER_UNIT: (
            "EnvironmentFile=/etc/default/klipper\n"
            "ExecStart=/home/pi/klippy-env/bin/python $KLIPPER_ARGS\n"
        ),
        "/etc/default/klipper": _MAINSAIL_KLIPPER_ENV,
    })

    assert layout["PRINTER_CFG"] == "/home/pi/printer_data/config/printer.cfg"
    assert layout["KLIPPER_SRC"] == "/home/pi/klipper/klippy"


def test_a_host_that_answers_nothing_falls_back_to_the_stock_layout() -> None:
    """A printer whose services are not installed the usual way still gets a complete answer, and
    the CLI is what refuses the enrolment when those paths turn out not to exist."""
    layout = _discover({})

    assert layout["KLIPPER_SRC"] == "/home/pi/klipper/klippy"
    assert layout["KLIPPER_ENV"] == "/home/pi/klippy-env"
    assert layout["PRINTER_CFG"] == "/home/pi/printer_data/config/printer.cfg"
    assert layout["MOONRAKER_SRC"] == "/home/pi/moonraker"
    assert layout["PRINTER_DATA"] == "/home/pi/printer_data"


def test_the_klipper_virtualenv_comes_from_the_unit_that_starts_it() -> None:
    layout = _discover({
        _KLIPPER_UNIT: "ExecStart=/opt/klippy-env/bin/python $KLIPPER_ARGS\n",
    })

    assert layout["KLIPPER_ENV"] == "/opt/klippy-env"


def test_a_unit_that_starts_something_other_than_a_venv_python_is_not_guessed_at() -> None:
    layout = _discover({_KLIPPER_UNIT: "ExecStart=/usr/bin/klipper-wrapper --start\n"})

    assert layout["KLIPPER_ENV"] == "/home/pi/klippy-env"


def _configured_printer(home: Path) -> None:
    config = home / "printer_data" / "config"
    config.mkdir(parents=True)
    (config / "printer.cfg").write_text("[mcu]\nserial: /dev/serial/by-id/fake-mcu\n")
    (config / "moonraker.conf").write_text("[server]\nport: 7125\n")


def test_the_command_line_prints_the_layout_as_json(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    _configured_printer(tmp_path)
    code = layout_discovery.main(["--home", str(tmp_path)])
    printed = json.loads(capsys.readouterr().out)

    assert code == 0
    assert printed["PRINTER_CFG"] == str(tmp_path / "printer_data/config/printer.cfg")


def test_the_command_line_refuses_a_host_that_is_not_a_configured_printer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """A fresh MainsailOS image has no printer.cfg. Enrolling it would install Bespok3d onto a box
    that is not a printer yet, so the reason is said in one line and the step stops."""
    code = layout_discovery.main(["--home", str(tmp_path)])
    reported = capsys.readouterr()

    assert code == 1
    assert reported.out == ""
    assert len(reported.err.strip().splitlines()) == 1
    assert "printer.cfg" in reported.err


def test_the_home_directory_defaults_to_the_account_running_the_discovery(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))

    assert layout_discovery._home_argument([]) == tmp_path


def test_the_unit_named_environment_file_wins_over_a_leftover_conventional_one() -> None:
    """A host whose unit reads /etc/default/klipper but still carries an old printer_data/systemd
    file runs with the unit's; reading the leftover would describe a printer that is not running."""
    layout = _discover({
        _KLIPPER_UNIT: (
            "EnvironmentFile=-/etc/default/klipper\n"
            "ExecStart=/home/pi/klippy-env/bin/python $KLIPPER_ARGS\n"
        ),
        "/etc/default/klipper": (
            'KLIPPER_ARGS="/opt/klipper/klippy/klippy.py /srv/printer/config/printer.cfg"\n'
        ),
        _KLIPPER_ENV: _MAINSAIL_KLIPPER_ENV,
    })

    assert layout["PRINTER_CFG"] == "/srv/printer/config/printer.cfg"
    assert layout["KLIPPER_SRC"] == "/opt/klipper/klippy"


def _venv_with(interpreter: str) -> Callable[[Path], list[Path]]:
    def list_dir(path: Path) -> list[Path]:
        return [path / interpreter] if path == _HOME / "klippy-env" / "lib" else []

    return list_dir


def test_the_klipper_interpreters_site_packages_is_where_plugin_dependencies_link() -> None:
    """Klipper runs in its own virtualenv here, so a plugin's Klipper facing dependency has to be
    linked into that interpreter and no other. The Python version is read off the venv, because
    Bookworm and Trixie do not agree on it."""
    layout = layout_discovery.discover(_HOME, _reader({}), _venv_with("python3.13"))

    assert layout["PYTHON_SITE_PACKAGES"] == "/home/pi/klippy-env/lib/python3.13/site-packages"


def test_a_host_with_no_klipper_virtualenv_offers_nowhere_to_link() -> None:
    layout = _discover({})

    assert layout["PYTHON_SITE_PACKAGES"] == ""
