"""The reported-facts facet of the jinni: the static target facts the daemon relays to the app.

Each is an overridable stub the base tier answers with a neutral default ("unknown", empty), so a
generic box reports nothing surprising; a device jinni overrides the ones it knows. The base Jinni
assembles these into `capabilities()`; the live readings come from the probing facet.
"""
import subprocess

_KLIPPER_VERSION_TIMEOUT_S = 3


class Facts:
    def hardware(self) -> list[str]:
        return []

    def firmware_version(self) -> str:
        return "unknown"

    def arch(self) -> str:
        """The CPU architecture a native artifact must target (e.g. aarch64). A variant dimension: a
        binary or kernel module is placed only when its `when.arch` matches. Unknown on a generic
        box a device jinni has not taught."""
        return "unknown"

    def board_class(self) -> str:
        """The board's resource tier (`standard` / `constrained`), the variant dimension a lighter
        build selects on for a memory-starved board. Unknown until a device jinni reads it."""
        return "unknown"

    def kernel_release(self) -> str:
        """The running kernel's release string (`uname -r`), the variant dimension a kernel module
        is placed on: a `.ko` is cross-built per kernel, so only a variant whose kernel matches gets
        placed. Unknown on a generic box a device jinni has not taught."""
        return "unknown"

    def kernel_vermagic(self) -> str:
        """The running kernel's version magic (`6.1.99 SMP preempt mod_unload aarch64`), read from a
        loaded module via `modinfo`: the exact string the kernel checks at insmod, richer than the
        release alone (it carries the ABI-affecting config flags). Read from ground truth, never
        synthesized from `/proc/version`. The finer variant dimension a `.ko` selects on, and the
        reference the load-failure classifier compares a stale module against. Unknown on a generic
        box a device jinni has not taught."""
        return "unknown"

    def version(self) -> str:
        """The adapter jinni's own version (its daemon-side half), distinct from the daemon."""
        return "unknown"

    def preferred_registries(self) -> list[str]:
        return []

    def capability_flags(self) -> set[str]:
        return set()


class KlipperFacts(Facts):
    """The klipper-only fact a klipper printer adds: the running Klipper version."""

    def klipper_version(self) -> str:
        try:
            result = subprocess.run(
                ["python3", "-c", "import klippy; print(klippy.VERSION)"],
                capture_output=True, text=True, timeout=_KLIPPER_VERSION_TIMEOUT_S, check=False,
            )
            return result.stdout.strip() or "unknown"
        except Exception:
            return "unknown"
