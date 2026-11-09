# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read the printer's service logs and pull failure SIGNALS out of them (ADR-0037: device-side).

Reading and parsing a Klipper/Moonraker log, which config section / import / file failed, and the
user-facing tail, is the jinni's; the daemon only maps a signal identifier to a plugin via its own
placement records. `health()` folds these into the boundary `FailureSignals` when a restarted
service did not come back up. Only a failing service's current run is evidence: a healthy service's
log, or an error an earlier run left behind, says nothing about what broke now.
"""
import re
from collections.abc import Callable

from protocol import FailureSignals

from .klipper_vocab import KLIPPER_SERVICE, MOONRAKER_SERVICE
from .live_logs import LiveLog
from .log_tail import KLIPPER_RUN_START, MOONRAKER_RUN_START, current_run, read_log_tail

_CONFIG_SECTION_RE = re.compile(r"(?:[Ss]ection|config object)\s+'([^']+)'")
_NO_MODULE_RE = re.compile(r"No module named '([^']+)'")
_IMPORT_ERROR_RE = re.compile(r"(?:ImportError|ModuleNotFoundError):[^\n]*?'([A-Za-z0-9_.]+)'")
_TRACEBACK_FILE_RE = re.compile(r'File "(/[^"]+\.py)"')


def _failing_config_section(log_text: str) -> str | None:
    match = _CONFIG_SECTION_RE.search(log_text)
    return match.group(1).strip() if match else None


def _failing_import_module(log_text: str) -> str | None:
    for pattern in (_NO_MODULE_RE, _IMPORT_ERROR_RE):
        match = pattern.search(log_text)
        if match:
            return match.group(1).split(".")[0]
    return None


def _failing_file(log_text: str) -> str | None:
    matches = _TRACEBACK_FILE_RE.findall(log_text)
    return matches[-1] if matches else None


def _format_tails(labelled_tails: tuple[tuple[str, str], ...]) -> str:
    sections = []
    for label, tail in labelled_tails:
        clean = tail.strip()
        if clean:
            sections.append(f"--- {label} ---\n{clean}")
    return "\n\n".join(sections)


def _first_signal(extract: Callable[[str], str | None],
                  texts_by_priority: tuple[str, ...]) -> tuple[str, ...]:
    signal = next((found for found in map(extract, texts_by_priority) if found), None)
    return (signal,) if signal else ()


def _tail_of(live_log: LiveLog | None) -> str:
    return read_log_tail(live_log.path) if live_log is not None else ""


def _log_label(service: str, live_log: LiveLog | None) -> str:
    if live_log is None:
        return f"{service} log"
    return f"{service} log: {live_log.path} ({live_log.origin})"


def read_failure_signals(klipper_log: LiveLog | None, moonraker_log: LiveLog | None,
                         klipper_state_message: str,
                         failing_services: frozenset[str]) -> FailureSignals:
    """Read the printer's live logs and pull the failure identifiers plus the user-facing tail out
    of them. The daemon maps an identifier to the plugin that placed it; it never reads the log."""
    klipper_tail = _tail_of(klipper_log)
    moonraker_tail = _tail_of(moonraker_log)
    # Klipper's state message names the error that halted it NOW, so it goes first: only the first
    # signal found counts. Klipper's text outranks Moonraker's when both services failed.
    evidence_by_service = (
        (KLIPPER_SERVICE, "\n".join((
            klipper_state_message, current_run(klipper_tail, KLIPPER_RUN_START)))),
        (MOONRAKER_SERVICE, current_run(moonraker_tail, MOONRAKER_RUN_START)),
    )
    texts_by_priority = tuple(evidence for service, evidence in evidence_by_service
                              if service in failing_services)
    labelled_tails = (
        ("Klipper state", klipper_state_message),
        (_log_label("Klipper", klipper_log), klipper_tail),
        (_log_label("Moonraker", moonraker_log), moonraker_tail),
    )
    return FailureSignals(
        sections=_first_signal(_failing_config_section, texts_by_priority),
        modules=_first_signal(_failing_import_module, texts_by_priority),
        files=_first_signal(_failing_file, texts_by_priority),
        log_tails=_format_tails(labelled_tails),
    )
