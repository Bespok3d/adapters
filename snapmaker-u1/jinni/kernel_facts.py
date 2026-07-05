"""Read the running kernel's version magic from a loaded module (ground truth for a .ko build).

`uname -r` gives the release but not the full magic string (`... SMP preempt mod_unload aarch64`)
the kernel checks at insmod. The authoritative magic lives on any already-loaded module, since it
loaded, so we read it with `modinfo -F vermagic`, never synthesized from /proc/version. This is a
device-realm read, so the U1 jinni owns it (ADR-0037); the daemon only relays the reported fact.
"""
import subprocess
from pathlib import Path

_TIMEOUT_S = 3
_LOADED_MODULES = Path("/proc/modules")


def running_vermagic() -> str:
    """The version magic of the first loaded module modinfo can resolve, or 'unknown'. Iterating is
    the robustness: a bespok3d-placed module (tun.ko under the plugin tree) is not on modinfo's
    search path, so we skip it and read a stock module that is."""
    for module in _loaded_module_names():
        magic = _module_vermagic(module)
        if magic:
            return magic
    return "unknown"


def _loaded_module_names() -> list[str]:
    """Every module the kernel has loaded, name first per /proc/modules line."""
    try:
        listing = _LOADED_MODULES.read_text().splitlines()
    except OSError:
        return []
    return [line.split(" ", 1)[0] for line in listing if line.strip()]


def _module_vermagic(module: str) -> str:
    """The module's version magic via modinfo, or "" when modinfo cannot resolve it (not on the
    search path, or absent)."""
    try:
        done = subprocess.run(["modinfo", "-F", "vermagic", module],
                             capture_output=True, text=True, timeout=_TIMEOUT_S, check=False)
        return done.stdout.strip() if done.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""
