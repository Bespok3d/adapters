#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# The daemon's autostart entry, placed at $BESPOK3D/etc/init.d/autostart/s10bespok3d-daemon.
#
# On this host the daemon is a systemd unit, so this script owns nothing: it is the thin wrapper
# that keeps the s10bespok3d-daemon convention the app's daemon operations call, and hands each
# verb to systemd. The three verbs that need root are the exact commands the sudoers drop-in
# allows, with -n so they fail fast rather than wait on a prompt no one can answer. Reading the
# state needs no privilege at all.
case "$1" in
    start|stop|restart) sudo -n /usr/bin/systemctl "$1" bespok3d ;;
    status)             systemctl is-active bespok3d ;;
    *)                  echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac
