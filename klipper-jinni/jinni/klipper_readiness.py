# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Is Klipper ready? The verdict plus Klipper's own `info` reply that backs it.

The `info` reply is kept because it says more than ready / not ready: `state_message` names the
error that halted Klipper, and `process_id` / `log_file` say which log the running Klipper writes.
The API socket is asked first (auth-free, so it survives the moonraker-auth plugin's force_logins);
Moonraker's HTTP /printer/info, which relays the same reply, is the fallback.
"""
import json
import time
from dataclasses import dataclass, field, replace

from .inspection import ServiceProbe
from .printer_comms import klippy

KLIPPER_RETRIES = 6
KLIPPER_RETRY_DELAY_S = 5

_KLIPPER_INFO_URL = "http://localhost:7125/printer/info"
_READY_STATE = "ready"


@dataclass(frozen=True)
class KlipperReadiness:
    """`info` is Klipper's own `info` reply, or {} when no reply carried one."""
    ready: bool
    detail: str
    info: dict = field(default_factory=dict)


def _readiness_from_info(info: dict, channel: str) -> KlipperReadiness:
    state = str(info.get("state", ""))
    detail = f"klippy state via {channel}: {state or 'unknown'}"
    return KlipperReadiness(ready=state == _READY_STATE, detail=detail, info=info)


def _klipper_info_in(body: str) -> dict | None:
    try:
        reply = json.loads(body)
    except ValueError:
        return None
    result = reply.get("result") if isinstance(reply, dict) else None
    return result if isinstance(result, dict) and "state" in result else None


def _readiness_from_http(up: bool, body: str) -> KlipperReadiness:
    """Moonraker answers /printer/info with HTTP 200 even when Klipper is halted ("state": "error"),
    so a 200 alone is not readiness: the state inside decides. A body that is not Klipper's reply
    (the auth-required note behind force_logins) keeps the probe's up / down."""
    info = _klipper_info_in(body) if up else None
    if info is None:
        return KlipperReadiness(ready=up, detail=body)
    return _readiness_from_info(info, "http")


def _klipper_ready_once(socket_path: str, service_get: ServiceProbe) -> KlipperReadiness:
    info = klippy.query_klippy_info(socket_path) if socket_path else None
    if info is not None:
        return _readiness_from_info(info, "api socket")
    up, body = service_get(_KLIPPER_INFO_URL)
    return _readiness_from_http(up, body)


def _with_known_info(readiness: KlipperReadiness, known_info: dict) -> KlipperReadiness:
    """A later attempt can get no reply from Klipper (socket briefly gone, HTTP behind a login);
    the error an earlier reply named still explains the failure."""
    return readiness if readiness.info else replace(readiness, info=known_info)


def klipper_healthy(socket_path: str, service_get: ServiceProbe) -> KlipperReadiness:
    """Klipper's readiness, retrying while it is still coming back after a restart."""
    readiness = KlipperReadiness(ready=False, detail="")
    for attempt in range(KLIPPER_RETRIES):
        readiness = _with_known_info(_klipper_ready_once(socket_path, service_get), readiness.info)
        if readiness.ready:
            return readiness
        if attempt < KLIPPER_RETRIES - 1:
            time.sleep(KLIPPER_RETRY_DELAY_S)
    return readiness
