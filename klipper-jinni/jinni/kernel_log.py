"""Read the kernel ring buffer (`dmesg`): the one low-level read the kernel diagnostics share.

Both the module-load classifier (a failed insmod) and the out-of-memory probe (the OOM killer's
victim line) read the same ring buffer, so the read, its timeout, and its failure mode live in one
place. Empty when dmesg is unavailable, so a caller just reports no known cause.
"""
import subprocess

_DMESG_TIMEOUT_S = 3


def ring_buffer() -> str:
    try:
        done = subprocess.run(["dmesg"], capture_output=True, text=True,
                              timeout=_DMESG_TIMEOUT_S, check=False)
        return done.stdout
    except (OSError, subprocess.SubprocessError):
        return ""
