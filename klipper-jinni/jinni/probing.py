"""The live-probing facet of the jinni: read the running device and judge what may be done now.

Reachability (`port_listening`/`service_get`) and the live print read (`print_active`) delegate to
the loopback probe implementations in `inspection.py`. `blocked_actions()` is the live blocked
TOKEN set the print guard checks (ADR-0037): the jinni decides what a running print forbids and
names it as machine tokens, never prose. The base tier is a generic box that blocks nothing; the
klipper tier reads the device and the composition root assembles the token set.
"""
import asyncio
import re
import subprocess
from collections.abc import AsyncIterator
from pathlib import Path

from . import inspection
from .layout import Layout

# Klipper print_stats states in which a print is running and a service restart would interrupt it.
_ACTIVE_PRINT_STATES = ("printing", "paused")

# The machine token for a kernel module whose version magic does not match the running kernel (the
# OTA-kernel-bump case). The app localizes it; the daemon relays it and authors no device prose.
_VERMAGIC_MISMATCH_TOKEN = "kernel-module:vermagic-mismatch"
_DMESG_TIMEOUT_S = 3


def _kernel_ring_buffer() -> str:
    """The kernel ring buffer (`dmesg`), where the module loader logs a failed insmod. Empty when
    dmesg is unavailable, so classification just reports no known cause."""
    try:
        done = subprocess.run(["dmesg"], capture_output=True, text=True,
                              timeout=_DMESG_TIMEOUT_S, check=False)
        return done.stdout
    except (OSError, subprocess.SubprocessError):
        return ""


def _vermagic_rejected(ring_buffer: str, kernel_name: str) -> bool:
    """Whether the kernel logged a version-magic rejection for this module: `<mod>: version magic
    'built-for' should be 'running'`. This is the kernel's own verdict on the load, the true gate:
    a mere non-zero insmod exit is not classified here, only the kernel's version-magic complaint
    (a module that instead loads then misbehaves shows no such line and is not this cause).

    Known limit: a point-in-time ring-buffer read is not scoped to this exact load attempt, so a
    stale version-magic line from an earlier same-boot attempt on the SAME module could label a
    later, differently-caused failure as a mismatch. It never mislabels a DIFFERENT module (the name
    is bounded on both sides) and never makes the printer less safe (the plugin deactivates either
    way, only the user-facing reason would be wrong). A future hardening compares the placed .ko's
    own vermagic (modinfo on the file) against the running kernel's, history-independent."""
    rejection = re.compile(rf"(?<![\w-]){re.escape(kernel_name)}: version magic ")
    return rejection.search(ring_buffer) is not None


class Probing:
    def port_listening(self, port: int) -> bool:
        """Whether a localhost TCP port is open. The jinni reaches the printer, so this is the
        device's concern; a device with an unusual probe overrides it."""
        return inspection.tcp_port_listening(port)

    def service_get(self, url: str, timeout: int = 3) -> tuple[bool, str]:
        """GET a localhost service URL: (up, body). An auth-required answer still means up; a
        connection error means not-yet-up. Overridable for a device whose services differ."""
        return inspection.http_service_get(url, timeout)

    def device_node_present(self, path: str) -> bool:
        """Whether a filesystem path exists on the printer (a device node like /dev/net/tun). Any
        box reads its own filesystem, so the base tier answers; the kernel-module mechanism checks a
        loaded module's outcome with it."""
        return Path(path).exists()

    def classify_module_load(self, name: str) -> str:
        """A machine token for why a kernel module failed to load, or "" for no known cause. Read
        from the kernel ring buffer, generic across linux: today's one cause is a version-magic
        mismatch after an OTA kernel bump, which the kernel logs against the in-kernel module name
        (a hyphen normalized to an underscore, matching how `foo-bar.ko` loads as `foo_bar`). The
        jinni reads the device and emits the token; the daemon relays it and the app localizes it
        (ADR-0037)."""
        kernel_name = name.replace("-", "_")
        if _vermagic_rejected(_kernel_ring_buffer(), kernel_name):
            return _VERMAGIC_MISMATCH_TOKEN
        return ""

    def print_active(self) -> tuple[bool, str]:
        """Whether a print is running, and the raw state string. A generic box prints nothing; the
        klipper tier reads it live."""
        return False, ""

    def is_active_print_state(self, state: str) -> bool:
        """Whether a print-state string counts as a running print. Base: never (no print states)."""
        return False

    def blocked_actions(self) -> frozenset[str]:
        """The action TOKENS blocked on the printer right now (empty = nothing blocked). A generic
        box has no print to protect; the klipper composition root reads the live state."""
        return frozenset()

    async def watch_blocked_actions(self) -> AsyncIterator[frozenset[str]]:
        """Push the blocked-action set on change. A generic box never changes: emit the empty set
        once, then idle. The klipper composition root subscribes to the live print state."""
        yield frozenset()
        await asyncio.Event().wait()

    def _candidate_ports(self) -> dict[int, str]:
        return dict(inspection.GENERIC_PORTS)


class KlipperProbing(Layout, Probing):
    """Live probing for a klipper printer: it reads the print state from Klipper's API socket (so it
    inherits Layout for the socket path) and adds the Moonraker port to the candidate set. The
    blocked-action token set is assembled on the composition root (it needs the display tokens from
    the realization facet), so it lives in jinni/klipper.py, not here."""

    def print_active(self) -> tuple[bool, str]:
        """Live print state: Klipper's API socket first (auth-immune), Moonraker HTTP fallback."""
        state = inspection.print_state(self.paths().get("KLIPPER_UDS", ""))
        return self.is_active_print_state(state), state

    def is_active_print_state(self, state: str) -> bool:
        return state in _ACTIVE_PRINT_STATES

    def _candidate_ports(self) -> dict[int, str]:
        return {**inspection.GENERIC_PORTS, inspection.MOONRAKER_PORT: "Moonraker API"}
