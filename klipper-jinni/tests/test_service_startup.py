# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni process writes the device's startup control scripts and starts its background tasks
before serving (ADR-0037).

The child does its own in-process lifecycle: on `run`, before it serves the contract, it writes the
control scripts the jinni declares into the persistent bespok3d tree (a display control script on
the U1, nothing on a generic box), and starts the background tasks it declares (the U1's Wi-Fi
watchdog), holding each one for the life of the process.
"""
import asyncio
import gc
import logging
from collections.abc import Coroutine
from pathlib import Path
from typing import Any

import pytest

from jinni import background, service
from jinni.base import Jinni
from protocol import ControlScript


class _BareJinni(Jinni):
    def __init__(self, root: str) -> None:
        self._root = root

    def data_root(self) -> str:
        return self._root


class _ControlScriptJinni(_BareJinni):
    def startup_control_scripts(self, paths: dict[str, str]) -> list[ControlScript]:
        target = f"{paths['BESPOK3D']}/etc/init.d/lmdctl"
        return [ControlScript(path=target, content="#!/bin/sh\n# lmdctl\n", mode=0o755)]


class _WatchdogJinni(_BareJinni):
    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return [asyncio.Event().wait()]


class _CrashingJinni(_BareJinni):
    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return [_crashing_watchdog()]


async def _crashing_watchdog() -> None:
    raise RuntimeError("watchdog bug")


class _OneShotJinni(_BareJinni):
    def background_tasks(self) -> list[Coroutine[Any, Any, None]]:
        return [_boot_check()]


async def _boot_check() -> None:
    return None


async def _running_after_garbage_collection(jinni: Jinni) -> list[asyncio.Task[None]]:
    background.start_background_tasks(jinni)
    await asyncio.sleep(0)
    gc.collect()
    return [task for task in background._background_tasks if not task.done()]


async def _start_and_wait(jinni: Jinni) -> None:
    background.start_background_tasks(jinni)
    await asyncio.wait(background._background_tasks)


# The bug: nothing held the background tasks, so the garbage collector could end the Wi-Fi watchdog.
def test_the_process_holds_its_background_tasks(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path,
) -> None:
    monkeypatch.setattr(background, "_background_tasks", [])
    running = asyncio.run(_running_after_garbage_collection(_WatchdogJinni(str(tmp_path))))
    assert len(running) == 1


def test_a_background_task_that_crashes_is_logged(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(background, "_background_tasks", [])
    with caplog.at_level(logging.ERROR, logger="jinni.background"):
        asyncio.run(_start_and_wait(_CrashingJinni(str(tmp_path))))
    assert "The printer's _crashing_watchdog stopped" in caplog.text
    assert "watchdog bug" in caplog.text


# The bug: a task that finished its job was logged as stopped, as if it had crashed.
def test_a_background_task_that_finishes_its_job_logs_nothing(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path, caplog: pytest.LogCaptureFixture,
) -> None:
    monkeypatch.setattr(background, "_background_tasks", [])
    with caplog.at_level(logging.ERROR, logger="jinni.background"):
        asyncio.run(_start_and_wait(_OneShotJinni(str(tmp_path))))
    assert caplog.records == []


def test_write_startup_scripts_writes_the_declared_scripts(tmp_path: Path) -> None:
    service._write_startup_scripts(_ControlScriptJinni(str(tmp_path)))
    target = tmp_path / "etc" / "init.d" / "lmdctl"
    assert target.read_text() == "#!/bin/sh\n# lmdctl\n"
    assert target.stat().st_mode & 0o755 == 0o755


def test_a_jinni_with_no_startup_scripts_writes_nothing(tmp_path: Path) -> None:
    service._write_startup_scripts(_BareJinni(str(tmp_path)))
    assert not (tmp_path / "etc" / "init.d").exists()
