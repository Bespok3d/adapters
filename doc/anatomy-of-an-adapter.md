# Anatomy of an adapter

An adapter is one directory. Everything in it exists so the rest of Bespok3d can stay ignorant of your
printer. This page walks the parts, two points each: what it is, and why it is there.

New to this? Read [overview.md](overview.md) first.

## The directory

```text
adapters/
  <your-printer>/
    client/            the app half:     TypeScript, runs on the user's computer
    jinni/             the printer half: Python, runs on the printer
      paths.json         where things live on this printer
      version.json       the jinni version, written once
      manifest.json      the package identity this jinni ships under
    testkit/           a fake printer to test against, no hardware needed
    scripts/check.sh   this adapter's gate
  klipper-jinni/       shared Klipper runtime, not yours, you build on it
```

The name of the directory is the adapter id, and it is the same string the app uses to pick your
adapter for a discovered printer. Use lower case with hyphens: `snapmaker-u1`.

## The client

- **What it is.** A TypeScript module that registers itself with the app at load and then owns two
  things: turning a stock printer into an enrolled one over SSH, and the device operations the app can
  offer afterwards.
- **Why it is there.** Before enrollment the printer has nothing of ours on it, so the only tool
  available is a shell over SSH. The client is the only part of Bespok3d that runs before the printer
  can answer for itself.

Detail: [anatomy-of-a-client.md](anatomy-of-a-client.md).

## The jinni

- **What it is.** A Python program that runs on the printer as its own process. The daemon starts it,
  asks it what is true about this machine, and hands it the device work that has to happen there.
- **Why it is there.** The daemon has to work on every printer, so it cannot hold a single path or
  restart command. The jinni holds all of them, which is why the daemon can be one program instead of
  one per model.

Detail: [anatomy-of-a-jinni.md](anatomy-of-a-jinni.md).

## `jinni/paths.json`

- **What it is.** A flat map of variable name to real path on this printer: where Klipper config is,
  where Moonraker components go, which directory survives a firmware update, which user owns the
  running processes.
- **Why it is there.** Both halves need those values and neither is allowed a second copy. The jinni
  reads it at runtime, the client reads it at load, so a path you fix is fixed in both places at once.

This file is also what a plugin author sees. The variables in it are the contract a plugin writes
against, which is what lets one plugin install on printers that agree on nothing else.

## `jinni/version.json`

- **What it is.** One key, `jinni_version`. The version of the printer half.
- **Why it is there.** The jinni updates on its own schedule, separately from the app and from the
  daemon. The client reads this same file, so the app can tell a user their printer is running an
  older jinni than the one the app is carrying, and offer to update just that.

There is no version number typed anywhere else. The app derives it, and the build fails if you try to
keep a second copy.

## `jinni/manifest.json`

- **What it is.** The package identity: the name the jinni is published under, its version, the
  minimum daemon it works with, and the capability it requires of a printer.
- **Why it is there.** The jinni ships as a signed package like everything else Bespok3d installs. This
  is the file that makes it one.

## `testkit/`

- **What it is.** A description of your printer as a set of files: a fixture that names the facts, and
  a skeleton directory tree that stands in for the real filesystem.
- **Why it is there.** It lets the whole enrollment and install path run against your printer without
  your printer. The test runner is generic and knows nothing about any model, so the only reason your
  adapter can be tested is that you wrote this.

## `scripts/check.sh`

- **What it is.** The gate. Type checks and lints both halves, runs both test suites, runs the shared
  detectors, and holds a size ceiling on every file.
- **Why it is there.** It is the same thing CI runs. If it is green on your machine your pull request
  is green, and there is no second, hidden standard to discover later.

## What the adapter has to answer for

Beyond paths and facts, the adapter is the "how" behind a fixed vocabulary that plugins write in. A
plugin declares intent; your adapter turns each intent into something real on your printer.

| The plugin says | Your adapter decides |
| --- | --- |
| this file is a `klipper-config` | which directory that is, and whether it is copied or linked |
| this file is a `moonraker-component` | same, for Moonraker |
| this file is a `kernel-module` | where modules live and how one is loaded here |
| restart `moonraker` | the exact command, and how to know it came back up |
| I need a background service | how a service is defined and started on this printer |
| I patch this stock file | where the untouched original is kept so it can be restored |

The vocabulary is closed. You map the classes your printer supports and declare the rest unsupported;
a plugin asking for something you did not advertise is refused with a plain message, never half
installed.

## Capability flags: say what your printer can do

Your jinni advertises a set of flags. They gate which of the above are even offered. The Snapmaker U1
advertises four: `overlay` (its writes need a write layer unlocked), `managed-service` (it can host
services we define), `lmd-control` (it has a vendor display service that must be handled), and
`kernel-modules` (modules can be loaded).

Advertise only what you have verified. A flag you claim without support is a broken install for a user
who picks the wrong plugin, and it is the failure mode this system exists to prevent.

## The line between adapter config and plugin config

A value belongs to the plugin if it would still make sense on a different printer. A Spoolman server
address is plugin config. A camera device node, a Klipper extras path, a runtime user name: those are
adapter values, and a plugin that hardcodes one of them is broken on every printer but the one it was
written on.

If you find yourself wanting a plugin to carry a path, the path belongs in `paths.json` instead.

## The Snapmaker U1, for orientation

| | |
| --- | --- |
| SSH login | `root`, password `snapmaker` |
| Runtime user | `lava` |
| Workspace | `/userdata/bespok3d/`, survives a firmware update |
| Klipper source | `/home/lava/klipper/klippy/`, wiped by a firmware update |
| Write layer | an overlay, unlocked by creating `/oem/.debug` |
| Boot hook | the stock `S90lmd` script is patched to call ours |
| Path variables | 16 |
| Enrollment steps | 15 |

That printer is deliberately awkward. Yours is probably easier.
