# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Keeps the U1's Wi-Fi config where a firmware update cannot wipe it.

Enrollment links the live config, /etc/wpa_supplicant.conf, to the persistent one in /userdata.
The screen app's wpa_supplicant saves a Wi-Fi change by writing a new file and renaming it over the
live config, which replaces the link with a plain file in the overlay. From then on every change
stays in the overlay and is lost on a firmware update. So when the live config is a plain file with
a network and the persistent one exists, its network goes to /userdata and the link goes back.
wpa_supplicant keeps running. Its next save replaces the link again, and the next round heals it.
When the printer loses its IP, the restore gives it a network without overwriting the kept one.
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


def link_live_config(live_config: Path, persistent_config: Path) -> None:
    """Points the live config at the persistent one; the live path is never missing meanwhile."""
    staging = _staging_path(live_config)
    staging.unlink(missing_ok=True)
    staging.symlink_to(persistent_config)
    os.replace(staging, live_config)
    _sync_directory(live_config.parent)


def _config_identity(config: Path) -> tuple[int, int, int, int]:
    """Changes whenever wpa_supplicant saves, since each save renames a new file into place."""
    config_stat = os.lstat(config)
    return config_stat.st_ino, config_stat.st_mtime_ns, config_stat.st_ctime_ns, config_stat.st_size


def keep_live_wifi(live_config: Path, persistent_config: Path) -> None:
    # No persistent config means enrollment never set the link up, so there is nothing to put back.
    if live_config.is_symlink() or not live_config.is_file() or not persistent_config.is_file():
        return
    read_identity = _config_identity(live_config)
    live_network = saved_network(live_config)
    if not live_network:
        return
    _replace_file(persistent_config, live_network)
    # A save that landed after the read would vanish under the link, so the link waits for the next
    # round, which keeps that newer save first.
    if _config_identity(live_config) != read_identity:
        return
    link_live_config(live_config, persistent_config)


def _network_in_use(live_config: Path, persistent_config: Path) -> bool:
    """The live config holds a network the restore must not overwrite."""
    # A plain live config on a printer that keeps its Wi-Fi in /userdata is a save the link could
    # not keep yet: the newest network there is.
    kept_wifi = live_config.is_symlink() or persistent_config.is_file()
    return kept_wifi and bool(saved_network(live_config))


def restore_live_network(screen_copy: Path, live_config: Path, persistent_config: Path) -> None:
    """Gives a printer that lost its IP a network to connect with, never over a network it has."""
    if _network_in_use(live_config, persistent_config):
        return
    # Linking back to the kept network, not copying the screen's, keeps the next round from saving
    # the screen's copy over the kept network.
    if saved_network(persistent_config):
        link_live_config(live_config, persistent_config)
        return
    screen_wifi = saved_network(screen_copy)
    if screen_wifi:
        live_config.write_bytes(screen_wifi)
