# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Read the kernel's out-of-memory evidence: whether the OOM killer fired and what it took.

Generic across linux: the cumulative kill count is /proc/vmstat's `oom_kill` line, the most recent
victim the kernel ring buffer's `Killed process <pid> (<comm>)` line. Pure over the two text reads
so the jinni tests it without a device; the probing facet supplies the real /proc and dmesg reads.
Detection for the constrained-board safety net; nothing here prevents an OOM (ADR-0037).

It reports the kill and the victim, not a core-versus-auxiliary verdict. Which victim is a core
print service is not knowable from the comm (Klipper and Moonraker run as `python3`, and there are
several python processes), so a comm match cannot tell a lost print from a sacrificed plugin. That
verdict needs the real board (pid-to-service mapping, verified against a real kill) and is a
documented follow-up (ADR-0040). A lost core service also surfaces as unhealthy in `health()`.
"""
import re

from protocol import OomReport

_OOM_KILL_COUNT = re.compile(r"^oom_kill\s+(\d+)", re.MULTILINE)
_VICTIM = re.compile(r"Killed process \d+ \(([^)]+)\)")
_OOM_TOKEN = "oom-kill"


def oom_kill_count(vmstat: str) -> int:
    """The kernel's cumulative oom_kill counter since boot, 0 when the line is absent (a kernel that
    does not export it, or the killer never fired)."""
    match = _OOM_KILL_COUNT.search(vmstat)
    return int(match.group(1)) if match else 0


def latest_victim(ring_buffer: str) -> str:
    """The process name in the most recent `Killed process N (comm)` line the ring buffer still
    holds, "" when it holds none (the line aged out, or no kill this buffer)."""
    victims = _VICTIM.findall(ring_buffer)
    return victims[-1] if victims else ""


def build_report(vmstat: str, ring_buffer: str) -> OomReport:
    """Fold the two reads into a report. The count gates whether the killer fired at all; the victim
    line names what it took most recently. A positive count whose victim line has aged out still
    reports the kill with a generic detail."""
    kills = oom_kill_count(vmstat)
    if kills == 0:
        return OomReport(kills=0)
    detail = _victim_detail(latest_victim(ring_buffer))
    return OomReport(kills=kills, token=_OOM_TOKEN, detail=detail)


def _victim_detail(victim: str) -> str:
    return f"the kernel killed process ({victim})" if victim else "an out-of-memory kill occurred"
