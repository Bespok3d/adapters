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

[doc/story-obligations.md](doc/story-obligations.md) is where the work is: it lists what an adapter
owes the user stories. Read it before you propose something new, because the idea you have may
already be a story with a shape, and delivering an obligation the code does not meet yet helps more
than adding another point. The page says what is owed, not what is already done, so check a row
against the code before you pick it up.

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

## Signing off your work

Every commit must carry a `Signed-off-by` line. It is your statement that you wrote the change, or
that you otherwise have the right to contribute it, under the terms of the Developer Certificate of
Origin (<https://developercertificate.org/>). Git writes the line for you:

```sh
git commit -s -m "your message"
```

A pull request whose commits are not signed off cannot be merged.

## Licence

This repository is under the GNU Affero General Public License, version 3 or any later version. The
full text is in [LICENSE](LICENSE).

By contributing you agree that your contribution is licensed under those same terms. You keep the
copyright in what you write. There is no copyright assignment and no contributor licence agreement to
sign.
