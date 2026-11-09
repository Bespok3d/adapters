# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Klipper's readiness comes from Klipper's own state, over its API socket or Moonraker's HTTP.

A halted Klipper (config error) is still answered with HTTP 200 by Moonraker, so the state inside
the reply decides, never the status code. The `info` reply is kept for the failure report.

A halted Klipper stays halted until a restart, so it is reported at once; only a Klipper still
starting is asked again, every second, up to a deadline.
"""
from collections.abc import Callable

import pytest

from jinni import klipper_readiness

MP = pytest.MonkeyPatch

_HALTED_HTTP_BODY = (
    '{"result": {"state": "error",'
    ' "state_message": "Section \'afc\' is not a valid config section",'
    ' "process_id": 1276, "log_file": "/oem/klippylogs/klippy.log"}}'
)


_HALTED_INFO = {"state": "error", "state_message": "Section 'afc' is not valid"}
_STARTING_INFO = {"state": "startup", "state_message": "Printer is not ready", "process_id": 1301}


class _PrinterClock:
    """Wall time that moves only when the readiness check sleeps, counting each wait."""

    def __init__(self) -> None:
        self.now_s = 0.0
        self.waits = 0

    def monotonic(self) -> float:
        return self.now_s

    def sleep(self, seconds: float) -> None:
        self.now_s += seconds
        self.waits += 1


def _probe(up: bool, body: str) -> Callable[[str], tuple[bool, str]]:
    return lambda _url: (up, body)


def _no_wait(monkeypatch: MP) -> _PrinterClock:
    clock = _PrinterClock()
    monkeypatch.setattr(klipper_readiness, "time", clock)
    return clock


def _socket_replies(monkeypatch: MP, replies: list[dict]) -> None:
    """Klipper's socket answers with `replies` in turn, then stops answering."""
    remaining = iter(replies)
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info",
                        lambda _path: next(remaining, None))


def test_klipper_healthy_prefers_the_api_socket(monkeypatch: MP) -> None:
    # Klipper's API socket is auth-free, so it is the source of truth even when Moonraker forces
    # logins; the HTTP probe is only the fallback when the socket is unavailable.
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info",
                        lambda _path: {"state": "ready"})
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, ""))
    assert readiness.ready is True
    assert "api socket" in readiness.detail


def test_klipper_healthy_keeps_the_info_of_a_halted_klipper(monkeypatch: MP) -> None:
    halted_info = {"state": "error", "state_message": "Printer is halted", "process_id": 1276}
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: halted_info)
    _no_wait(monkeypatch)
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, ""))
    assert readiness.ready is False
    assert readiness.info == halted_info


def test_klipper_healthy_falls_back_to_http_without_a_socket() -> None:
    readiness = klipper_readiness.klipper_healthy("", _probe(True, "via http"))
    assert readiness.ready is True
    assert readiness.detail == "via http"


def test_http_200_with_a_halted_klipper_is_not_ready(monkeypatch: MP) -> None:
    _no_wait(monkeypatch)
    readiness = klipper_readiness.klipper_healthy("", _probe(True, _HALTED_HTTP_BODY))
    assert readiness.ready is False
    assert readiness.detail == "klippy state via http: error"
    assert readiness.info["log_file"] == "/oem/klippylogs/klippy.log"


def test_http_200_with_a_ready_klipper_is_ready() -> None:
    ready_body = '{"result": {"state": "ready"}}'
    readiness = klipper_readiness.klipper_healthy("", _probe(True, ready_body))
    assert readiness.ready is True


def test_a_halted_klipper_is_reported_without_waiting(monkeypatch: MP) -> None:
    # Regression: a halted Klipper was asked six times, five seconds apart, before it was reported,
    # twice per safety net round; on a printer with ten stranded plugins that was minutes of wait.
    clock = _no_wait(monkeypatch)
    _socket_replies(monkeypatch, [_HALTED_INFO])
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is False
    assert clock.waits == 0


def test_a_shut_down_klipper_is_reported_without_waiting(monkeypatch: MP) -> None:
    clock = _no_wait(monkeypatch)
    _socket_replies(monkeypatch, [{"state": "shutdown", "state_message": "MCU 'mcu' shutdown"}])
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is False
    assert clock.waits == 0


def test_a_starting_klipper_is_asked_every_second_until_ready(monkeypatch: MP) -> None:
    clock = _no_wait(monkeypatch)
    _socket_replies(monkeypatch, [_STARTING_INFO, _STARTING_INFO, {"state": "ready"}])
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is True
    assert clock.waits == 2
    assert clock.now_s == 2 * klipper_readiness.KLIPPER_POLL_S


def test_a_klipper_that_never_settles_is_given_up_at_the_deadline(monkeypatch: MP) -> None:
    clock = _no_wait(monkeypatch)
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: _STARTING_INFO)
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is False
    assert clock.now_s == klipper_readiness.KLIPPER_WAIT_S


def test_what_klipper_said_survives_a_last_attempt_with_no_reply(monkeypatch: MP) -> None:
    _no_wait(monkeypatch)
    _socket_replies(monkeypatch, [_STARTING_INFO])
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is False
    assert readiness.info == _STARTING_INFO
