# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The klipper printer jinni judges its own health and reports it as one DeviceHealth (ADR-0037).

`health()` is the single verb the daemon's safety net asks for. It probes each service over its
auth-free Unix socket (so it survives the moonraker-auth plugin's force_logins) with an HTTP
fallback, and folds in the stock MQTT broker. The retry loops + /server/info parsing are the pure
functions `probe_moonraker` / `_parse_server_info`, exercised directly here (Klipper's readiness has
its own test file); the assembly into a report is exercised through `health()`.
"""
import time
import urllib.error
import urllib.request
from collections.abc import Callable
from email.message import Message
from pathlib import Path
from typing import NoReturn

import pytest

from jinni import health, inspection, klipper_readiness, live_logs
from jinni.health import MoonrakerInfo
from jinni.klipper import KLIPPER_PATH_KEYS, KlipperPrinterJinni
from jinni.klipper_vocab import KLIPPER_SERVICE, MOONRAKER_SERVICE
from tests.fake_proc import fake_log, fake_process

MP = pytest.MonkeyPatch


def _probe(up: bool, body: str) -> Callable[[str], tuple[bool, str]]:
    return lambda _url: (up, body)


def test_probe_moonraker_reads_force_logins_401_as_up(monkeypatch: MP) -> None:
    # moonraker-auth turns on force_logins, so /server/info answers 401: the server up and demanding
    # a login, not a failure. The jinni's own http probe must read it as up.
    def _unauthorized(_url: str, timeout: float = 3) -> NoReturn:
        raise urllib.error.HTTPError(_url, 401, "Unauthorized", Message(), None)
    monkeypatch.setattr(urllib.request, "urlopen", _unauthorized)
    info = health.probe_moonraker("", inspection.http_service_get)
    assert info.reachable is True
    assert info.failed_components == []


def test_probe_moonraker_unreachable_when_connection_refused(monkeypatch: MP) -> None:
    monkeypatch.setattr(health, "MOONRAKER_RETRIES", 2)
    monkeypatch.setattr(health.time, "sleep", lambda _s: None)
    info = health.probe_moonraker("", _probe(False, "refused"))
    assert info.reachable is False


def test_probe_moonraker_reads_failed_components_over_the_socket(monkeypatch: MP) -> None:
    # The Moonraker socket is auth-free, so a soft fail (a component that failed to load) stays seen
    # even when force_logins blocks the HTTP body. This is what the safety net attributes on.
    monkeypatch.setattr(
        health.moonraker_client, "server_info",
        lambda _path: {"klippy_state": "ready", "failed_components": ["timelapse"], "warnings": []},
    )
    info = health.probe_moonraker("/tmp/moonraker.sock", _probe(False, ""))
    assert info.reachable is True
    assert info.failed_components == ["timelapse"]


def test_parse_server_info_reads_failed_components() -> None:
    body = '{"result": {"klippy_state": "ready", "klippy_connected": true, ' \
           '"failed_components": ["notifier"], "warnings": ["[notifier phone] failed to load"]}}'
    info = health._parse_server_info(body)
    assert info.reachable is True
    assert info.failed_components == ["notifier"]
    assert info.warnings == ["[notifier phone] failed to load"]


def test_parse_server_info_tolerates_non_json() -> None:
    info = health._parse_server_info("<html>oops</html>")
    assert info.reachable is True
    assert info.failed_components == []


def test_moonraker_info_defaults() -> None:
    info = MoonrakerInfo(reachable=True, raw="")
    assert info.failed_components == []
    assert info.warnings == []


class _HealthJinni(KlipperPrinterJinni):
    def __init__(self, sockets: dict[str, str] | None = None) -> None:
        self._sockets = sockets or {}

    def device_paths(self) -> dict[str, str]:
        return {**{key: f"/dev/null/{key}" for key in KLIPPER_PATH_KEYS}, **self._sockets}


_READY_INFO = {"state": "ready"}


def _sockets() -> dict[str, str]:
    return {"KLIPPER_UDS": "/tmp/klippy.sock", "MOONRAKER_UDS": "/tmp/moonraker.sock"}


def test_health_assembles_a_device_report(monkeypatch: MP, tmp_path: Path) -> None:
    # The shared klipper tier reports only the domain services; a device's own infrastructure (the
    # U1 broker) is the device jinni's to diagnose, so health() here carries no broker fact.
    monkeypatch.setattr(live_logs, "PROC_ROOT", tmp_path / "no-proc")
    jinni = _HealthJinni(_sockets())
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: _READY_INFO)
    monkeypatch.setattr(
        health.moonraker_client, "server_info",
        lambda _path: {"klippy_state": "ready", "failed_components": ["notifier"], "warnings": []},
    )

    report = jinni.health()

    assert report.services[KLIPPER_SERVICE].ready is True
    assert report.services[MOONRAKER_SERVICE].failed_components == ("notifier",)
    assert report.diagnosis == ""
    assert report.healthy is False  # moonraker reachable but a component failed to load


def test_health_is_healthy_when_every_service_is_ready(monkeypatch: MP) -> None:
    jinni = _HealthJinni(_sockets())
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: _READY_INFO)
    monkeypatch.setattr(
        health.moonraker_client, "server_info",
        lambda _path: {"klippy_state": "ready", "failed_components": [], "warnings": []},
    )

    assert jinni.health().healthy is True


_KLIPPY_ARGV = ("python3", "/home/lava/klipper/klippy/klippy.py", "printer.cfg")
_MOONRAKER_ARGV = ("python3", "/home/lava/moonraker/moonraker/moonraker.py")


def test_health_reads_the_live_log_not_the_stale_one_halted_klipper(
        monkeypatch: MP, tmp_path: Path) -> None:
    # Junior's incident: Klipper halted at config load on a plugin's section, its real log moved
    # by a firmware update, and a klippy.log left at the configured path naming another error.
    # The report must name the section Klipper halted on now, never an earlier run's or the decoy's.
    now = time.time()
    stale_log = fake_log(tmp_path / "printer_data" / "klippy.log",
                         "Section 'stale_decoy_section' is not a valid config section", now)
    live_log = fake_log(tmp_path / "klippylogs" / "klippy.log",
                        "Section 'earlier_run_section' is not a valid config section\n"
                        "Start printer at Mon Nov  9 10:00:00 2026\nconfigfile.ConfigError", now)
    proc_root = tmp_path / "proc"
    # A command line that names no klippy.py: only the pid Klipper reports can find the process.
    fake_process(proc_root, 1276, ("python3", "/opt/printer/main.py"), live_log)
    halted_info = {
        "state": "error", "process_id": 1276, "log_file": str(live_log),
        "state_message": "Section 'afc' is not a valid config section\nPrinter is halted",
    }
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: halted_info)
    monkeypatch.setattr(klipper_readiness.time, "sleep", lambda _s: None)
    monkeypatch.setattr(
        health.moonraker_client, "server_info",
        lambda _path: {"klippy_state": "error", "failed_components": [], "warnings": []},
    )
    monkeypatch.setattr(live_logs, "PROC_ROOT", proc_root)
    jinni = _HealthJinni({**_sockets(), "KLIPPER_LOG": str(stale_log)})

    report = jinni.health()

    assert report.services[KLIPPER_SERVICE].ready is False
    assert report.signals.sections == ("afc",)
    assert f"{live_log} ({live_logs.HELD_OPEN})" in report.signals.log_tails
    assert "stale_decoy_section" not in report.signals.log_tails


def test_a_ready_klippers_old_error_is_not_blamed_for_moonraker(
        monkeypatch: MP, tmp_path: Path) -> None:
    # Only a failing service's log is evidence: Klipper is ready, so the error its log kept from an
    # earlier run says nothing about the component Moonraker failed to load now.
    now = time.time()
    klipper_log = fake_log(tmp_path / "klippylogs" / "klippy.log",
                           "Section 'earlier_run_section' is not a valid config section", now)
    moonraker_log = fake_log(tmp_path / "logs" / "moonraker.log",
                             "ModuleNotFoundError: No module named 'plugin_dep'", now)
    proc_root = tmp_path / "proc"
    fake_process(proc_root, 1276, _KLIPPY_ARGV, klipper_log)
    fake_process(proc_root, 1291, _MOONRAKER_ARGV, moonraker_log)
    monkeypatch.setattr(klipper_readiness.klippy, "query_klippy_info", lambda _path: _READY_INFO)
    monkeypatch.setattr(
        health.moonraker_client, "server_info",
        lambda _path: {"klippy_state": "ready", "failed_components": ["plugin"], "warnings": []},
    )
    monkeypatch.setattr(live_logs, "PROC_ROOT", proc_root)

    report = _HealthJinni(_sockets()).health()

    assert report.signals.sections == ()
    assert report.signals.modules == ("plugin_dep",)
