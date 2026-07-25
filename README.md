# Bespok3d adapters

Bespok3d is a printer-agnostic plugin manager for Klipper printers that runs on stock firmware, with
no custom-firmware flashing. An adapter is how Bespok3d learns to speak to one printer. It teaches the
desktop app how to discover and enroll that printer, and it carries the device knowledge the
on-printer daemon delegates to.

This repo holds the org's adapters as subdirectories, plus the shared jinni runtime they build on and
the `lib_bespok3d` submodule (shared gate helpers and detectors, not adapter code).

## What this repo ships

- **`snapmaker-u1/`**: the Snapmaker U1 adapter, in two halves.
  - A TypeScript **client** (`client/`): the app-side half. It discovers the printer, runs enrollment,
    deploys the daemon over SSH, seeds the access-control list, and drives device operations. It is
    written against `@adapter-sdk`, the app's adapter loader surface, never against app internals.
  - A Python **jinni** (`jinni/`): the on-device half. It carries U1 device knowledge (board facts,
    kernel-module loading, device health, the `lmd` display control) and actuates on the printer what
    the daemon asks for.
- **`klipper-jinni/`**: the shared Klipper jinni runtime that device adapters extend. Generic Klipper
  knowledge lives here; one printer's quirks live in that printer's adapter. See its own
  [README](klipper-jinni/README.md).

## The boundary that must not blur

The daemon orchestrates and owns the filesystem and the wire protocol. A jinni actuates and owns
device knowledge. A concrete device fact (a Klipper init path, a board name, a kernel vermagic, an
`lmd` detail) belongs in a jinni, never in the daemon's generic core. When the daemon needs the
printer to do something device-specific, it delegates to the jinni rather than learning the device
fact itself.

On the app side, the client reaches the app only through `@adapter-sdk`. That alias is the app's
adapter loader surface; the client never imports app internals.

## Layout

```text
snapmaker-u1/            the Snapmaker U1 adapter
  client/               app-side TypeScript: discovery, enrollment, deploy, device ops
  jinni/                on-device Python: U1 board facts, module loading, health, lmd display
  scripts/check.sh      this adapter's gate
klipper-jinni/          the shared Klipper jinni runtime device adapters extend
lib_bespok3d/           submodule: shared gate helpers and workspace detectors
CLAUDE.md, AGENTS.md    the contract for anyone (or any AI tool) editing this repo
CONTRIBUTING.md         how to develop and submit a change
SECURITY.md             how to report a vulnerability
```

## Build and test

Each half gates on its own. Run the gate of the part you changed:

```sh
bash snapmaker-u1/scripts/check.sh     # the Snapmaker U1 adapter (client + jinni)
bash klipper-jinni/scripts/check.sh    # the shared Klipper jinni base
```

The gates use the shared toolchain, so no daemon virtualenv build is needed. They do expect the
sibling repos checked out alongside this one in the same workspace, because both halves have a real
cross-repo dependency:

- The Python jinni speaks the daemon's `protocol` package, so the gate needs the `daemon` repo checked
  out next to `adapters/`.
- The TypeScript client is written against `@adapter-sdk`, the app's adapter loader, so its gate needs
  the `Bespok3d-desktop` app repo checked out too, and uses its node toolchain.

The gate also needs the `lib_bespok3d` submodule. If you cloned without it, run
`git submodule update --init`.

## Releasing

The jinni carries its version in `snapmaker-u1/jinni/version.json`; the client carries its own in
`snapmaker-u1/client/version.ts`. Bump the version of the half you changed as part of the change. The
build and signing of any published artifact is done by CI, not by hand.

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and [CLAUDE.md](CLAUDE.md) for the rules a
change here must follow (the daemon/jinni boundary, RULE ZERO on em-dash and en-dash, identifiers that
carry domain meaning, and the rest). To report a security issue, see [SECURITY.md](SECURITY.md).
