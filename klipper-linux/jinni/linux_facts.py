# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The static facts a Klipper on Linux host reports about itself.

These are the variant dimensions the daemon matches a plugin's `when` against (architecture, board
class, kernel release) plus the two version strings the app shows. Every one of them is read
defensively: a host that cannot answer reports `unknown` rather than a guess, because a wrong fact
here selects the wrong build of a plugin.

The host is an ordinary Debian style box, so nothing in here is Voron specific: a Raspberry Pi, a
BTT CB1 and an x86 box all answer the same way.
"""
import platform
import subprocess
from pathlib import Path

CONSTRAINED = "constrained"
STANDARD = "standard"
UNKNOWN = "unknown"

# A Pi Zero 2 W or a 512MB CB1 reads well under this once reserved memory is taken out; a 1GB or
# larger board sits above it, so the split is unambiguous.
_CONSTRAINED_CEILING_KB = 640 * 1024
_MEMINFO = Path("/proc/meminfo")
_OS_RELEASE = Path("/etc/os-release")
_FACT_TIMEOUT_S = 3
# "MemTotal:  <kB>  kB": the value is the second whitespace separated field.
_VALUE_FIELD = 1


def arch() -> str:
    """The CPU architecture a native artifact must target: aarch64 on a 64 bit Pi image, x86_64 on
    a mini PC. The adapter refuses a 32 bit host at enrolment, so armv7l never reaches here."""
    return platform.machine() or UNKNOWN


def board_class() -> str:
    """The board's resource tier, so a plugin with a lighter build gets it on a starved board."""
    total_kb = _mem_total_kb()
    if total_kb is None:
        return UNKNOWN
    return CONSTRAINED if total_kb <= _CONSTRAINED_CEILING_KB else STANDARD


def _mem_total_kb() -> int | None:
    try:
        lines = _MEMINFO.read_text().splitlines()
    except OSError:
        return None
    totals = [line for line in lines if line.startswith("MemTotal:")]
    return _parse_kb(totals[0]) if totals else None


def _parse_kb(mem_total_line: str) -> int | None:
    fields = mem_total_line.split()
    if len(fields) <= _VALUE_FIELD:
        return None
    value = fields[_VALUE_FIELD]
    return int(value) if value.isdigit() else None


def os_version() -> str:
    """What this host reports as its OS version, which is the closest thing a Linux printer host
    has to the firmware version a stock printer reports: `12` on Bookworm, `13` on Trixie."""
    try:
        lines = _OS_RELEASE.read_text().splitlines()
    except OSError:
        return UNKNOWN
    versions = [line for line in lines if line.startswith("VERSION_ID=")]
    return versions[-1].split("=", 1)[1].strip().strip('"') if versions else UNKNOWN


def kernel_release() -> str:
    """The running kernel's release string. This host loads no Bespok3d kernel module, so the
    release is reported for the record and for a plugin that pins one, not to build against."""
    return _first_line(["uname", "-r"])


def klipper_version(klipper_source: str) -> str:
    """The Klipper checkout's own description of itself, which is what Klipper's own version string
    is built from. KLIPPER_SRC points at `<checkout>/klippy`, so the repository is its parent."""
    checkout = str(Path(klipper_source).parent) if klipper_source else ""
    if not checkout:
        return UNKNOWN
    return _first_line(
        ["git", "-C", checkout, "describe", "--always", "--tags", "--long", "--dirty"]
    )


def _first_line(command: list[str]) -> str:
    try:
        completed = subprocess.run(
            command, capture_output=True, text=True, timeout=_FACT_TIMEOUT_S, check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return UNKNOWN
    return completed.stdout.strip() or UNKNOWN
