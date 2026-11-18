# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A printer names the states only a power cycle clears; a generic one names none (ADR-0037).

The knowledge of what wedges is the device's, so the base tier answers empty rather than guessing:
a box whose jinni knows nothing about a display pipe reports nothing and the app offers nothing.
`reboot_required` is on every jinni, so the daemon can ask any printer without knowing which tier
answered.
"""
import subprocess
from typing import Any

import pytest

from jinni import reboot_needs
from jinni.klipper import KlipperPrinterJinni

STUCK_SCREEN_LINE = (
    "rockchip-vop2 ff400000.vop: [drm:vop2_crtc_atomic_flush] *ERROR* vp0 failed to attach dma"
    " mapping, -16"
)


def test_generic_klipper_printer_names_no_reboot_condition() -> None:
    assert KlipperPrinterJinni().reboot_required() == []


def test_every_jinni_answers_the_reboot_question() -> None:
    assert callable(KlipperPrinterJinni().reboot_required)


def test_a_generic_printer_recognises_no_kernel_line() -> None:
    assert KlipperPrinterJinni().watch_line(STUCK_SCREEN_LINE) is None


def test_reboot_printer_starts_a_detached_reboot(monkeypatch: pytest.MonkeyPatch) -> None:
    started: list[tuple[list[str], dict[str, Any]]] = []
    monkeypatch.setattr(
        reboot_needs.subprocess, "Popen",
        lambda command, **options: started.append((command, options)),
    )

    KlipperPrinterJinni().reboot_printer()

    command, options = started[0]
    assert command == ["reboot"]
    assert options["start_new_session"] is True
    assert options["stdout"] is subprocess.DEVNULL
