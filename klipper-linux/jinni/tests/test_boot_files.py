# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The files the enrolment installs into the host's own boot sequence and its sudoers directory.

Nothing here is rendered by the jinni at runtime: the client renders these at enrolment and installs
them as root. They live in the jinni package because they are device knowledge, and they are checked
here because a broken unit leaves a printer that does not come back, and a broken sudoers file locks
every account out of sudo on that host.
"""
import shutil
import subprocess
from pathlib import Path

import bespok3d_jinni
import pytest

_JINNI_DIR = Path(bespok3d_jinni.__file__).resolve().parent
_RENDERED = {
    "__USER__": "pi",
    "__BESPOK3D__": "/home/pi/bespok3d",
    "__VENV__": "/home/pi/bespok3d/venv",
}
_UNITS = ("bespok3d.service", "bespok3d-plugins.service")
_SHELL_SCRIPTS = ("service.sh", "bespok3d-plugins.sh", "s10bespok3d-daemon.sh")


def _template(name: str) -> str:
    return (_JINNI_DIR / name).read_text()


def _render(name: str) -> str:
    text = _template(name)
    for sentinel, value in _RENDERED.items():
        text = text.replace(sentinel, value)
    return text


def test_the_daemon_unit_runs_as_the_login_user_out_of_its_own_workspace() -> None:
    unit = _render("bespok3d.service")

    assert "User=pi" in unit
    assert "Environment=BESPOK3D_DATA_ROOT=/home/pi/bespok3d" in unit
    assert (
        "ExecStart=/bin/sh -c 'exec \"/home/pi/bespok3d/venv/bin/python3\" "
        "\"/home/pi/bespok3d/var/lib/daemon/daemon.py\""
    ) in unit
    assert "WantedBy=multi-user.target" in unit


def test_the_daemon_unit_writes_its_log_where_the_app_reads_it() -> None:
    """Through the shell that already runs as the login user: systemd's own append: redirection
    would have root open a file inside that user's tree, which the user could have pointed anywhere,
    and would leave a root owned file a second enrolment cannot touch."""
    unit = _render("bespok3d.service")

    assert '>>"/home/pi/bespok3d/var/log/daemon.log" 2>&1' in unit
    assert "StandardOutput" not in unit


def test_a_daemon_restart_leaves_the_plugin_services_running() -> None:
    """The plugin services the daemon started sit in its control group. Without this, upgrading the
    daemon would kill a user's running plugin as a side effect."""
    assert "KillMode=process" in _template("bespok3d.service")


def test_the_daemon_unit_comes_up_after_the_network_and_moonraker() -> None:
    unit = _template("bespok3d.service")

    assert "After=network-online.target moonraker.service" in unit
    assert "Wants=network-online.target" in unit
    assert "Restart=on-failure" in unit


def test_the_plugins_unit_runs_the_runner_in_both_directions() -> None:
    unit = _render("bespok3d-plugins.service")

    assert "Type=oneshot" in unit
    assert "RemainAfterExit=yes" in unit
    assert "ExecStart=/home/pi/bespok3d/etc/init.d/bespok3d-plugins start" in unit
    assert "ExecStop=/home/pi/bespok3d/etc/init.d/bespok3d-plugins stop" in unit
    assert "After=bespok3d.service klipper.service moonraker.service network-online.target" in unit


def test_every_unit_template_carries_the_sentinels_the_enrolment_fills() -> None:
    daemon_unit = _template("bespok3d.service")
    plugins_unit = _template("bespok3d-plugins.service")

    assert all(sentinel in daemon_unit for sentinel in _RENDERED)
    assert "__USER__" in plugins_unit and "__BESPOK3D__" in plugins_unit


@pytest.mark.parametrize("unit", _UNITS)
def test_no_sentinel_survives_a_rendered_unit(unit: str) -> None:
    """A sentinel left in a unit is a path systemd takes literally, and the service never starts."""
    assert "__" not in _render(unit)


@pytest.mark.parametrize("script", _SHELL_SCRIPTS)
def test_every_shell_script_parses(script: str) -> None:
    parsed = subprocess.run(
        ["sh", "-n", str(_JINNI_DIR / script)], capture_output=True, text=True, check=False
    )

    assert parsed.returncode == 0, parsed.stderr


def test_the_plugins_runner_never_touches_the_daemon() -> None:
    """The daemon is a systemd unit on this host and bespok3d.service owns it. A runner that also
    started it would fight the unit it depends on for the same process."""
    runner = _template("bespok3d-plugins.sh")

    assert "! -name 's10*'" in runner
    assert "sort -r" in runner


def test_the_daemon_wrapper_hands_every_verb_to_systemd() -> None:
    wrapper = _template("s10bespok3d-daemon.sh")

    assert 'sudo -n /usr/bin/systemctl "$1" bespok3d' in wrapper
    assert "systemctl is-active bespok3d" in wrapper


def test_the_sudoers_drop_in_names_the_login_user() -> None:
    rendered = _render("bespok3d.sudoers")

    assert "pi ALL=(root) NOPASSWD: BESPOK3D_SERVICES" in rendered
    assert "__USER__" not in rendered


def test_the_sudoers_drop_in_grants_nothing_but_those_service_commands() -> None:
    """Every entry is a full command line, so none of them can be widened by an argument, and there
    is no shell and no editor among them."""
    alias = [
        line for line in _template("bespok3d.sudoers").splitlines()
        if line.startswith("Cmnd_Alias")
    ][0]
    commands = alias.split("=", 1)[1].split(",")

    assert all(command.strip().startswith("/usr/bin/systemctl ") for command in commands)


def test_every_restart_command_the_jinni_issues_is_one_sudo_allows() -> None:
    """The two lists are the same fact written twice, and a command missing from the drop-in would
    hang on a password prompt no one can answer."""
    alias = _template("bespok3d.sudoers")
    issued = list(bespok3d_jinni._RESTART_COMMANDS.values())

    assert all(command.removeprefix("sudo -n ") in alias for command in issued)


def test_the_rendered_sudoers_file_is_one_sudo_accepts(tmp_path: Path) -> None:
    """A syntax error in a sudoers drop-in breaks sudo for every account on the printer, so the
    enrolment runs this same check before installing the file."""
    if shutil.which("visudo") is None:
        pytest.skip("visudo is not installed on this machine")
    drop_in = tmp_path / "bespok3d"
    drop_in.write_text(_render("bespok3d.sudoers"))
    checked = subprocess.run(
        ["visudo", "-cf", str(drop_in)], capture_output=True, text=True, check=False
    )

    assert checked.returncode == 0, checked.stdout + checked.stderr


def test_the_sudoers_drop_in_never_touches_the_hosts_web_server() -> None:
    """A rule that let this account reload nginx would let it make root parse a file it wrote."""
    assert "nginx" not in _template("bespok3d.sudoers")
