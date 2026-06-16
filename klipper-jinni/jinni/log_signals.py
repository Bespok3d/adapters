"""Read the printer's service logs and pull failure SIGNALS out of them (ADR-0037: device-side).

Reading and parsing a Klipper/Moonraker log, which config section / import / file failed, and the
user-facing tail, is the jinni's; the daemon only maps a signal identifier to a plugin via its own
placement records. `health()` folds these into the boundary `FailureSignals` when a restarted
service did not come back up.
"""
import re
from pathlib import Path

from protocol import FailureSignals

_CONFIG_SECTION_RE = re.compile(r"(?:[Ss]ection|config object)\s+'([^']+)'")
_NO_MODULE_RE = re.compile(r"No module named '([^']+)'")
_IMPORT_ERROR_RE = re.compile(r"(?:ImportError|ModuleNotFoundError):[^\n]*?'([A-Za-z0-9_.]+)'")
_TRACEBACK_FILE_RE = re.compile(r'File "(/[^"]+\.py)"')

_LOG_TAIL_BYTES = 16384


def _read_bytes(path: Path, max_bytes: int) -> str:
    try:
        return path.read_bytes()[-max_bytes:].decode(errors="replace")
    except OSError:
        return ""


def read_log_tail(path: Path, max_bytes: int = _LOG_TAIL_BYTES) -> str:
    """Tail the live log; if it is empty (a restart rotated it out from under us), fall back to the
    rotated sibling so the crash that triggered the rotation is still recovered."""
    live = _read_bytes(path, max_bytes)
    if live.strip():
        return live
    for suffix in (".1", ".prev"):
        rotated = _read_bytes(path.with_name(path.name + suffix), max_bytes)
        if rotated.strip():
            return rotated
    return live


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


def _format_tails(klipper_tail: str, moonraker_tail: str) -> str:
    sections = []
    for label, tail in (("Klipper", klipper_tail), ("Moonraker", moonraker_tail)):
        clean = tail.strip()
        if clean:
            sections.append(f"--- {label} log ---\n{clean}")
    return "\n\n".join(sections)


def read_failure_signals(klipper_log_path: str, moonraker_log_path: str) -> FailureSignals:
    """Read the printer's logs and pull the failure identifiers plus the user-facing tail out of
    them. The daemon maps an identifier to the plugin that placed it; it never reads the log."""
    klipper_tail = read_log_tail(Path(klipper_log_path)) if klipper_log_path else ""
    moonraker_tail = read_log_tail(Path(moonraker_log_path)) if moonraker_log_path else ""
    combined = f"{klipper_tail}\n{moonraker_tail}"
    sections = tuple(section for section in (_failing_config_section(combined),) if section)
    modules = tuple(module for module in (_failing_import_module(combined),) if module)
    files = tuple(path for path in (_failing_file(combined),) if path)
    return FailureSignals(
        sections=sections, modules=modules, files=files,
        log_tails=_format_tails(klipper_tail, moonraker_tail),
    )
