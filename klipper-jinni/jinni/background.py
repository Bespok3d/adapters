# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The jinni's background tasks, held and watched for the life of the process.

A device jinni declares background tasks (the U1's Wi-Fi watchdog, its boot check of the screen's
Wi-Fi). The process starts each one, holds it so it cannot be garbage collected mid-run, and logs a
plain line when one crashes. A task that finishes its job ends quietly.
"""
import asyncio
import logging
from collections.abc import Coroutine
from typing import Any

TASK_STOPPED = "The printer's %s stopped, and it stays off until the jinni restarts."

# The event loop keeps only a weak reference to a task, so a task nobody holds can be garbage
# collected mid-run (asyncio.create_task docs). The process holds them here for its life.
_background_tasks: list[asyncio.Task[None]] = []
logger = logging.getLogger(__name__)


def _report_stopped_task(task: asyncio.Task[None]) -> None:
    # A held task that fails is never collected, so asyncio would not report it.
    if task.cancelled() or task.exception() is None:
        return
    logger.error(TASK_STOPPED, task.get_name(), exc_info=task.exception())


def _start_background_task(background_task: Coroutine[Any, Any, None]) -> asyncio.Task[None]:
    task = asyncio.create_task(background_task, name=background_task.__qualname__)
    task.add_done_callback(_report_stopped_task)
    return task


def start_background_tasks(jinni: Any) -> None:
    _background_tasks.extend(
        _start_background_task(background_task) for background_task in jinni.background_tasks()
    )
