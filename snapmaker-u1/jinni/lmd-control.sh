#!/bin/sh
# Hardened lmd/unisrv control for the Snapmaker U1, owned by the jinni and placed at
# $BESPOK3D/etc/init.d/lmdctl by the daemon. The compositor `unisrv` (spawned by /usr/bin/lmd)
# crashes on SIGTERM (its graceful shutdown hits std::terminate -> 210MB core, and can wedge the
# VOP2 display pipe). We always stop it with SIGKILL, which is clean. `gui` is a separate renderer
# and is never touched here. The __BESPOK3D__ sentinel is filled by the jinni before placement.
BESPOK3D=__BESPOK3D__
RUN=$BESPOK3D/run
PIDFILE=$RUN/unisrv.pid
DPI_STATE=/sys/class/drm/card0/card0-DPI-1/enabled
FB_BLANK=/sys/class/graphics/fb0/blank
STOP_POLL_TRIES=6
VERIFY_POLL_TRIES=5
CAMERA_HW=$BESPOK3D/etc/init.d/autostart/s65camera-hw
CAMERA_PID=$RUN/capture-mipi-mpp.pid

do_stop() {
    # gui is the renderer lmd respawns on start; kill it too so a restart leaves exactly one fresh
    # gui (which re-runs the modeset) instead of orphaning the old one and accumulating instances.
    killall -9 unisrv lmd rkaiq_3A_ gui 2>/dev/null
    if [ -f "$PIDFILE" ]; then
        kill -9 "$(cat "$PIDFILE")" 2>/dev/null || true
    fi
    tries=0
    while pgrep -x unisrv >/dev/null 2>&1; do
        tries=$((tries + 1))
        [ "$tries" -ge "$STOP_POLL_TRIES" ] && break
        sleep 1
    done
    rm -f "$PIDFILE"
}

camera_capture_running() {
    [ -f "$CAMERA_PID" ] && kill -0 "$(cat "$CAMERA_PID")" 2>/dev/null
}

do_start() {
    mkdir -p "$RUN"
    # On the U1 the camera plugin owns lmd: it must start with the v4l2 imposter env after its
    # capture pipeline, so a plain lmd would fight it for /dev/video11. While the capture is live
    # the camera owns the restart; once it is stopped (e.g. camera uninstall) we start plain lmd.
    if camera_capture_running && [ -x "$CAMERA_HW" ]; then
        "$CAMERA_HW" start
    else
        start-stop-daemon -S -b -m -p "$PIDFILE" -x /usr/bin/lmd
    fi
}

do_rearm() {
    echo 0 > "$FB_BLANK" 2>/dev/null || true
    for backlight in /sys/class/backlight/*; do
        [ -d "$backlight" ] || continue
        echo 0 > "$backlight/bl_power" 2>/dev/null || true
        cat "$backlight/max_brightness" > "$backlight/brightness" 2>/dev/null || true
    done
    return 0
}

is_screen_healthy() {
    pgrep -x unisrv >/dev/null 2>&1 || return 1
    pgrep -x gui >/dev/null 2>&1 || return 1
    return 0
}

do_verify() {
    tries=0
    while [ "$tries" -lt "$VERIFY_POLL_TRIES" ]; do
        is_screen_healthy && break
        tries=$((tries + 1))
        sleep 1
    done
    pgrep -x unisrv >/dev/null 2>&1 || { echo "lmdctl verify: unisrv not running" >&2; return 1; }
    pgrep -x gui >/dev/null 2>&1 || { echo "lmdctl verify: gui not running" >&2; return 1; }
    # card0-DPI-1 reads `disabled` for both a benign idle-blank (wakes on activity) and a real VOP2
    # wedge, so it is not a reliable failure signal; report it but do not fail the restart on it.
    if [ "$(cat "$DPI_STATE" 2>/dev/null)" != "enabled" ]; then
        echo "lmdctl verify: display idle ($DPI_STATE); wakes on activity" >&2
    fi
    return 0
}

do_status() {
    if pgrep -x unisrv >/dev/null 2>&1; then
        echo "lmd: running (unisrv $(pgrep -x unisrv | tr '\n' ' '))"
    else
        echo "lmd: stopped"
    fi
}

case "$1" in
    stop)    do_stop ;;
    start)   do_start ;;
    rearm)   do_rearm ;;
    verify)  do_verify ;;
    status)  do_status ;;
    restart) do_stop; do_start; do_rearm; do_verify ;;
    *)       echo "Usage: $0 {stop|start|restart|verify|rearm|status}"; exit 1 ;;
esac
