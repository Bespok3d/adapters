# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""A stuck screen is recognized from its two driver lines only, and remembered until the next boot.

The fault lines are the ones a U1 logged while its screen was stuck. The ordinary lines carry the
phrases every sleep and wake logs: the old display-pipe-wedged check matched those, and it then
accused every healthy printer whose screen went to sleep.
"""
from pathlib import Path

import pytest
import screen_stuck

IOMMU_ATTACH_FAILED = (
    "rockchip-vop2 ff400000.vop: [drm:rockchip_drm_dma_attach_device] *ERROR* Failed to attach"
    " iommu device"
)
DMA_MAPPING_FAILED = (
    "rockchip-vop2 ff400000.vop: [drm:vop2_crtc_atomic_flush] *ERROR* vp0 failed to attach dma"
    " mapping, -16"
)
FAULT_LINES = (IOMMU_ATTACH_FAILED, DMA_MAPPING_FAILED)
HEALTHY_LINES = (
    "rockchip-vop2 ff400000.vop: *ERROR* wait win close timeout",
    "rockchip-vop2 ff400000.vop: *ERROR* wait for vp0 dsp_hold timeout",
    "rk_iommu ff900800.iommu: stall request timed out, status: 0x00004b",
    "usb 1-1: new high-speed USB device number 2 using xhci-hcd",
)
# The attach phrase alone is not enough: only the display driver's own line is the stuck screen.
ATTACH_FAILED_ELSEWHERE = "rk_iommu ff900800.iommu: Failed to attach iommu device"

pytestmark = pytest.mark.usefixtures("stuck_latch")


def dmesg_form(message: str) -> str:
    return f"[  123.456789] {message}"


def kmsg_form(message: str) -> str:
    return f"3,1234,123456789,-;{message}"


def ring_buffer_holding(monkeypatch: pytest.MonkeyPatch, kernel_lines: tuple[str, ...]) -> None:
    ring_buffer = "\n".join(dmesg_form(kernel_line) for kernel_line in kernel_lines)
    monkeypatch.setattr(screen_stuck.kernel_log, "ring_buffer", lambda: ring_buffer)


@pytest.mark.parametrize("fault_line", FAULT_LINES)
def test_a_fault_line_from_dmesg_is_a_stuck_screen(fault_line: str) -> None:
    assert screen_stuck.recognize(dmesg_form(fault_line)) == screen_stuck.SCREEN_STUCK


@pytest.mark.parametrize("fault_line", FAULT_LINES)
def test_a_fault_record_from_kmsg_is_a_stuck_screen(fault_line: str) -> None:
    assert screen_stuck.recognize(kmsg_form(fault_line)) == screen_stuck.SCREEN_STUCK


@pytest.mark.parametrize("healthy_line", HEALTHY_LINES)
def test_a_sleeping_screen_or_an_unrelated_line_is_not_a_stuck_screen(healthy_line: str) -> None:
    assert screen_stuck.recognize(dmesg_form(healthy_line)) is None
    assert screen_stuck.recognize(kmsg_form(healthy_line)) is None


def test_an_attach_failure_from_another_driver_is_not_a_stuck_screen() -> None:
    assert screen_stuck.recognize(kmsg_form(ATTACH_FAILED_ELSEWHERE)) is None


def test_a_live_fault_line_latches_the_stuck_screen(stuck_latch: Path) -> None:
    assert screen_stuck.watch_line(kmsg_form(DMA_MAPPING_FAILED)) == screen_stuck.SCREEN_STUCK
    assert stuck_latch.exists()


def test_a_live_healthy_line_latches_nothing(stuck_latch: Path) -> None:
    assert screen_stuck.watch_line(kmsg_form(HEALTHY_LINES[0])) is None
    assert not stuck_latch.exists()


def test_a_healthy_ring_buffer_needs_no_reboot(
    monkeypatch: pytest.MonkeyPatch, stuck_latch: Path,
) -> None:
    ring_buffer_holding(monkeypatch, HEALTHY_LINES)
    assert screen_stuck.reboot_tokens() == []
    assert not stuck_latch.exists()


def test_a_stuck_ring_buffer_needs_a_reboot_and_latches_it(
    monkeypatch: pytest.MonkeyPatch, stuck_latch: Path,
) -> None:
    ring_buffer_holding(monkeypatch, (*HEALTHY_LINES, IOMMU_ATTACH_FAILED))
    assert screen_stuck.reboot_tokens() == [screen_stuck.SCREEN_STUCK]
    assert stuck_latch.exists()


def test_the_latch_is_read_back_after_the_ring_buffer_lost_the_line(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    ring_buffer_holding(monkeypatch, (DMA_MAPPING_FAILED,))
    screen_stuck.reboot_tokens()
    ring_buffer_holding(monkeypatch, HEALTHY_LINES)
    assert screen_stuck.reboot_tokens() == [screen_stuck.SCREEN_STUCK]
