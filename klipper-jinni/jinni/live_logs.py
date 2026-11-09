# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Find the log file a running Klipper or Moonraker really writes, never a stale one left behind.

Log locations differ between printers and firmware versions: the U1's firmware 2.1 moved Klipper's
log and left the old file in place, dead. So the running process is asked first: the log it holds
open (/proc/<pid>/fd), then, for Klipper, the `log_file` its own `info` reply names. Only when no
running process proves a file is the configured path used, and only if it was written recently.
`LiveLog.origin` always says how the file was found, so a fallback is never passed off as proven.
"""
import os
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import Path

PROC_ROOT = Path("/proc")
FRESH_LOG_WINDOW_S = 600
KLIPPER_SCRIPTS = frozenset({"klippy.py"})
MOONRAKER_SCRIPTS = frozenset({"moonraker.py"})

_LOG_SUFFIX = ".log"
HELD_OPEN = "held open by the running process"
REPORTED_BY_KLIPPER = "named by the running Klipper"


@dataclass(frozen=True)
class LiveLog:
    path: Path
    origin: str


def _cmdline(pid_dir: Path) -> tuple[str, ...]:
    try:
        raw_cmdline = (pid_dir / "cmdline").read_bytes()
    except OSError:
        return ()
    return tuple(arg.decode(errors="replace") for arg in raw_cmdline.split(b"\0") if arg)


def _runs_script(cmdline: tuple[str, ...], script_names: frozenset[str]) -> bool:
    """Match an argument's file name exactly: a substring match also hits any shell command that
    merely mentions the script."""
    return any(os.path.basename(arg) in script_names for arg in cmdline)


def service_pids(script_names: frozenset[str], proc_root: Path) -> tuple[int, ...]:
    try:
        pid_dirs = tuple(entry for entry in proc_root.iterdir() if entry.name.isdigit())
    except OSError:
        return ()
    return tuple(int(pid_dir.name) for pid_dir in pid_dirs
                 if _runs_script(_cmdline(pid_dir), script_names))


def _fd_target(fd_link: Path) -> Path | None:
    try:
        return Path(os.readlink(fd_link))
    except OSError:
        return None


def held_logs(pid: int, proc_root: Path) -> tuple[Path, ...]:
    """The regular .log files the process holds open. A rotated-away file reads as
    "<name> (deleted)", so the suffix test drops it."""
    try:
        fd_links = tuple((proc_root / str(pid) / "fd").iterdir())
    except OSError:
        return ()
    targets = (_fd_target(fd_link) for fd_link in fd_links)
    return tuple(target for target in targets
                 if target is not None and target.name.endswith(_LOG_SUFFIX) and target.is_file())


def _modified_at(log_path: Path) -> float | None:
    try:
        return log_path.stat().st_mtime
    except OSError:
        return None


def _held_by(pids: Iterable[int], proc_root: Path, service_log_name: str) -> LiveLog | None:
    """A process can hold several logs open (a plugin may write its own), so the file named like
    the service's log wins, and only then the most recently written one."""
    held = tuple(log_path for pid in pids for log_path in held_logs(pid, proc_root))
    chosen = max(held, default=None, key=lambda log_path: (
        log_path.name == service_log_name, _modified_at(log_path) or 0.0))
    return LiveLog(chosen, HELD_OPEN) if chosen is not None else None


def _reported_log_path(klipper_info: dict) -> str:
    """Only an absolute path is trusted: a relative one would resolve against the jinni's own
    working directory, not Klipper's."""
    named_path = klipper_info.get("log_file")
    return named_path if isinstance(named_path, str) and os.path.isabs(named_path) else ""


def _named_by_klipper(klipper_info: dict) -> LiveLog | None:
    named_path = _reported_log_path(klipper_info)
    if not named_path or not Path(named_path).is_file():
        return None
    return LiveLog(Path(named_path), REPORTED_BY_KLIPPER)


def _configured_candidates(configured_paths: str) -> tuple[Path, ...]:
    """Firmware versions that log to different places are all named, joined by os.pathsep."""
    return tuple(Path(log_path) for log_path in configured_paths.split(os.pathsep) if log_path)


def _configured_log_name(configured_paths: str) -> str:
    return next((candidate.name for candidate in _configured_candidates(configured_paths)), "")


def _fresh_candidate(configured_path: Path, now: float) -> LiveLog | None:
    modified_at = _modified_at(configured_path)
    if modified_at is None or now - modified_at > FRESH_LOG_WINDOW_S:
        return None
    age_s = int(now - modified_at)
    origin = f"configured path, no running process holds it, last written {age_s}s ago"
    return LiveLog(configured_path, origin)


def _fresh_configured(configured_paths: str, now: float) -> LiveLog | None:
    """The most recently written of the configured logs, if any was written recently."""
    fresh = tuple(filter(None, (_fresh_candidate(configured_path, now)
                                for configured_path in _configured_candidates(configured_paths))))
    return max(fresh, default=None, key=lambda live_log: _modified_at(live_log.path) or 0.0)


def _klipper_pids(klipper_info: dict, proc_root: Path) -> tuple[int, ...]:
    """The pid Klipper reports picks the right instance on a host running several printers."""
    reported_pid = klipper_info.get("process_id")
    if isinstance(reported_pid, int):
        return (reported_pid,)
    return service_pids(KLIPPER_SCRIPTS, proc_root)


def locate_klipper_log(klipper_info: dict, configured_paths: str,
                       proc_root: Path, now: float) -> LiveLog | None:
    klipper_log_name = (Path(_reported_log_path(klipper_info)).name
                        or _configured_log_name(configured_paths))
    return (_held_by(_klipper_pids(klipper_info, proc_root), proc_root, klipper_log_name)
            or _named_by_klipper(klipper_info)
            or _fresh_configured(configured_paths, now))


def locate_moonraker_log(configured_paths: str, proc_root: Path, now: float) -> LiveLog | None:
    """Moonraker serves no log path over its API, so only /proc proves its live log."""
    return (_held_by(service_pids(MOONRAKER_SCRIPTS, proc_root), proc_root,
                     _configured_log_name(configured_paths))
            or _fresh_configured(configured_paths, now))
