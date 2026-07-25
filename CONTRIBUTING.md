# Contributing

Thanks for working on a Bespok3d adapter. An adapter teaches the system how to talk to a specific
printer: it pairs a client side with a device-side jinni that actuates the hardware. This repo holds
the org's adapters (the Snapmaker U1 for now) plus the shared `klipper-jinni` base they extend. See
[README.md](README.md) if present, and each adapter's own docs, for the layout.

## Before you write code

Read [CLAUDE.md](CLAUDE.md). It is the contract for changes here: the realm law (the daemon
orchestrates and owns the filesystem and protocol; the jinni actuates and owns device knowledge), the
non-negotiables (RULE ZERO: no em-dash or en-dash; every identifier carries domain meaning; nesting
beyond one level is suspicious; rule of three), and the working procedure. If you use an AI assistant,
point it at that file; `AGENTS.md` sends non-Claude tools there too.

## Develop

Each adapter gates on its own. Run the gate of the adapter you changed:

```sh
bash snapmaker-u1/scripts/check.sh     # the Snapmaker U1 adapter
bash klipper-jinni/scripts/check.sh    # the shared Klipper jinni base
```

The gate needs the `lib_bespok3d` submodule; if you cloned without it, run
`git submodule update --init` first. Run it before every push; CI runs the same gate.

## Constraints

- The maintainer owns git history and releases; submit changes as a pull request against `dev`.
- Never SSH-mutate or reconfigure a live printer without explicit authorization; a serial port on a
  printer may be a live Klipper MCU link. Read-only diagnosis is fine.
- Keep device knowledge in the jinni and generic orchestration out of it; do not leak one realm into
  the other.
