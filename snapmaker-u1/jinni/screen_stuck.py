# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The U1 screen that woke up stuck: backlight on, picture black, and only a reboot brings it back.

The kernel tells it apart from an ordinary sleep with one of two lines from the display driver: the
driver could not attach its memory mapping when the screen woke. Every normal sleep and wake logs
other display warnings, and those never match. One recognizer serves both the live kernel line and
the ring buffer, and a match is remembered until the next boot.
"""
from pathlib import Path

from jinni import kernel_log

SCREEN_STUCK = "screen-stuck"
DISPLAY_DRIVER = "rockchip-vop2"
ATTACH_FAILURES = ("failed to attach dma mapping", "Failed to attach iommu device")
# /run is emptied at every boot, and a reboot is the only thing that brings the screen back, so the
# latch lives exactly as long as the fault. The ring buffer can wrap and lose the line; this cannot.
STUCK_LATCH = Path("/run/bespok3d-screen-stuck")


def recognize(kernel_line: str) -> str | None:
    """The token of the stuck screen when this kernel line reports it, None for any other line."""
    if DISPLAY_DRIVER not in kernel_line:
        return None
    if any(failure in kernel_line for failure in ATTACH_FAILURES):
        return SCREEN_STUCK
    return None


def watch_line(kernel_line: str) -> str | None:
    """Recognize one live kernel line, and remember a stuck screen until the next boot."""
    token = recognize(kernel_line)
    if token is not None:
        STUCK_LATCH.touch()
    return token


def reboot_tokens() -> list[str]:
    """The stuck screen as a reboot token when it was seen this boot, empty otherwise."""
    if STUCK_LATCH.exists():
        return [SCREEN_STUCK]
    kernel_lines = kernel_log.ring_buffer().splitlines()
    if not any(recognize(kernel_line) for kernel_line in kernel_lines):
        return []
    STUCK_LATCH.touch()
    return [SCREEN_STUCK]
