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
from itertools import takewhile

from protocol import FailureSignals

from .klipper_vocab import KLIPPER_SERVICE, MOONRAKER_SERVICE
from .live_logs import LiveLog
from .log_tail import KLIPPER_RUN_START, MOONRAKER_RUN_START, current_run, read_log_tail

_CONFIG_SECTION_RE = re.compile(r"(?:[Ss]ection|config object)\s+'([^']+)'")
_NO_MODULE_RE = re.compile(r"No module named '([^']+)'")
_IMPORT_ERROR_RE = re.compile(r"(?:ImportError|ModuleNotFoundError):[^\n]*?'([A-Za-z0-9_.]+)'")
_TRACEBACK_FILE_RE = re.compile(r'File "(/[^"]+\.py)"')
# Only a header at the start of a line: an exception group's own sub-tracebacks are indented.
_TRACEBACK_START_RE = re.compile(r"^Traceback \(most recent call last\):", re.MULTILINE)
_CHAINED_EXCEPTION_MARKERS = (
    "During handling of the above exception, another exception occurred:",
    "The above exception was the direct cause of the following exception:",
)


def _failing_config_section(log_text: str) -> tuple[str, ...]:
    match = _CONFIG_SECTION_RE.search(log_text)
    return (match.group(1).strip(),) if match else ()


def _failing_import_module(log_text: str) -> tuple[str, ...]:
    for pattern in (_NO_MODULE_RE, _IMPORT_ERROR_RE):
        match = pattern.search(log_text)
        if match:
            return (match.group(1).split(".")[0],)
    return ()


def _chains_into_next(traceback_block: str) -> bool:
    return traceback_block.rstrip().endswith(_CHAINED_EXCEPTION_MARKERS)


def _last_traceback(log_text: str) -> str:
    """The last traceback in the text, together with the tracebacks Python chained in front of it.
    An earlier traceback that stands alone is an error the service survived, so it is left out. A
    text without a traceback header is taken whole."""
    tracebacks = _TRACEBACK_START_RE.split(log_text)[1:]
    if not tracebacks:
        return log_text
    chained_newest_first = list(takewhile(_chains_into_next, reversed(tracebacks[:-1])))
    return "\n".join([*reversed(chained_newest_first), tracebacks[-1]])


def _failing_files(log_text: str) -> tuple[str, ...]:
    """Every file in the failing traceback, the frame that raised first. The last frame is often
    Klipper's own code called by a plugin, so the daemon gets them all and blames the first one a
    plugin placed."""
    frames = _TRACEBACK_FILE_RE.findall(_last_traceback(log_text))
    return tuple(dict.fromkeys(reversed(frames)))


def _format_tails(labelled_tails: tuple[tuple[str, str], ...]) -> str:
    sections = []
    for label, tail in labelled_tails:
        clean = tail.strip()
        if clean:
            sections.append(f"--- {label} ---\n{clean}")
    return "\n\n".join(sections)


def _first_signal(extract: Callable[[str], tuple[str, ...]],
                  texts_by_priority: tuple[str, ...]) -> tuple[str, ...]:
    return next(filter(None, map(extract, texts_by_priority)), ())


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
        files=_first_signal(_failing_files, texts_by_priority),
        log_tails=_format_tails(labelled_tails),
    )
