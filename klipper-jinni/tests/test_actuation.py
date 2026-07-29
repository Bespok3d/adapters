# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The actuation facet: the jinni runs the device commands the daemon resolved (ADR-0037).

Executing a plugin start, a service restart, or a stop command is the jinni's actuation, not the
daemon's. These prove run_actions executes each command in order and reports per-command success and
captured output the daemon turns into its phase log.
"""
from jinni.actuation import Actuation


class _Box(Actuation):
    pass


def test_run_actions_runs_each_command_and_reports_success() -> None:
    results = _Box().run_actions(["echo one", "echo two"])

    assert [result.ok for result in results] == [True, True]
    assert [result.output for result in results] == ["one", "two"]


def test_run_actions_reports_a_failing_command_without_stopping() -> None:
    results = _Box().run_actions(["false", "echo after"])

    assert results[0].ok is False
    assert results[1].ok is True
    assert results[1].output == "after"


def test_run_actions_captures_stderr() -> None:
    results = _Box().run_actions(["echo boom >&2; exit 3"])

    assert results[0].ok is False
    assert "boom" in results[0].output


def test_run_actions_on_an_empty_list_is_a_no_op() -> None:
    assert _Box().run_actions([]) == []
