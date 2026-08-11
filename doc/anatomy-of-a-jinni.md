# Anatomy of a jinni

The jinni is the half of your adapter that runs on the printer. It is the only thing in Bespok3d that
knows which printer this actually is, rather than an anonymous Linux box with a hot end attached.

The name is the job: the daemon makes a wish ("place these files where Klipper extras go", "restart
Moonraker", "is a print running?") and the jinni grants it for this machine.

This page assumes you have read [anatomy-of-an-adapter.md](anatomy-of-an-adapter.md).

## Where it runs, and why that is not the daemon

- **What it is.** A separate process. The daemon starts it as a child, hands it a Unix socket, and
  from then on they exchange framed JSON messages over that socket.
- **Why it is there.** A separate process is a hard boundary. Your device code cannot reach into the
  daemon's internals, the daemon cannot accidentally depend on your printer, and a jinni that crashes
  does not take the daemon with it.

The first message is a handshake: the jinni states which protocol version it speaks and which version
of itself it is. A mismatch is caught immediately, not three operations later.

## Three layers, and you only write the last one

```text
  the base jinni          a generic Linux machine. Assumes no Klipper, no printer.
       |                  Owns the core paths and the generic probes.
       v
  the Klipper jinni       a Klipper 3D printer. Adds the Klipper and Moonraker paths,
       |                  the Klipper version probe, and print state.
       v
  your jinni              one printer model. Supplies the values, the hardware facts,
                          and only the behaviour that is genuinely different here.
```

The middle layer is `klipper-jinni/` in this repo, shared by every printer. Your jinni extends it.

If nothing is deployed, the daemon falls back to a generic jinni: the printer stays up and reachable
but installs nothing. That is the safe floor, not a working state.

## The four facets a jinni is made of

The Klipper layer is not one class doing everything. It is four concerns composed together, and when
you override something you are almost always overriding one facet.

| Facet | The question it answers | Two points |
| --- | --- | --- |
| **Layout** | where is everything | It resolves the path variables for this printer. It is the only source of a path, for both halves and every plugin. |
| **Realization** | how does a thing get installed here | It turns a destination class into a real path and mechanism. It also writes the service and module scripts, and names the restart commands. |
| **Facts** | what is this machine | Hardware, firmware version, architecture, board class, kernel release and vermagic, and the capability flags. These are what the app shows and what plugins are matched against. |
| **Probing** | what is true right now | Is a port listening, is a service up, does this device node exist, is a print running, and which actions must be blocked because one is. |

## The path contract: permissive in, strict out

Every jinni must resolve a fixed set of variables. A Klipper jinni must resolve a second set on top.

| Set | Keys |
| --- | --- |
| Core, every jinni | `BESPOK3D`, `BESPOK3D_PLUGINS`, `RUNTIME_USER` |
| Klipper, every printer | `BESPOK3D_KLIPPER`, `BESPOK3D_MOONRAKER`, `KLIPPER_SRC`, `KLIPPER_EXTRAS`, `MOONRAKER_COMPONENTS`, `PRINTER_CFG`, `MOONRAKER_CFG` |

A plugin manifest and an enroll step refer to these by name and never by value. This is what each one
has to point at, and what it tends to look like. The examples are from the reference adapter, whose
vendor shipped Klipper and Moonraker already installed.

| Variable | What it must point at | On the reference printer |
| --- | --- | --- |
| `BESPOK3D` | The one directory tree Bespok3d owns, on storage a vendor firmware update does not wipe | `/userdata/bespok3d` |
| `BESPOK3D_PLUGINS` | Where installed plugins live, inside that tree | `/userdata/bespok3d/usr/local/plugins` |
| `RUNTIME_USER` | The user Klipper and Moonraker run as, which is who has to own anything we place | `lava` |
| `BESPOK3D_KLIPPER` | Our own Klipper config directory, the one the printer's config includes | `/oem/printer_data/config/bespok3d/klipper` |
| `BESPOK3D_MOONRAKER` | The same, for Moonraker | `/oem/printer_data/config/bespok3d/moonraker` |
| `KLIPPER_SRC` | The Klipper source tree, meaning the `klippy` directory itself | `/home/lava/klipper/klippy` |
| `KLIPPER_EXTRAS` | Klipper's extras directory, which is where it imports an added module from | `/home/lava/klipper/klippy/extras` |
| `MOONRAKER_COMPONENTS` | Moonraker's components directory, the same idea | `/home/lava/moonraker/moonraker/components` |
| `PRINTER_CFG` | The printer's own Klipper config file, the one we add an include to and never rewrite | `/oem/printer_data/config/printer.cfg` |
| `MOONRAKER_CFG` | Moonraker's config file, treated the same way | `/oem/printer_data/config/moonraker.conf` |

The two `BESPOK3D_` config directories are the whole reason a plugin never touches a file the user
wrote. One include line is added to each stock config, pointing at a directory we own, and everything
after that happens inside it.

- **What it is.** The contract is checked when the jinni loads. A missing key raises there and then.
- **Why it is there.** A path that is wrong or absent does not announce itself: it produces an install
  that looks fine and a printer that does not work. Failing at load turns a silent breakage into a
  loud one, before anything is written.

You may supply more than the contract asks for, and you probably will. The reference adapter declares
sixteen: the ten above, its two log files, the two sockets Klipper and Moonraker listen on, the
directory holding the printer's own data, and the site-packages directory Klipper's interpreter reads
from. [adapter-zero-to-hero.md](adapter-zero-to-hero.md) says what each of those is for and when you
need it.

The values live in `jinni/paths.json`, and that file is the single copy. Your jinni reads it at
runtime and the client half reads it at load.

## What the jinni reports

| Report | What it carries |
| --- | --- |
| Capabilities | the adapter id, hardware tokens, installed plugins, firmware version, jinni version, capability flags, preferred registries, endpoints |
| Inspection | open ports, discovered endpoints, and whether a print is active |
| Health | is the web server reachable, is the daemon reachable, is Moonraker answering |

One thing is not self-reported. The daemon works out for itself whether your jinni exposes behaviour
beyond the standard interface, by inspecting it in its own process, and the app shows the user a
caution when it does. An adapter cannot quietly ship extra powers. That is deliberate, and it is why a
custom adapter can be installed by someone who does not know you.

## The jinni is what makes a printer repairable

A vendor firmware update can wipe the parts of the filesystem the vendor considers its own, taking
Klipper's tree, the daemon and every plugin file with it. What survives is the directory tree Bespok3d
owns. The app notices that the printer has gone quiet, offers the user a one click repair, and the
printer comes back with every plugin it had put back on it. A plugin that cannot be put back is
switched off rather than left half installed: its files stay, its links go, and the user is told which
one it was.

None of that works unless your jinni tells the truth.

- **Facts and probes describe the machine as it is right now**, never as it was at enrollment. The
  repair decides what to put back by asking. A probe that answers from memory, or answers hopefully,
  produces a repair that reports success on a printer that does nothing.
- **Everything you actuate must be safe to run again** on top of whatever survived. The repair
  re-applies the lot, on a machine in a state nobody can predict.
- **A path that no longer exists must fail loudly.** Staying quiet here is how a repair writes a
  plugin into a directory that nothing reads.
- **Nothing you do may leave the printer unable to print.** The daemon strips off a change that breaks
  Klipper or Moonraker, and it can only strip back to a printer that still works.

The client half holds the other end of this. `verifyEnrolled` is what tells the app a printer needs
repairing at all, and it has to answer both halves of the question: is our setup here, and will it
still be here after a reboot.

## Capability flags gate everything else

Flags are how your printer says what it can do. A verb your printer has not advertised is refused with
a plain message rather than half performed.

The Snapmaker U1 advertises four:

| Flag | It means |
| --- | --- |
| `overlay` | writes to the system need a write layer, and it can be unlocked |
| `managed-service` | Bespok3d can define a service here and have it start at boot |
| `lmd-control` | there is a vendor display service that has to be handed control deliberately |
| `kernel-modules` | modules can be loaded on this kernel |

Advertise what you have tested on hardware. Nothing else.

## Destination classes: the vocabulary you map

A plugin names a class; your realization facet maps it to a real place and a mechanism.

| Class | Available at | What the reference adapter does with it |
| --- | --- | --- |
| `system-bin` | every jinni | places an executable where the printer finds it |
| `web-location` | every jinni | adds a location block to the stock web server |
| `kernel-module` | every jinni | places a module and generates the script that loads it |
| `klipper-config` | Klipper printers | links into the Klipper config tree |
| `moonraker-config` | Klipper printers | links into the Moonraker config tree |
| `klipper-extra` | Klipper printers | links into Klipper's extras directory |
| `moonraker-component` | Klipper printers | links into Moonraker's components directory |
| `klipper-source` | Klipper printers | patches Klipper itself, against a kept original |

The U1 links rather than copies, because on that printer a link into a directory we own is what keeps
an uninstall from having to know what it touched. Another printer may copy. That choice is yours, and
it is exactly the kind of choice the class vocabulary exists to hide from plugins.

## Reads answer at once, changes take their turn

Verbs that change the printer (placing files, wiring and unwiring a plugin, editing the printer's own
config includes, pruning what a removal left behind) are serialized through a single queue. Verbs that
only read answer immediately.

- **What it is.** One thing at a time may modify the printer; any number of questions may be asked at
  once.
- **Why it is there.** Two installs interleaving on one printer's config is a class of bug that cannot
  be debugged from a user's report. It is prevented rather than handled.

## Your jinni, in files

```text
jinni/
  bespok3d_jinni.py    the module the daemon imports, and the make_jinni() factory it calls
  paths.json           the path values
  version.json         the jinni version, one key
  manifest.json        the package identity
  service.sh           the template for a service Bespok3d manages here
  tests/               pytest, run by the gate
```

`bespok3d_jinni.py` is the fixed module name and `make_jinni()` is the fixed factory name. That is the
whole loading convention.

The U1 splits its device knowledge into further files next to it: board facts, kernel facts, health,
the module and service script builders, and a WiFi watchdog that runs in the background. Split yours
the same way once one concern turns into two. The gate holds a size ceiling per file.

## Versioning

The version lives in `version.json` and nowhere else. The client reads that file, so the app knows
which jinni it is carrying without anyone maintaining a second number.

Because the jinni versions independently of the app and of the daemon, the app can notice that a
printer is running an older one and offer to update just that. Bump `version.json` and the matching
version in `manifest.json` as part of any change to the printer half.

## What must never end up in a jinni

- Generic install logic. If it would be identical on every printer, it belongs to the daemon.
- A path typed in Python. It belongs in `paths.json`.
- A rewrite of something upstream. Extend the vendor's file additively, so a firmware update does not
  silently undo you.
- A path that leaves the printer unusable when it fails. Every route through your jinni ends with a
  printer the user can still print with.
