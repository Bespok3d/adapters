# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The path layout of one Klipper on Linux host: templates expanded, then overridden by discovery.

paths.json carries the ordinary layout as `$HOME` and `$USER` templates, so the app can show a user
where Bespok3d will put things before it has ever logged in to the printer. A real host may keep
Klipper, Moonraker or the printer data somewhere else, so the client's discover-layout step writes
what it actually found into `$BESPOK3D/etc/layout.json` at enrolment, and this module lets that
file's UPPERCASE keys win over the templates. A host with no layout file is served by the templates
alone, which is exactly the stock MainsailOS or KIAUH layout.
"""
import getpass
import json
import os
from pathlib import Path

# Relative to the bespok3d root, so it moves with the workspace and survives a daemon redeploy.
_LAYOUT_FILE = "etc/layout.json"


def expand_home(template: str, home: str) -> str:
    """The template with `$HOME` filled in. The home directory follows the login user's name here,
    so it is a runtime fact and never baked into paths.json."""
    return template.replace("$HOME", home)


def current_user() -> str:
    """The account the daemon runs as. `USER` is what the systemd unit exports; getpass reads the
    passwd entry for the uid when it is not set (a service started with a bare environment)."""
    return os.environ.get("USER") or getpass.getuser()


def read_layout(bespok3d_root: str) -> dict[str, object]:
    """What the enrolment discovered about this host, or an empty mapping when there is no file.

    Missing or unreadable is the normal case for a jinni running before its first enrolment wrote
    the file, and a truncated file is a half written one, so both mean the templates apply rather
    than an error the daemon would have to handle at load.
    """
    try:
        data = json.loads((Path(bespok3d_root) / _LAYOUT_FILE).read_text())
    except (OSError, ValueError):
        return {}

    return data if isinstance(data, dict) else {}


def resolve_paths(
    templates: dict[str, str], home: str, layout: dict[str, object]
) -> dict[str, str]:
    """The host's real path variables: the templates expanded for this account, then whatever the
    enrolment discovered on top."""
    user = current_user()
    expanded = {
        key: expand_home(value, home).replace("$USER", user)
        for key, value in templates.items()
    }

    return {**expanded, **_overrides(layout)}


def _overrides(layout: dict[str, object]) -> dict[str, str]:
    """The layout file's path variables. It also carries the adapter id, the runtime user, the home
    directory and the nginx site list, which are not path variables, so only UPPERCASE string
    entries are taken: that is the spelling every path variable in the contract uses."""
    return {
        key: value for key, value in layout.items()
        if key.isupper() and isinstance(value, str)
    }
