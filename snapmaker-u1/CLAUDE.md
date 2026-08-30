# snapmaker-u1 adapter: instructions for AI assistants

You are working in the Bespok3d adapter for the Snapmaker U1. Bespok3d is a printer-agnostic plugin
manager for Klipper printers that runs on stock firmware, with no custom-firmware flashing. An adapter
is the one place a printer model's own facts live: how this machine is enrolled, where its filesystem
puts things, how its boot works, what its board can tell you. This file is the contract for any LLM or
agent that edits this repo. If you are a non-Claude tool, `AGENTS.md` points you here.

## What this repo ships

- **`client/`**: the TypeScript half, loaded by the desktop app. Enrollment steps, the overlay unlock,
  paths, package deployment, print state, reconnection, the venv, and `stock-patches.ts`.
- **`jinni/`**: the Python half, deployed onto the printer. Board facts, kernel facts, device health,
  module loading, the boot control script.

The realm line between them is ADR-0037 and it is law: the daemon ORCHESTRATES and owns the filesystem
and the protocol; the jinni ACTUATES and owns device knowledge. A jinni that decides policy, or a
daemon that knows a board pin, is on the wrong side of it.

## Who may patch Snapmaker's own files: the base layer, not this repo (ADR-0043)

Every file Snapmaker ships as part of Klipper has exactly one owning package, and those packages are
the U1 base layer: the `u1-base` plugins, one per stock file owned, delivered from the store like any
other plugin. **This adapter does not patch Klipper source and must not start.** A capability that
needs a call site inside a Snapmaker Klipper file is a door added to the base plugin that owns that
file, and a feature plugin that names it with a `require` entry.

That is a publishing rule, enforced where plugins get published, and it is never a printer check
(owner, 2026-08-22). Nothing here or in the daemon tests it.

**The two OEM files this adapter does edit are not Klipper and are not covered by that rule**:
`client/stock-patches.ts` adds an include line to the nginx site so plugins can drop location blocks,
and hands control from the `S90lmd` boot script to `S99bespok3d`. Both are enrollment-time, both are
idempotent, and both stay this adapter's own. Do not move them into a plugin, and do not add a third
one without asking.

## The non-negotiables

1. **RULE ZERO: no em-dash or en-dash, anywhere** (code, comments, docs, commit messages). Use a comma,
   colon, semicolon, parentheses, or two sentences. The gate's em-dash guard fails the build on one.
2. **Every identifier carries domain meaning.** A name says what the thing *is* in the domain, never its
   type, its position, or a role-free abbreviation. No `a`/`b`, `tmp`, `data`, single letters.
3. **Nesting beyond one level is suspicious.** Flatten by default: guard clauses, early returns, an
   extracted named function, a named lookup instead of a nested ternary.
4. **Rule of three.** The third copy of a block, shape, or constant gets extracted.
5. **The printer is never left broken.** Every error path leaves the machine usable and every enrollment
   step is re-runnable. A half-applied step that cannot be run again is a defect.
6. **Never commit a real secret or a real LAN value.** Tokens, keys, real IP addresses and real UUIDs
   stay out of the tree. Fixtures are obviously fake.

## How to work a change

1. **Understand first.** Read the module and its tests. If the intent is unclear, ask one specific
   question and stop; do not invent structure.
2. **Scope it to a user story** and implement only what the story needs.
3. **Write the change** to the rules above.
4. **Run the gate green:** `bash scripts/check.sh`. It covers this repo only.
5. **Add a regression test** in the same change, at the layer that would catch the regression.
6. **Keep the docs current** when behaviour changes.

## Hard constraints

- **Never run git.** The maintainer commits.
- **Never SSH-mutate or reconfigure a live printer** without explicit per-action authorization. A serial
  port on this machine may be a live Klipper MCU link; read-only diagnosis is fine, but propose any
  device-changing step and wait for a yes.
- **The gate must be green** before a change is considered done.

## When you are unsure

Ask one specific question and stop. Do not guess and implement, and do not try something reasonable.
The architecture is the maintainer's; your job is to implement it to the rules above.
