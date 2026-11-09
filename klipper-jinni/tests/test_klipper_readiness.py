# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Klipper's readiness comes from Klipper's own state, over its API socket or Moonraker's HTTP.

A halted Klipper (config error) is still answered with HTTP 200 by Moonraker, so the state inside
the reply decides, never the status code. The `info` reply is kept for the failure report.
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


def _probe(up: bool, body: str) -> Callable[[str], tuple[bool, str]]:
    return lambda _url: (up, body)


def _no_wait(monkeypatch: MP) -> None:
    monkeypatch.setattr(klipper_readiness, "KLIPPER_RETRIES", 2)
    monkeypatch.setattr(klipper_readiness.time, "sleep", lambda _s: None)


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


def test_the_error_klipper_named_survives_a_last_attempt_with_no_reply(monkeypatch: MP) -> None:
    halted_info = {"state": "error", "state_message": "Section 'afc' is not a valid config section"}
    replies = iter((halted_info, None))
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: next(replies))
    _no_wait(monkeypatch)
    readiness = klipper_readiness.klipper_healthy("/tmp/klippy.sock", _probe(False, "HTTP 503"))
    assert readiness.ready is False
    assert readiness.info == halted_info
