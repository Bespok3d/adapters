# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
"""The klipper jinni's vocabulary: the service names it reports and the action tokens it emits.

These are device vocabulary, not the shared protocol: a klipper printer is the thing that has a
Klipper service, a Moonraker service, and a print a restart of either would interrupt. The jinni
authors these strings; the daemon only relays them (a service name as a `DeviceHealth.services` key,
a token in a `CommandEffect`), never naming one itself. A leaf module so every klipper facet
(realization, health, the composition root) shares one definition.
"""

# Service names the jinni keys its `DeviceHealth` report by. The daemon's safety net iterates the
# report and relays these as labels; it never indexes by a name it authored.
KLIPPER_SERVICE = "klipper"
MOONRAKER_SERVICE = "moonraker"

# Blocked-action tokens (ADR-0037): the machine vocabulary the jinni emits for "what a running print
# forbids right now". The jinni tags each restart command and reports the live blocked set; the
# daemon relays the token verbatim and the client localizes it, never turning one into a sentence.
RESTART_KLIPPER = "restart-klipper"
RESTART_MOONRAKER = "restart-moonraker"
RESTART_DISPLAY = "restart-display"
