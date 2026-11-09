# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Keeps the U1's Wi-Fi config where a firmware update cannot wipe it.

Enrollment links the live config, /etc/wpa_supplicant.conf, to the persistent one in /userdata.
The screen app's wpa_supplicant saves a Wi-Fi change by writing a new file and renaming it over the
live config, which replaces the link with a plain file in the overlay. From then on every change
stays in the overlay and is lost on a firmware update. So when the live config is a plain file with
a network and the persistent one exists, its network goes to /userdata and the link goes back.
wpa_supplicant keeps running. Its next save replaces the link again, and the next round heals it.
"""
import os
import stat
from pathlib import Path

SAVED_NETWORK_MARK = b"network="
# wpa_supplicant writes its own "<config>.tmp", so ours must never share that name.
STAGING_SUFFIX = ".bespok3d-staging"


# Read as bytes: a network name need not be valid UTF-8, and decoding it could fail.
def saved_network(config: Path) -> bytes:
    """The config as it is when it holds a saved network, else nothing."""
    if not config.is_file():
        return b""
    content = config.read_bytes()
    return content if SAVED_NETWORK_MARK in content else b""


def _staging_path(config: Path) -> Path:
    return config.with_name(config.name + STAGING_SUFFIX)


def _sync_directory(directory: Path) -> None:
    """Makes a rename in the directory survive a power cut."""
    directory_fd = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _replace_file(config: Path, content: bytes) -> None:
    """Puts the content in place whole: a power cut leaves the old file or the new, never half."""
    staging = _staging_path(config)
    # The config holds the Wi-Fi password, so the new copy keeps the old one's permissions.
    config_mode = stat.S_IMODE(config.stat().st_mode)
    staging.unlink(missing_ok=True)
    with staging.open("xb") as staging_file:
        os.fchmod(staging_file.fileno(), config_mode)
        staging_file.write(content)
        staging_file.flush()
        os.fsync(staging_file.fileno())
    os.replace(staging, config)
    _sync_directory(config.parent)


def _replace_with_link(live_config: Path, persistent_config: Path) -> None:
    """Points the live config at the persistent one; the live path is never missing meanwhile."""
    staging = _staging_path(live_config)
    staging.unlink(missing_ok=True)
    staging.symlink_to(persistent_config)
    os.replace(staging, live_config)
    _sync_directory(live_config.parent)


def _unlinked_network(live_config: Path, persistent_config: Path) -> bytes:
    """The live config's network when it no longer links to the persistent one, else nothing."""
    # No persistent config means enrollment never set the link up, so there is nothing to put back.
    if live_config.is_symlink() or not persistent_config.is_file():
        return b""
    return saved_network(live_config)


def keep_live_wifi(live_config: Path, persistent_config: Path) -> None:
    live_network = _unlinked_network(live_config, persistent_config)
    if not live_network:
        return
    _replace_file(persistent_config, live_network)
    _replace_with_link(live_config, persistent_config)
