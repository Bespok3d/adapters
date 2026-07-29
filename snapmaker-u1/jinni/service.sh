#!/bin/sh
# SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
# SPDX-License-Identifier: AGPL-3.0-or-later
# Managed-service init script template for the Snapmaker U1 (SysV / start-stop-daemon).
# The jinni fills the __SENTINELS__ per service before placing the script. Edit this file as the
# shell script it is; the sentinels are the only thing substituted.
PIDFILE=__PIDFILE__
LOG=__LOG__

start() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "__NAME__: already running"
        return 0
    fi
    printf "Starting __NAME__: "
    start-stop-daemon -S -b -m -p "$PIDFILE" -x /bin/sh -- -c "exec __EXEC__ >>$LOG 2>&1"
    echo "OK"
}

stop() {
    printf "Stopping __NAME__: "
    start-stop-daemon -K -q -p "$PIDFILE" 2>/dev/null || true
    rm -f "$PIDFILE"
    echo "OK"
}

status() {
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        echo "__NAME__: running (pid $(cat "$PIDFILE"))"
    else
        echo "__NAME__: stopped"
    fi
}

case "$1" in
    start)          start ;;
    stop)           stop ;;
    restart|reload) stop; sleep 1; start ;;
    status)         status ;;
    *)              echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac

exit 0
