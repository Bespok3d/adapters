"""The out-of-memory probing facet: read the kernel's OOM evidence for the constrained-board net.

Detection (ADR-0037): the cumulative oom_kill counter from /proc/vmstat and the most recent victim
from the kernel ring buffer. Its own facet so live-print probing stays one concern. The daemon
relays the report and prevents nothing.
"""
from pathlib import Path

from protocol import OomReport

from . import kernel_log, oom

_VMSTAT = Path("/proc/vmstat")


def _proc_vmstat() -> str:
    """The kernel's /proc/vmstat, where the cumulative oom_kill counter lives. Empty when it cannot
    be read, so the report just shows no kills."""
    try:
        return _VMSTAT.read_text()
    except OSError:
        return ""


class OomProbe:
    def oom_report(self) -> OomReport:
        """The kernel's out-of-memory evidence, read live: the cumulative kill count and the most
        recent victim. Detection only (ADR-0037): the jinni reads the device, the daemon relays;
        nothing here prevents an OOM."""
        return oom.build_report(_proc_vmstat(), kernel_log.ring_buffer())
