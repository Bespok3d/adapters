# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Templates expanded for this account, then overridden by what the enrolment discovered."""
import json
from pathlib import Path

import linux_layout
import pytest

_TEMPLATES = {
    "BESPOK3D": "$HOME/bespok3d",
    "KLIPPER_SRC": "$HOME/klipper/klippy",
    "RUNTIME_USER": "$USER",
}


def test_expand_home_fills_in_the_account_that_logged_in() -> None:
    assert linux_layout.expand_home("$HOME/klipper/klippy", "/home/voron") == (
        "/home/voron/klipper/klippy"
    )


def test_expand_home_leaves_an_absolute_path_alone() -> None:
    assert linux_layout.expand_home("/opt/klipper/klippy", "/home/pi") == "/opt/klipper/klippy"


def test_the_user_is_read_from_the_environment_the_unit_exports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("USER", "voron")

    assert linux_layout.current_user() == "voron"


def test_the_user_falls_back_to_the_passwd_entry_of_the_running_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A service started with a bare environment has no USER, and the account is still knowable."""
    monkeypatch.delenv("USER", raising=False)
    monkeypatch.setattr(linux_layout.getpass, "getuser", lambda: "pi")

    assert linux_layout.current_user() == "pi"


def test_there_is_no_layout_until_an_enrolment_writes_one(tmp_path: Path) -> None:
    assert linux_layout.read_layout(str(tmp_path)) == {}


def test_a_half_written_layout_reads_as_no_layout(tmp_path: Path) -> None:
    """A truncated file is a write that did not finish. The templates alone are a working layout,
    so the daemon comes up instead of failing to load its jinni."""
    layout_file = tmp_path / "etc" / "layout.json"
    layout_file.parent.mkdir(parents=True)
    layout_file.write_text('{"KLIPPER_SRC": "/opt/klip')

    assert linux_layout.read_layout(str(tmp_path)) == {}


def test_a_layout_that_is_not_a_mapping_reads_as_no_layout(tmp_path: Path) -> None:
    layout_file = tmp_path / "etc" / "layout.json"
    layout_file.parent.mkdir(parents=True)
    layout_file.write_text('["KLIPPER_SRC"]')

    assert linux_layout.read_layout(str(tmp_path)) == {}


def test_the_layout_is_read_from_the_bespok3d_root(tmp_path: Path) -> None:
    layout_file = tmp_path / "etc" / "layout.json"
    layout_file.parent.mkdir(parents=True)
    layout_file.write_text(json.dumps({"KLIPPER_SRC": "/opt/klipper/klippy"}))

    assert linux_layout.read_layout(str(tmp_path)) == {"KLIPPER_SRC": "/opt/klipper/klippy"}


def test_resolve_paths_expands_the_home_and_the_account(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("USER", "voron")
    paths = linux_layout.resolve_paths(_TEMPLATES, "/home/voron", {})

    assert paths == {
        "BESPOK3D": "/home/voron/bespok3d",
        "KLIPPER_SRC": "/home/voron/klipper/klippy",
        "RUNTIME_USER": "voron",
    }


def test_what_the_enrolment_discovered_wins_over_the_template(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("USER", "pi")
    paths = linux_layout.resolve_paths(
        _TEMPLATES, "/home/pi", {"KLIPPER_SRC": "/opt/klipper/klippy"}
    )

    assert paths["KLIPPER_SRC"] == "/opt/klipper/klippy"
    assert paths["BESPOK3D"] == "/home/pi/bespok3d"


def test_a_path_the_templates_never_named_still_reaches_the_daemon(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Discovery answers for more than the templates describe (the Klipper venv, the Moonraker
    checkout), and a plugin that asks for one of those gets the real value."""
    monkeypatch.setenv("USER", "pi")
    paths = linux_layout.resolve_paths(
        _TEMPLATES, "/home/pi", {"KLIPPER_ENV": "/home/pi/klippy-env"}
    )

    assert paths["KLIPPER_ENV"] == "/home/pi/klippy-env"


@pytest.mark.parametrize("adapter_id", ["voron-24", "klipper-generic"])
def test_the_layout_entries_that_are_not_path_variables_are_left_out(
    monkeypatch: pytest.MonkeyPatch, adapter_id: str
) -> None:
    """The layout file also carries the adapter id, the home directory and the nginx site list.
    None of those is a path variable, and a plugin resolving `$adapter` would be nonsense. Either
    of the two ids the app registers reaches this file, and neither is a path."""
    monkeypatch.setenv("USER", "pi")
    paths = linux_layout.resolve_paths(
        _TEMPLATES, "/home/pi",
        {"adapter": adapter_id, "home": "/home/pi", "nginx_sites": ["/etc/nginx/sites/mainsail"]},
    )

    assert set(paths) == set(_TEMPLATES)
