# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
from pathlib import Path

import pytest
import screen_log
from screen_log_lines import FORGET_LINE
from wifi_forget import ForgetWatch

HOME_NETWORK = 'network={\n\tssid="home"\n}\n'
NO_NETWORK = "ctrl_interface=/var/run/wpa_supplicant\n"
FAILED_FORGET_LINE = FORGET_LINE.replace("ret:0", "ret:-1")
OTHER_LINE = (
    "2026-11-23 09:25:14.257 (: 102) <Controller Klipper> {timer_1s_proc} run time:36380s\n"
)


class Printer:
    """The live config, the screen's log and the watch over them, all in the test's own folder."""

    def __init__(self, folder: Path) -> None:
        self.live_config = folder / "wpa_supplicant.conf"
        self.screen_log = folder / "gui.log"
        self.forgotten_mark = folder / "forgotten"
        self.watch = ForgetWatch(self.screen_log, self.forgotten_mark)
        self.screen_log.write_text(OTHER_LINE)

    def holds(self, config: str) -> None:
        self.live_config.write_text(config)

    def logs(self, screen_line: str) -> None:
        with self.screen_log.open("a") as log_file:
            log_file.write(screen_line)

    def round(self) -> bool:
        self.watch.follow(self.live_config)
        return self.watch.network_forgotten(self.live_config)

    def restarts_the_jinni(self) -> None:
        self.watch = ForgetWatch(self.screen_log, self.forgotten_mark)


@pytest.fixture
def printer(tmp_path: Path) -> Printer:
    return Printer(tmp_path)


def _forgotten_after_a_network(printer: Printer) -> bool:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    printer.logs(FORGET_LINE)
    return printer.round()


# The bug: a network forgotten on the screen came back within 30 seconds.
def test_a_forget_logged_after_a_network_counts(printer: Printer) -> None:
    assert _forgotten_after_a_network(printer)


def test_a_network_lost_without_a_forget_is_not_forgotten(printer: Printer) -> None:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    printer.logs(OTHER_LINE)
    assert not printer.round()


def test_a_forget_that_failed_does_not_count(printer: Printer) -> None:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    printer.logs(FAILED_FORGET_LINE)
    assert not printer.round()


# A firmware update can leave the live config with no network while an old forget is still in the
# log. That forget was spent long ago and must not stop the restore.
def test_a_forget_logged_before_the_jinni_saw_a_network_does_not_count(printer: Printer) -> None:
    printer.logs(FORGET_LINE)
    printer.holds(NO_NETWORK)
    assert not printer.round()


def test_a_forget_logged_before_the_last_network_does_not_count(printer: Printer) -> None:
    printer.logs(FORGET_LINE)
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    assert not printer.round()


def test_the_mark_outlasts_a_restart_of_the_jinni(printer: Printer) -> None:
    _forgotten_after_a_network(printer)
    printer.restarts_the_jinni()
    printer.screen_log.write_text(OTHER_LINE)
    assert printer.round()


def test_a_network_saved_again_ends_the_forget(printer: Printer) -> None:
    _forgotten_after_a_network(printer)
    printer.holds(HOME_NETWORK)
    assert not printer.round()
    assert not printer.forgotten_mark.exists()


def test_a_forget_written_across_two_rounds_is_still_found(printer: Printer) -> None:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    cut = FORGET_LINE.index("Forget")
    printer.logs(FORGET_LINE[:cut])
    assert not printer.round()
    printer.logs(FORGET_LINE[cut:])
    assert printer.round()


def test_a_forget_in_a_rotated_log_counts(printer: Printer) -> None:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    printer.screen_log.rename(printer.screen_log.with_name("gui.log.0"))
    printer.screen_log.write_text(FORGET_LINE)
    assert printer.round()


def test_no_screen_log_means_no_forget(printer: Printer) -> None:
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.screen_log.unlink()
    printer.holds(NO_NETWORK)
    assert not printer.round()


def test_a_long_log_is_read_only_at_its_end(
    monkeypatch: pytest.MonkeyPatch, printer: Printer,
) -> None:
    monkeypatch.setattr(screen_log, "LOG_READ_LIMIT_BYTES", len(FORGET_LINE))
    printer.holds(HOME_NETWORK)
    printer.round()
    printer.holds(NO_NETWORK)
    printer.logs(OTHER_LINE * 3 + FORGET_LINE)
    assert printer.round()
