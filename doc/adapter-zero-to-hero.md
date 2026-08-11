# Adapter zero to hero

Follow this page from the top and you end with a working adapter for your printer: both halves, tested
without hardware, confirmed on hardware, ready to submit.

It assumes you have read [anatomy-of-an-adapter.md](anatomy-of-an-adapter.md) and both anatomy pages.
It does not assume you have written anything for Bespok3d before.

## The shape of the job

| Part | What you do | Where you do it |
| --- | --- | --- |
| 1 | Interrogate the printer and write down what is true | a shell on the printer |
| 2 | Write the printer half, the jinni | `<your-printer>/jinni/` |
| 3 | Write the app half, the client | `<your-printer>/client/` |
| 4 | Prove it against a fake printer, then a real one | `<your-printer>/testkit/`, then hardware |
| 5 | Walk the acceptance list and submit | this repo |

Part 1 is most of the work and all of the risk. Everything after it is transcription. A contributor
who skips it writes an adapter that enrolls once, on their own machine, and breaks on the next
firmware update.

## Set up first

```sh
git clone <your fork> && cd adapters
git submodule update --init
```

The gate is not hermetic. It reaches sibling checkouts in the same workspace directory, because both
halves have a real cross repo dependency: the jinni speaks the daemon's protocol, and the client is
written against the app's adapter loader.

```text
<workspace>/
  adapters/            this repo
  daemon/              needed by the jinni gate
  Bespok3d-desktop/    needed by the client gate
```

Copy `snapmaker-u1/` to `<your-printer>/` and delete what does not apply. That is a better starting
point than an empty directory, because it shows you which questions have to be answered.

---

# Part 1: interrogate the printer

Work through every table. For each row write down the answer, even when the answer is "not applicable
on this printer". An unanswered row is a bug you have not found yet.

The right-hand column tells you where the answer ends up, so the investigation produces the adapter
rather than preceding it.

## Getting in

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Is there a shell at all, over SSH or serial | No shell means no adapter, at least not this way. Stop here and open an issue | nothing |
| The login user, port, and the vendor's default password | The app offers these as defaults, so a user who never opens a terminal can enroll | `defaults` in the client |
| Whether that user is root or can become root | Placing files outside the user's home usually needs it | your enroll steps |
| The user Klipper and Moonraker actually run as | Files owned by the wrong user are silently ignored by Klipper, which reports them as invalid config rather than as a permission problem | `RUNTIME_USER` |
| Whether the vendor's password is per device or universal | A per device secret changes what the app can prefill | `sshPasswordHint` |

`id`, `ps aux | grep klippy`, `ls -l` on the config directory.

## What survives, and what does not

This is the single most important table on the page.

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Which directories survive a vendor firmware update | Everything Bespok3d owns has to live there, or a routine update wipes the user's plugins | `BESPOK3D`, `BESPOK3D_PLUGINS` |
| Which directories the update wipes | Anything we place there must be restorable in one operation, without the user redoing setup | your recovery path |
| Whether the printer's own config survives | If the vendor rewrites `printer.cfg` on update, our include line has to be re-added rather than assumed | your jinni's config handling |
| Where user data lives (print history, uploads) | We never remove it, on any path, including uninstall | nothing, but it constrains everything |

You find this out by having a firmware update to compare against, or by reading the vendor's update
script. Guessing here produces the worst bug in the product: a user loses their setup on a Tuesday for
no reason they can see.

## Writes and reboots

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Is the root filesystem writable | If yes, a whole class of work disappears | `capability_flags` |
| If not: is there an overlay, and how is it unlocked | Without unlocking, everything you install vanishes at the next reboot while appearing to work now | an enroll step, plus the `overlay` flag |
| Does unlocking need a reboot | If yes, enrollment has to reboot and wait for the printer to come back | an enroll step and a reconnect helper |
| How to tell, at any later moment, that the write layer is still intact | This is what tells the app a firmware update has quietly broken the printer's setup | `verifyEnrolled` |

Write a file, reboot, look for the file. Do not trust documentation on this one.

## Getting started at boot

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Which init system: systemd, busybox init, something vendor made | It decides whether a service is a unit file, a numbered script, or something else | `render_service_script` |
| Whether a script you add is actually run at boot | On some printers the boot sequence is fixed before your filesystem is even mounted, so a new script is never seen | an enroll step |
| If not: which existing vendor script can be extended to call ours | This is the hook, and it must be extended additively so a vendor update does not silently drop it | an enroll step |
| The order things start in, and where in it we must sit | Starting before the network or before Klipper produces failures that look random | your service scripts |

On the Snapmaker U1 the boot sequence expands its script list before the write layer is mounted, so a
script added over SSH is invisible. The adapter extends a stock script to call ours instead. Check for
this. It is not obvious and it costs a day when it is found late.

## Klipper and Moonraker

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Where the Klipper source tree is | Some plugins patch Klipper itself, against a kept original | `KLIPPER_SRC` |
| Where the extras directory is | The most common plugin destination | `KLIPPER_EXTRAS` |
| Where `printer.cfg` is, and whether it accepts an include | If include is refused or rewritten, plugin config cannot be added without touching the user's own file | `PRINTER_CFG` |
| The Moonraker config file: its real name, not the one you expect | The U1 uses `moonraker.conf`, not `.cfg`, and getting this wrong fails in a way that reads as a Klipper error | `MOONRAKER_CFG` |
| Where Moonraker components live | The second most common plugin destination | `MOONRAKER_COMPONENTS` |
| Whether Moonraker errors on an empty include glob | If it does, an empty plugin directory bricks boot, so a placeholder file must be created at enrollment | an enroll step |
| The Moonraker port, and its trusted clients list | The app talks to Moonraker, so it has to be trusted | probing, and `preferred_registries` |
| Whether Klipper and Moonraker expose Unix sockets | Faster and more reliable than the HTTP API for some checks | extra path variables |

## The web server

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Which web server serves the printer's interface | Plugins add web endpoints through it | `web-location` realization |
| Its config file, and whether it supports drop-in includes | Drop-ins mean we never edit the user's file; without them we patch it, idempotently | an enroll step |
| Which port it listens on | Health checks and endpoint discovery | probing |

## Services and restarts

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| The exact command that restarts Klipper | Plugins declare "restart klipper" and your adapter is what makes that real | `restart_command` |
| The exact command that restarts Moonraker | Same. Note the U1's service is `S61moonraker`, not the number you would guess | `restart_command` |
| The exact command that restarts the web server | Same | `restart_command` |
| How to know a service came back up, rather than just that the command exited | Reporting success on an unverified restart is how a user opens a half started interface | probing |
| Whether any vendor service must be stopped or handed control first | A display service holding the framebuffer will fight anything else that wants it | a capability flag and its own handling |

Restart, do not stop and start. A stop that fails leaves the printer worse than a restart that fails.

## Python

First, the rule this section is checking a printer against. **Bespok3d never installs a library into
the Python the printer came with.** The daemon keeps its libraries in a private environment of its
own, and every plugin that needs Python libraries gets a separate private environment, one per plugin.
Nothing is downloaded on the printer either: a plugin's libraries are built elsewhere, shipped inside
the plugin package, and installed from those files with no network involved.

That is three separations, and each one buys something:

| The separation | What it buys |
| --- | --- |
| The vendor's Python is never touched | A firmware update and Bespok3d cannot break each other |
| One environment per plugin | Two plugins wanting different versions of the same library both get one, and removing a plugin removes its libraries with it |
| Nothing installs from the internet | A printer with no internet, or with a broken `pip`, installs plugins anyway |

There is one exception, and it is what your `PYTHON_SITE_PACKAGES` variable exists for. A plugin that
extends Klipper or Moonraker runs inside their interpreter, not in an environment of its own, so a
library it needs has to be importable from there. For those, and only those, the daemon links the
shipped libraries into the site-packages directory that variable points at.

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| The Python version on the printer | The jinni and the daemon run on it | your minimum daemon version |
| Whether `pip` works at all | On the reference printer it is missing vendor files and cannot build anything, which is why every library is built off the printer and shipped ready made | your packaging |
| Whether a private environment can be created | The daemon needs one, and so does every plugin that ships libraries | an enroll step |
| Which interpreter Klipper and Moonraker run on, and where its site-packages directory is | It is the only place a Klipper extension's libraries can go | `PYTHON_SITE_PACKAGES` |

Never install into the Python the printer came with. If the printer cannot host a private environment,
say so in your pull request rather than working around it.

## Network

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Whether WiFi credentials survive a reboot, and where they are actually stored | On the U1 they live only in the write layer, so unlocking it can lose the printer from the network mid enrollment | an enroll step |
| Whether stale DHCP state prevents reconnection after a reboot | This turns "reboot and continue" into "the printer never comes back" | an enroll step |
| How the printer announces itself for discovery, and the MAC it uses | The app finds printers by announcement, never by a remembered address | discovery |
| How long the printer takes to come back after a reboot | Your reconnect wait has to be longer than the truth, not longer than your patience | a reconnect helper |

## Hardware

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| Which cameras exist, and their device nodes | Plugins are matched against hardware tokens, so a camera plugin is only offered where there is a camera | `hardware` |
| Which other device hardware exists: RFID, accelerometers, an NPU, a display | Same reason | `hardware` |
| The board name and class | Shown to the user, and used to keep heavyweight plugins off constrained boards | `board_class` |
| How much RAM the board has | A 512 MB board cannot run everything a 2 GB one can, and finding that out at install time is too late | `board_class` |

## Kernel

Only if your printer will load kernel modules.

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| The kernel release string | Modules go in a versioned directory | `kernel_release` |
| The kernel vermagic | A module built against the wrong one refuses to load, and the message does not say why | `kernel_vermagic` |
| Whether module loading works at all on this kernel | If not, do not advertise `kernel-modules` | `capability_flags` |

## Print safety

| Establish | Why it matters | Lands in |
| --- | --- | --- |
| How to tell, reliably, that a print is running right now | Everything else in this section depends on it | `print_active` |
| Which states count as an active print, including paused | A paused print is still a print, and treating it as idle ruins someone's twelve hour job | `is_active_print_state` |

Nothing that restarts a service, edits config, or reboots may run while the printer is printing. The
first enroll step should refuse on a printing printer, and the daemon blocks the rest.

## The danger list

Write this one before you experiment, not after.

| Establish | Why it matters |
| --- | --- |
| Which serial ports are live links to the printer's motion controller | Opening one kills Klipper mid print. On the U1 that is `/dev/ttyS6` |
| Which GPIO lines are wired to something that moves or heats | The same class of mistake, with a worse ending |
| Which vendor process must never be killed | Some of them own the display, the network, or the machine's safety loop |

Verify what a resource is before you touch it. Read-only inspection first, always.

## The blockers

If any of these is true, stop and open an issue before writing code:

- There is no shell on the printer.
- Nothing on the filesystem survives a vendor update.
- Klipper config cannot be extended without editing the user's own file, and that file is rewritten by
  the vendor.
- The printer cannot run a Python virtual environment.

None of these is necessarily fatal. All of them are a design conversation, not something to work
around quietly.

---

# Part 2: write the jinni

## Step 1: `jinni/paths.json`

Transcribe the paths you established. Keys are the variable names, values are real absolute paths.

The required set is in [anatomy-of-a-jinni.md](anatomy-of-a-jinni.md). Add whatever else your printer
needs: logs, sockets, site-packages. This file is the only place any of them is written.

## Step 2: `jinni/version.json`

One key, `jinni_version`, starting at `0.1.0`.

## Step 3: `jinni/bespok3d_jinni.py`

Fixed file name, fixed factory name. Extend the Klipper jinni and override only what differs.

```python
class YourPrinterJinni(KlipperPrinterJinni):
    def device_paths(self): ...        # read paths.json
    def hardware(self): ...            # the tokens plugins match against
    def firmware_version(self): ...    # read the vendor's version file
    def version(self): ...             # read version.json
    def capability_flags(self): ...    # only what you have tested
    def restart_command(self, service): ...

def make_jinni():
    return YourPrinterJinni()
```

Override in this order, and stop when the printer works:

1. `device_paths`, `version`. Nothing runs without these.
2. `hardware`, `firmware_version`, `board_class`. This is what the user sees and what plugins match.
3. `capability_flags`. Start with none and add one at a time as you verify it on hardware.
4. `restart_command`. One per service you support.
5. Service and module script rendering, if your init system is not one the shared layer already
   handles.
6. `health`. What "this printer is fine" means here.

Anything you did not override, you inherited, and inherited is better. A method you overrode to
produce the same answer is a maintenance cost with no purpose.

## Step 4: split it before it grows

Device knowledge separates fast. The U1 keeps board facts, kernel facts, health, and the script
builders in their own files next to the jinni. Do the same at the second concern, not the fourth.

## Step 5: tests

`jinni/tests/`, pytest. Test what your printer does differently, not what the shared layer already
covers. Run `bash <your-printer>/scripts/check.sh`.

---

# Part 3: write the client

## Step 1: the entry module

`client/<your-printer>.ts` builds the definition and calls `registerAdapter`. Fields are listed in
[anatomy-of-a-client.md](anatomy-of-a-client.md). Read the jinni version from `version.json` and the
paths from `paths.json`. Type neither of them.

## Step 2: the environment contract

`client/env-vars.ts` publishes the variables plugin authors may use, each with its value from
`paths.json` and a line saying what it is for. This is a public interface. A variable you leave out is
one a plugin author will hardcode instead.

## Step 3: the enroll steps

One file per step under `client/enroll-steps/`, plus the ordered list. Follow the U1's grouping, in
this order:

1. **Refuse to start when you should not.** Confirm it is the printer you think, and that it is not
   printing.
2. **Make writes stick.** Unlock the write layer, protect anything the unlock could lose, reboot and
   reconnect if the unlock demands it.
3. **Make the network dependable.** Clear whatever stale state stops the printer coming back.
4. **Create the workspace.** One tree you own, on storage that survives a vendor update.
5. **Get started at boot.** Install the dispatcher, or extend the vendor script that can call it.
6. **Join the stock system.** Add the web include and the Klipper and Moonraker includes, without
   editing the user's own content.
7. **Install the daemon and the jinni**, then give them an identity.
8. **Start, and verify.** Observe it working before reporting success.

Rules, restated because they are where adapters go wrong:

- Every step is idempotent. Each gets a fresh SSH session, is retried on connection failure, and can
  be re-run when a user retries from a later step.
- Never paste a value into a shell command. Quote it.
- Labels and details are read by a user who does not know what a jinni is. No file names, no
  mechanism, no jargon.

## Step 4: `verifyEnrolled`

Set up, and still able to keep new writes. Both. See
[anatomy-of-a-client.md](anatomy-of-a-client.md).

## Step 5: any operations

`opSteps`, for work that is not enrollment. Updating the printer half is the usual one.

## Step 6: tests

Vitest next to the code. Patchers get a test proving that patching twice changes nothing.

---

# Part 4: prove it

## Against a fake printer, first

Write `testkit/fixture.json` and `testkit/skeleton/`: your printer's facts, and a directory tree
standing in for its filesystem with paths written as your variables. The runner is generic, so the
whole enrollment and install path runs against your description with no hardware attached.

This is the loop you develop in. Get it green before you touch a printer.

## Then the gate

```sh
bash <your-printer>/scripts/check.sh
```

Both halves, both test suites, the shared detectors, the size ceilings. CI runs the same thing, so
green here is green there.

## Then a real printer

In this order, and stop at the first surprise:

1. Enroll a printer that has never been enrolled. Every step clean.
2. Enroll the same printer again. Every step a no-op, nothing fails.
3. Reboot. Everything still there, the daemon back on its own.
4. Ask the printer what it is. Your hardware tokens, firmware version and jinni version come back.
5. Install a plugin, use it, remove it. The printer's own files are as they were.
6. Restart each service you support, through Bespok3d. Each one verifiably back up.
7. Start a print. Confirm Bespok3d refuses the things it should refuse.
8. If you can: apply a vendor firmware update, then repair from the app and confirm the printer comes
   back with its plugins.

Step 8 is the one people skip and the one users hit.

---

# Part 5: the acceptance list

Copy this into your pull request and tick it honestly. An unticked line is fine; an untruthfully
ticked one is why review exists.

**The printer**

- [ ] Every table in Part 1 has an answer written down.
- [ ] The danger list is written down, and nothing on it was opened during development.
- [ ] Which directories survive a vendor firmware update is confirmed, not assumed.

**The jinni**

- [ ] `paths.json` resolves the full contract for its tier.
- [ ] `version.json` exists and is the only place the version appears.
- [ ] Every advertised capability flag was tested on hardware.
- [ ] `hardware`, `firmware_version` and `board_class` return real values from the real machine.
- [ ] `restart_command` is correct for every service, and a restart is verified, not assumed.
- [ ] Print state is correct, including paused.
- [ ] Nothing generic was added that would be identical on another printer.

**The client**

- [ ] It imports from `@adapter-sdk` and nothing else.
- [ ] Every enroll step is idempotent, proven by enrolling the same printer twice.
- [ ] `verifyEnrolled` answers both questions.
- [ ] No path or version is typed in the client.
- [ ] Every label and detail is written for a user, not for us.

**The evidence**

- [ ] The testkit fixture and skeleton exist and the generic runner passes against them.
- [ ] `scripts/check.sh` is green.
- [ ] Every behaviour has a test next to it.
- [ ] The device trial in Part 4 was run, and the pull request says which steps were run on what.

**The rules**

- [ ] No em-dash and no en-dash anywhere, including comments.
- [ ] No real credential, key, IP address, or serial number is in the tree.
- [ ] Every file is under the size ceiling.
- [ ] Nothing upstream was deleted or rewritten, only extended.
- [ ] Every failure path leaves the printer able to print.

Then go to [publishing-an-adapter.md](publishing-an-adapter.md).
