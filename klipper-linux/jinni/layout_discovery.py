# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read where Klipper and Moonraker really live on this host, from the host's own service files.

MainsailOS and KIAUH both write the truth into `~/printer_data/systemd/klipper.env` and
`moonraker.env`, which the units then read. The unit's own `EnvironmentFile=` line is what systemd
starts the service from, so it is read first; the conventional file under printer_data answers
when the unit names nothing readable, and a host that answers nothing at all falls back to the
stock layout under the home directory. Nothing here assumes the login is `pi`.

Importable, and a CLI for the enrolment step, which runs `python3 layout_discovery.py --home <dir>`
on the printer and stores the JSON as `$BESPOK3D/etc/layout.json`. Reading is injected, so the
discovery is exercised against a fixture tree rather than against whatever the machine running the
tests happens to have in /etc.
"""
import json
import sys
from collections.abc import Callable
from pathlib import Path

import systemd_env

ReadText = Callable[[Path], str | None]
ListDir = Callable[[Path], list[Path]]

_UNIT_DIR = Path("/etc/systemd/system")
# What enrolment refuses to proceed without: no printer.cfg means this host is not a configured
# printer yet, and no moonraker.conf means there is no API to talk to.
_REQUIRED = ("PRINTER_CFG", "MOONRAKER_CFG")


def _env_text(home: Path, read_text: ReadText, unit: str | None, service: str) -> str | None:
    """A service's environment file: the one its unit names when that reads (systemd's leading `-`
    marks the file optional and is not part of the path), else the conventional one under
    printer_data. When the two exist and disagree, the unit's is what the service actually runs
    with and the conventional file is a leftover."""
    named = systemd_env.unit_field(unit, "EnvironmentFile").lstrip("-")
    from_unit = read_text(Path(named)) if named else None
    return from_unit or read_text(home / "printer_data/systemd" / f"{service}.env")


def _klipper_paths(home: Path, read_text: ReadText) -> dict[str, str]:
    """KLIPPER_ARGS is `<klipper>/klippy/klippy.py <printer.cfg> -l <log> -I <serial> -a <uds>`, so
    the checkout, the config and the two runtime paths all come out of that one line."""
    unit = read_text(_UNIT_DIR / "klipper.service")
    arguments = systemd_env.env_args(_env_text(home, read_text, unit, "klipper"), "KLIPPER_ARGS")
    positional = systemd_env.positional_args(arguments)
    started = systemd_env.token_at(positional, 0) or str(home / "klipper/klippy/klippy.py")
    source = str(Path(started).parent)
    return {
        "KLIPPER_SRC": source,
        "KLIPPER_EXTRAS": f"{source}/extras",
        "KLIPPER_ENV": systemd_env.venv_root(systemd_env.unit_field(unit, "ExecStart"))
        or str(home / "klippy-env"),
        "PRINTER_CFG": systemd_env.token_at(positional, 1)
        or str(home / "printer_data/config/printer.cfg"),
        "KLIPPER_LOG": systemd_env.flag_value(arguments, "-l")
        or str(home / "printer_data/logs/klippy.log"),
        "KLIPPER_UDS": systemd_env.flag_value(arguments, "-a")
        or str(home / "printer_data/comms/klippy.sock"),
    }


def _moonraker_paths(home: Path, read_text: ReadText) -> dict[str, str]:
    """Moonraker's current environment file names the data path and the checkout outright; an older
    one passes the script and `-d <data>` in MOONRAKER_ARGS instead. The rest of Moonraker's layout
    is fixed relative to those two, so it is derived rather than searched for."""
    unit = read_text(_UNIT_DIR / "moonraker.service")
    text = _env_text(home, read_text, unit, "moonraker")
    arguments = systemd_env.env_args(text, "MOONRAKER_ARGS")
    printer_data = (systemd_env.env_value(text, "MOONRAKER_DATA_PATH")
                    or systemd_env.flag_value(arguments, "-d") or str(home / "printer_data"))
    source = (systemd_env.env_value(text, "PYTHONPATH")
              or _checkout_of(systemd_env.token_at(systemd_env.positional_args(arguments), 0))
              or str(home / "moonraker"))
    return {
        "PRINTER_DATA": printer_data,
        "MOONRAKER_SRC": source,
        "MOONRAKER_COMPONENTS": f"{source}/moonraker/components",
        "MOONRAKER_CFG": f"{printer_data}/config/moonraker.conf",
        "MOONRAKER_LOG": f"{printer_data}/logs/moonraker.log",
        "MOONRAKER_UDS": f"{printer_data}/comms/moonraker.sock",
    }


def _checkout_of(script: str) -> str:
    """The checkout an older `MOONRAKER_ARGS=<src>/moonraker/moonraker.py -d <data>` runs from."""
    return str(Path(script).parent.parent) if script else ""


def _site_packages(klipper_env: str, list_dir: ListDir) -> str:
    """Where a plugin's Klipper facing Python dependency is linked: the site-packages of the
    interpreter Klipper itself runs on. Found by listing the virtualenv rather than naming a Python
    version, because Bookworm and Trixie disagree on it. Empty when there is no such virtualenv,
    which the daemon reads as "nowhere to link to"."""
    interpreters = [
        entry for entry in list_dir(Path(klipper_env) / "lib") if entry.name.startswith("python3")
    ]
    return str(interpreters[0] / "site-packages") if interpreters else ""


def discover(home: Path, read_text: ReadText, list_dir: ListDir) -> dict[str, object]:
    """Every path variable this host answers for."""
    klipper = _klipper_paths(home, read_text)
    return {
        **klipper,
        **_moonraker_paths(home, read_text),
        "PYTHON_SITE_PACKAGES": _site_packages(klipper["KLIPPER_ENV"], list_dir),
    }


def read_text(path: Path) -> str | None:
    try:
        return path.read_text()
    except OSError:
        return None


def list_dir(path: Path) -> list[Path]:
    try:
        return sorted(path.iterdir())
    except OSError:
        return []


def _home_argument(argv: list[str]) -> Path:
    if "--home" in argv and argv.index("--home") + 1 < len(argv):
        return Path(argv[argv.index("--home") + 1]).expanduser()
    return Path.home()


def main(argv: list[str]) -> int:
    layout = discover(_home_argument(argv), read_text, list_dir)
    absent = [str(layout[key]) for key in _REQUIRED if not Path(str(layout[key])).exists()]
    if absent:
        print(
            f"this host has no {' and no '.join(absent)}, so it is not a configured Klipper "
            "printer yet", file=sys.stderr,
        )
        return 1
    print(json.dumps(layout, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
