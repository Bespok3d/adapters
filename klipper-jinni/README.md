# klipper-jinni

The shared Klipper jinni runtime that Bespok3d device adapters extend. A jinni is the on-device half
of an adapter: it actuates the printer and owns device knowledge. This package holds the generic
Klipper knowledge every Klipper printer shares, so a device adapter (the Snapmaker U1 today, another
printer tomorrow) only has to add its own quirks on top.

## The boundary

The on-printer daemon orchestrates and owns the filesystem and the wire protocol. A jinni actuates and
owns device knowledge. When the daemon needs the printer to do something device-specific, it delegates
to the jinni rather than learning the device fact itself. Generic Klipper knowledge lives here; one
printer's board facts, kernel details, and display control live in that printer's own adapter.

## How it is built

The jinni interface spans four concerns, one facet module each:

- **`layout`**: the filesystem contract (where things live on the printer).
- **`realization`**: install intent, meaning file placement, restarts, and service scripts.
- **`facts`**: the reported target facts (what this printer is).
- **`probing`**: the live checks, meaning reachability, print state, and the permission gate.

`base.py` composes these into one flat object the daemon can talk to, and guarantees the core path
variables resolve by construction. The base tier makes no Klipper assumptions; `klipper.py` is the
Klipper tier that overrides the facets which talk to Klipper and Moonraker. A device adapter extends
from there, overriding only what its hardware makes different.

## How it runs

The daemon spawns the jinni as a parented child process and talks to it over a Unix socket:

```sh
python -m jinni <socket-path>
```

The jinni loads the device adapter, runs its own in-process lifecycle (startup control scripts and
background tasks), then answers framed-JSON verb calls on the socket until it is killed. Actuation
verbs (running the resolved device commands) serialize through a single queue and run off the event
loop, so two operations never bounce a service at once and a long restart never blocks concurrent
reads. Read verbs (state, health, classification, path resolution) stay inline and run concurrently.

## How an adapter plugs in

An adapter installs its jinni as a module named `bespok3d_jinni` on the daemon's Python path, exposing
a `make_jinni()` factory. When no adapter jinni is present (an unknown target, or local development),
a generic jinni keeps the daemon up: it knows Bespok3d's own core layout but not any specific target.
Loading is permissive on input and strict on output: an adapter may ship a minimal jinni, but whatever
it ships, the core path variables must resolve, and a Klipper printer jinni must expose the Klipper
path contract. That check runs at load, so a misconfigured adapter fails loudly instead of producing a
broken install later.

## Layout

```text
jinni/                 the runtime package
  base.py              composes the four facets into one object
  klipper.py           the Klipper tier: overrides the facets that talk to Klipper/Moonraker
  layout.py            the filesystem contract
  realization.py       placement, restart, and service scripts
  facts.py             the reported target facts
  probing.py           reachability, print state, permission gate
  service.py           serve the contract over the socket
  loader.py            load the adapter's jinni, or fall back to generic
tests/                 isolation tests (the jinni alone) and together tests (over the socket)
scripts/check.sh       this package's gate
```

## Build and test

```sh
bash scripts/check.sh
```

The gate runs the size ratchet, ruff, mypy, and pytest, covering both the isolation tests (the jinni
on its own) and the together tests (the jinni driven over the socket). It uses the shared toolchain,
so no daemon virtualenv build is needed, but it does need the sibling `daemon` repo checked out
alongside `adapters/`, because the jinni speaks the daemon's `protocol` package and the together tests
drive the daemon over the socket. The gate also needs the `lib_bespok3d` submodule; if you cloned
without it, run `git submodule update --init`.

## Contributing

See the adapters repo [README](../README.md) and [CONTRIBUTING.md](../CONTRIBUTING.md) for the
workflow, and [CLAUDE.md](../CLAUDE.md) for the rules a change here must follow.
