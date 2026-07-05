"""Board-class detection for the U1: the standard board vs the neutered 512MB variant.

Total RAM is the signal: the constrained board falls below the threshold, the standard board sits
above it. The variant engine selects a lighter build on a `constrained` board, and the
constrained-board resource policy budgets against it. Read defensively: a box whose memory cannot be
read reports `unknown` rather than mis-claiming a class.
"""
from pathlib import Path

CONSTRAINED = "constrained"
STANDARD = "standard"
UNKNOWN = "unknown"

# The 512MB board reports well under this once reserved memory is taken out; the standard board
# (1GB+) sits above it, so the split is unambiguous.
_CONSTRAINED_CEILING_KB = 640 * 1024
_MEMINFO = Path("/proc/meminfo")

# "MemTotal:  <kB>  kB": the value is the second whitespace-split field.
_VALUE_FIELD = 1


def board_class() -> str:
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
