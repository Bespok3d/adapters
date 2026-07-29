# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Classify a generated start command by its effect on the device's services (ADR-0037).

Does a command restart a core service (so the batch defers it and the print guard blocks it
mid-print), or is it inert? The generic restart/start/reload verb is the only device-agnostic part;
the service names come from the klipper vocab and the init-dir markers and display tokens come from
the device jinni. The realization facet calls `classify_one` per command for classify_commands.
"""
import re

from protocol import CommandEffect

from .klipper_vocab import (
    KLIPPER_SERVICE,
    MOONRAKER_SERVICE,
    RESTART_DISPLAY,
    RESTART_KLIPPER,
    RESTART_MOONRAKER,
)

# A restart/start/reload verb against a service. The generic verb is the only part of command
# classification that is device-agnostic; the service names and device tokens come from the tier.
_SERVICE_ACTION_RE = re.compile(r"\b(?:restart|start|reload)\b")

INERT_COMMAND = CommandEffect(deferrable=False, restarts_services=(), blocking_token=None)


def _blocking_token(restarts: tuple[str, ...], restarts_display: bool) -> str | None:
    if KLIPPER_SERVICE in restarts:
        return RESTART_KLIPPER
    if MOONRAKER_SERVICE in restarts:
        return RESTART_MOONRAKER
    if restarts_display:
        return RESTART_DISPLAY
    return None


def _restarted_services(command: str) -> tuple[str, ...]:
    return tuple(service for service in (KLIPPER_SERVICE, MOONRAKER_SERVICE) if service in command)


def classify_one(command: str, markers: tuple[str, ...], display_tokens: tuple[str, ...]) -> CommandEffect:  # noqa: E501
    if not _SERVICE_ACTION_RE.search(command):
        return INERT_COMMAND
    restarts = _restarted_services(command)
    restarts_display = any(token in command for token in display_tokens)
    token = _blocking_token(restarts, restarts_display)
    return CommandEffect(
        deferrable=token is not None or any(marker in command for marker in markers),
        restarts_services=restarts,
        blocking_token=token,
    )
