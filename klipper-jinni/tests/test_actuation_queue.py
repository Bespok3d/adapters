"""The actuation queue (ADR-0037 process-model invariant): actuations serialize, reads stay
concurrent.

A live restart must never bounce a service while another op is mid-restart, and a slow actuation
must never freeze the reads (health, blocked-actions) the daemon needs. The service runs an
actuation verb through one queue AND off the event loop; these prove both halves over the real
socket: two run_actions never overlap, and a read returns while a run_actions is still in flight.
"""
import asyncio
import shutil
import tempfile
import threading
import time
from collections.abc import Iterator

import protocol
import pytest
from jinni import service
from jinni.klipper import KLIPPER_PATH_KEYS, KlipperPrinterJinni
from jinni.klipper_vocab import KLIPPER_SERVICE
from protocol import ActionResult, DeviceHealth, ServiceHealth

_OVERLAP_HOLD_S = 0.05
_GATE_WAIT_S = 5.0


class _SerializingJinni(KlipperPrinterJinni):
    """Records whether a second run_actions entered while the first was still inside it."""

    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self._in_flight: list[str] = []

    def device_paths(self) -> dict[str, str]:
        return {key: f"/dev/null/{key}" for key in KLIPPER_PATH_KEYS}

    def run_actions(self, commands: list[str]) -> list[ActionResult]:
        tag = commands[0]
        overlapped = bool(self._in_flight)
        self._in_flight.append(tag)
        self.events.append(("enter", tag))
        time.sleep(_OVERLAP_HOLD_S)
        self.events.append(("exit", tag))
        self._in_flight.pop()
        return [ActionResult(ok=not overlapped, output="")]


class _GatedJinni(KlipperPrinterJinni):
    """A run_actions that blocks until the test releases it, so a concurrent read is observable."""

    def __init__(self, started: threading.Event, release: threading.Event) -> None:
        self._started = started
        self._release = release

    def device_paths(self) -> dict[str, str]:
        return {key: f"/dev/null/{key}" for key in KLIPPER_PATH_KEYS}

    def run_actions(self, commands: list[str]) -> list[ActionResult]:
        self._started.set()
        self._release.wait(timeout=_GATE_WAIT_S)
        return [ActionResult(ok=True, output="done")]

    def health(self) -> DeviceHealth:
        return DeviceHealth(services={KLIPPER_SERVICE: ServiceHealth(ready=True, detail="up")})


@pytest.fixture
def socket_path() -> Iterator[str]:
    # A short dir: macOS caps an AF_UNIX path near 104 chars and pytest's tmp_path blows past it.
    directory = tempfile.mkdtemp(prefix="b3d", dir="/tmp")
    try:
        yield f"{directory}/j.sock"
    finally:
        shutil.rmtree(directory, ignore_errors=True)


async def test_two_actuations_never_overlap(socket_path: str) -> None:
    jinni = _SerializingJinni()
    server = await service.serve(socket_path, jinni)
    async with server:
        first = asyncio.create_task(asyncio.to_thread(protocol.call, socket_path, "run_actions", [["a"]]))  # noqa: E501
        second = asyncio.create_task(asyncio.to_thread(protocol.call, socket_path, "run_actions", [["b"]]))  # noqa: E501
        results = await asyncio.gather(first, second)

    assert all(result[0].ok for result in results)
    assert jinni.events in (
        [("enter", "a"), ("exit", "a"), ("enter", "b"), ("exit", "b")],
        [("enter", "b"), ("exit", "b"), ("enter", "a"), ("exit", "a")],
    )


async def test_a_read_runs_while_an_actuation_is_in_flight(socket_path: str) -> None:
    started, release = threading.Event(), threading.Event()
    server = await service.serve(socket_path, _GatedJinni(started, release))
    async with server:
        action = asyncio.create_task(asyncio.to_thread(protocol.call, socket_path, "run_actions", [["x"]]))  # noqa: E501
        await asyncio.to_thread(started.wait, _GATE_WAIT_S)
        # The actuation is now blocked inside the queue; a read must NOT wait on it.
        report = await asyncio.to_thread(protocol.call, socket_path, "health", [])
        release.set()
        results = await action

    assert isinstance(report, DeviceHealth)
    assert results[0].ok
