# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A printer names the states only a power cycle clears; a generic one names none (ADR-0037).

The knowledge of what wedges is the device's, so the base tier answers empty rather than guessing:
a box whose jinni knows nothing about a display pipe reports nothing and the app offers nothing.
`reboot_required` is on every jinni, so the daemon can ask any printer without knowing which tier
answered.
"""
from jinni.klipper import KlipperPrinterJinni


def test_generic_klipper_printer_names_no_reboot_condition() -> None:
    assert KlipperPrinterJinni().reboot_required() == []


def test_every_jinni_answers_the_reboot_question() -> None:
    assert callable(KlipperPrinterJinni().reboot_required)
