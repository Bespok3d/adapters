# Bespok3d adapters: instructions for AI assistants

You are working in the Bespok3d adapters repo. Bespok3d is a printer-agnostic plugin manager for Klipper
printers that runs on stock firmware, with no custom-firmware flashing. An adapter is how Bespok3d learns
to speak to one printer: it teaches the app how to discover and enroll the printer, and it carries the
device knowledge the on-printer daemon delegates to. This file is the contract for any LLM or agent that
edits this repo. Contributors here often work with AI assistance, so the rules and the design intent are
written down and enforced in the gate, not left implicit. The human reviewer rejects a PR that ignores
them.

If you are a non-Claude tool, `AGENTS.md` points you here.

## What this repo ships

This is one repo holding the org's adapters as subdirectories, plus the `lib_bespok3d` submodule (shared
gate detectors and helpers, not adapter code).

- `snapmaker-u1/`: the Snapmaker U1 adapter, in two halves.
  - A TypeScript **client** (`client/`): the app-side half. It discovers the printer, runs enrollment,
    deploys the daemon over SSH, seeds the access-control list, and drives device operations. It is
    written against `@adapter-sdk` (the app's adapter loader), never against app internals.
  - A Python **jinni** (`jinni/`): the on-device half. It carries U1 device knowledge (board facts,
    kernel-module loading, device health, the `lmd` display control) and actuates what the daemon asks
    for on the printer.
- `klipper-jinni/`: the shared Klipper jinni runtime that device adapters extend. It speaks the daemon's
  `protocol` package; the snapmaker-u1 jinni builds on it, and future printer adapters (a Voron, say) will
  too. Generic Klipper knowledge lives here; one printer's quirks live in that printer's adapter.

## The realm law (this is the boundary that must not blur)

- **The daemon orchestrates and owns the filesystem and the protocol. A jinni actuates and owns device
  knowledge.** A concrete device fact (a Klipper init path, a board name, a kernel vermagic, an `lmd`
  detail) belongs in a jinni, never in the daemon's generic `core`. If the daemon needs the printer to do
  something device-specific, it delegates to the jinni; it does not learn the device fact itself.
- **The client reaches the app only through `@adapter-sdk`.** That alias IS the app's adapter loader
  surface. Do not import app internals from the client. There is one historical leak (`printer-ops`); do
  not add a new one, and prefer closing that one over widening it.

## The non-negotiables

1. **RULE ZERO: no em-dash or en-dash, anywhere** (code, comments, docs, commit messages). Use a comma,
   colon, semicolon, parentheses, or two sentences. A hyphen in a compound word is fine. The gate's
   em-dash guard fails the build on a violation.
2. **Every identifier carries domain meaning.** A name says what the thing *is* in the domain, never its
   type, its position, or a role-free abbreviation. No `a`/`b`, `tmp`, `data`, single letters.
3. **Nesting beyond one level is suspicious.** Flatten by default: guard clauses, early returns, an
   extracted named function, a named lookup instead of a nested ternary.
4. **Separation of concerns.** One responsibility per file and function; a concern gets a file named for
   it. A TypeScript file past ~150 lines or a Python module past ~150 lines is doing too much: split it.
   Both halves hold a size ratchet in the gate, so a growing file fails the build.
5. **Rule of three.** The third copy of a block, shape, or constant gets extracted. Duplication is a bug;
   "no premature abstraction" forbids generalizing for one caller, it does not excuse copy-paste.
6. **Extend upstream minimally and additively.** The jinni sits next to Klipper and the printer's stock
   scripts. Never delete or rewrite an upstream method; add alongside it, so the change survives a
   re-vendor or a firmware update.
7. **The printer is never left broken.** Every path the jinni actuates leaves the printer usable, and the
   daemon's auto-deactivate safety net peels off a change that breaks Klipper or Moonraker. Do not defeat
   it.
8. **Never commit a real secret or a real LAN value.** Tokens, keys, real IP addresses, and real UUIDs
   stay out of the tree. Fixtures are obviously fake.

## How to work a change

1. **Understand first.** Read the half you are changing (`client/`, `jinni/`, or `klipper-jinni/jinni/`)
   and the realm law above. Do not invent architecture; if the intent is unclear, ask one specific
   question and stop.
2. **Scope it to a user story.** "As a [role], I want [capability] so that [value]." Implement only what
   the story needs: no speculative features, no defensive code for cases that cannot happen.
3. **Write the change** to the rules above.
4. **Run the right gate and make it green.** Each adapter self-gates: `cd` into the adapter you changed
   and run `bash scripts/check.sh`. This repo's gate is NOT hermetic; it reaches workspace siblings, so a
   bare clone of only this repo cannot go green until they are present:
   - First: `git submodule update --init` (the shared detectors live in the `lib_bespok3d` submodule).
   - `snapmaker-u1`: the client is written against `@adapter-sdk`, so it needs the desktop app repo
     checked out as a workspace sibling and uses the app's node toolchain (eslint, tsc, vitest); the jinni
     needs the `daemon` and `klipper-jinni` checked out (its mypy path). The gate runs eslint + tsc +
     vitest on the client, ruff + mypy + pytest + a size ratchet on the jinni, plus the shared detectors.
   - `klipper-jinni`: it speaks the daemon's `protocol` and the together tests drive the daemon `core`
     over the socket, so it needs the `daemon` checked out as a workspace sibling. The gate runs ruff +
     mypy + pytest (isolation tests and together tests), a size ratchet, plus the shared detectors.
5. **On a gate failure, fix the cause.** Never hand-wave a real smell away. If a detector is genuinely
   wrong about a line, the fix is a per-instance justified allow at the smell
   (`# gate-allow <metric>: <reason>`, with a reason that survives "why is THIS one ok?"), never a blanket
   mute to make a number go down.
6. **Add a regression test** in the same change, at the layer that catches its regression: a vitest for
   the client, a pytest for the jinni. It fails on the old behavior and passes on the fix.
7. **Keep the docs current.** If the change alters the realm boundary, the SDK surface, or how the printer
   is enrolled, say so where that is documented.

## Hard constraints

- **Never run git.** The maintainer commits. Leave the tree green and hand over exact commands if a git
  action is needed.
- **Never SSH-mutate or reconfigure a live printer** without explicit per-action authorization. A serial
  port or GPIO on a printer may be a live Klipper MCU link: on the U1, `/dev/ttyS6` is the MCU serial and
  opening it kills Klipper. Read-only diagnosis is fine; propose any device-changing step and wait for a
  yes.
- **The gate must be green** before a change is considered done.

## When you are unsure

Ask one specific question and stop. Do not guess and implement, and do not "try something reasonable."
The architecture is the maintainer's; your job is to implement it to the rules above.
