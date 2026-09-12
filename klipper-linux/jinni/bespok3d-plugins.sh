#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Run the plugin services Bespok3d autostarts, on a host where systemd owns the boot sequence. This
# is the systemd counterpart of the U1's S99bespok3d: bespok3d-plugins.service calls it with start
# at boot and stop at shutdown, and the daemon calls the same scripts directly while it is running.
#
# The daemon's own autostart entry (s10bespok3d-daemon) is deliberately skipped: the daemon is a
# systemd unit here and bespok3d.service already owns its lifecycle, so starting it from inside a
# unit that depends on it would fight over the same process.
#
# Nothing here needs root; it runs as the login user that owns the whole bespok3d tree.
BESPOK3D="${BESPOK3D:-$HOME/bespok3d}"
AUTOSTART="$BESPOK3D/etc/init.d/autostart"
RUN="$BESPOK3D/run"

# A pidfile outlives a reboot, after which its number belongs to whatever process the kernel handed
# it to next. Drop the ones that name nothing running, so a service is not reported as already up.
clean_stale_pids() {
    for pidfile in "$RUN"/*.pid; do
        [ -f "$pidfile" ] || continue
        pid=$(cat "$pidfile" 2>/dev/null)
        if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
            rm -f "$pidfile"
        fi
    done
}

plugin_scripts() {
    find "$AUTOSTART" -maxdepth 1 -name 's??*' ! -name 's10*' 2>/dev/null
}

run_one() {
    [ -x "$1" ] || return 0
    "$1" "$2"
}

# Ascending to start and descending to stop, so a plugin that needs an earlier one comes up after
# it and goes down before it.
do_start() {
    clean_stale_pids
    plugin_scripts | sort | while read -r script; do
        run_one "$script" start
    done
}

do_stop() {
    plugin_scripts | sort -r | while read -r script; do
        run_one "$script" stop
    done
}

do_status() {
    plugin_scripts | sort | while read -r script; do
        echo "[autostart] $(basename "$script"):"
        run_one "$script" status 2>&1 | sed 's/^/  /'
    done
}

case "$1" in
    start)   do_start ;;
    stop)    do_stop ;;
    restart) do_stop; sleep 1; do_start ;;
    status)  do_status ;;
    *)       echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac

exit 0
