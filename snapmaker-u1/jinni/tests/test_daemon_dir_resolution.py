# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni's tests import the daemon's `protocol` package, so they must find the daemon repo.

A developer workspace has it next to adapters/. A CI runner has one repo checked out and fetches the
daemon itself, so it names the landing place instead. Both must resolve, or the suite cannot even be
collected on a single-repo runner.
"""
from pathlib import Path

from conftest import daemon_dir_from


def test_daemon_dir_is_the_workspace_sibling_when_ci_names_nothing() -> None:
    assert daemon_dir_from({}, Path("/workspace")) == Path("/workspace/daemon")


def test_daemon_dir_follows_the_path_ci_fetched_the_daemon_into() -> None:
    fetched_into = "/runner/work/adapters/adapters/daemon"
    resolved = daemon_dir_from({"B3D_DAEMON_DIR": fetched_into}, Path("/workspace"))

    assert resolved == Path(fetched_into)
