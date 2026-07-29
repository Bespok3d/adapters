# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Recover a destination wedged by an orphaned overlayfs dentry (ADR-0037: device realm).

On an overlayfs root a name can outlive its upper-layer entry: the kernel still caches the dentry,
so lstat reports a symlink while the name is absent from a directory listing and nothing can be done
with it. Removing it fails with ESTALE and creating a fresh symlink over it fails with EEXIST, so a
wiring that lands on one can never make progress and the plugin that needed the link is torn down as
a failed install. Dropping the cached dentries and inodes is the only thing that clears it. That the
printer's root is an overlay, and that this is how the kernel is asked to let go, is device
knowledge, so the recovery lives with the jinni rather than in the daemon.
"""
import errno
import subprocess
from pathlib import Path

_DROP_CACHES = Path("/proc/sys/vm/drop_caches")
_DENTRIES_AND_INODES = "2"


def is_stale_handle(failure: OSError) -> bool:
    return failure.errno == errno.ESTALE


def drop_dentry_cache() -> None:
    """Flush pending writes, then ask the kernel to release the cached names. Best effort: a host
    without the knob (or without the privilege to write it) simply does not recover, and the caller
    reports the original failure."""
    subprocess.run(["sync"], check=False)
    try:
        _DROP_CACHES.write_text(_DENTRIES_AND_INODES)
    except OSError:
        return
