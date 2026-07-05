#!/bin/sh
# Kernel-module loader for the Snapmaker U1 (SysV). The jinni fills the __SENTINELS__ per module.
# Edit this file as the shell script it is; the sentinels are the only thing substituted. Both boot
# (S99bespok3d) and the daemon drive it through the start/stop interface; load and unload are
# idempotent so a re-run or a boot after install is a no-op.
MODULE=__MODULE__
NAME=__NAME__

is_loaded() {
    grep -q "^${NAME} " /proc/modules
}

load() {
    __MKNODS__
    if is_loaded; then
        echo "$NAME: already loaded"
        return 0
    fi
    printf "Loading %s: " "$NAME"
    if insmod "$MODULE"; then
        echo "OK"
    else
        echo "FAILED"
        return 1
    fi
}

unload() {
    printf "Unloading %s: " "$NAME"
    is_loaded && rmmod "$NAME" 2>/dev/null
    echo "OK"
}

status() {
    if is_loaded; then echo "$NAME: loaded"; else echo "$NAME: not loaded"; fi
}

case "$1" in
    start)   load ;;
    stop)    unload ;;
    restart) unload; sleep 1; load ;;
    status)  status ;;
    *)       echo "Usage: $0 {start|stop|restart|status}"; exit 1 ;;
esac

exit $?
