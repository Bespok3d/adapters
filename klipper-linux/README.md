# klipper-linux

The Bespok3d adapter for a Klipper printer whose host is a Debian style Linux box with systemd: a
Voron 2.4 running MainsailOS on a Raspberry Pi, a Fluidd or KIAUH install, a BTT CB1 image. One code
base registers two adapter ids, `voron-24` ("Voron 2.4") and `klipper-generic` ("Klipper: generic").
They run the same steps against the same jinni package and differ only in what the picker shows.

It has **not yet run on real hardware**. It has run end to end against a bench: a Debian 12 arm64
VM laid out exactly like MainsailOS (Klipper on its Linux host MCU, Moonraker, a `pi` account whose
sudo asks for its password), driven by the app's own enrolment, daemon client and lifecycle code
(`Bespok3d-desktop/tests/invitro/klipper-linux-bench.invitro.test.ts`). Enrolment, the daemon and
jinni reporting the adapter, deactivate, reactivate with plugin recovery, a second enrolment and a
clean removal all pass there. The first run on a printer is still ahead.

## What the printer has to be

- 64 bit Linux (`aarch64` or `x86_64`) with systemd. A 32 bit image is refused at enrolment.
- `klipper.service` and `moonraker.service` both installed as system units.
- A configured printer: a `printer.cfg` and a `moonraker.conf` that exist. A freshly flashed
  MainsailOS image has neither. Enrolment finds that out at its layout step, after the workspace and
  the daemon files have gone under the login user's home and before anything system wide is
  touched, and stops there with the reason.
- Python 3.11 or newer, with `python3-venv` (MainsailOS and Raspberry Pi OS Lite both carry it).
- SSH reachable, and an account that can use `sudo`. MainsailOS removes passwordless sudo, so sudo
  asks for the account password; that password is the SSH password.

## How it lives on the printer

Everything Bespok3d runs runs **as the SSH login user**, never root. The workspace is
`$HOME/bespok3d`, created and owned by that user, so every upload and every daemon write needs no
privilege. That mirrors how Klipper and Moonraker already live in that user's home. The daemon's
log is opened by that user too, never by systemd as root, so nothing root owned ever lands in the
tree. The access list and the daemon's private key are readable by that account alone.

Root is needed, through `sudo` with the account password, for the enrolment (writing the sudoers
drop in, the two systemd units and enabling them) and for the operations that undo or redo that:
deactivating, reactivating and removing Bespok3d each ask for the account password again. The
password is fed to `sudo` from a file only that account can read, created with its private mode
before the password is written into it, and removed by the same command that read it.

After enrolment the only privileged commands are the ones `/etc/sudoers.d/bespok3d` names one by
one: start, stop and restart the two Bespok3d units, restart Klipper, restart Moonraker, and
reboot. Each is a full command line, so none of them can be widened by an argument, every call
uses `sudo -n` so it fails rather than waits for a prompt no one can answer, and none of them makes
root read a file this account can write.

The boot chain is two units rendered from templates in the jinni package. `bespok3d.service` runs
the daemon. `bespok3d-plugins.service` runs `$BESPOK3D/etc/init.d/bespok3d-plugins`, which starts
and stops the plugin services in order. A daemon restart never takes a running plugin service down
with it.

## What it does not do

- **No web server changes.** The host's nginx is the host's. A plugin that publishes a web page or
  endpoint through the printer's web server is refused on this adapter, with the reason, rather
  than placed: a file this account could write and root's nginx would read would be a road to root.
- **One printer per host.** A KIAUH multi instance layout (`printer_1_data`, `klipper-1.service`)
  is not supported. The discovery reads `klipper.service` and `moonraker.service` and nothing else.
- **No kernel modules.** This adapter reports no kernel version magic and advertises no
  `kernel-modules` capability, so the daemon refuses a plugin that ships a `.ko` for this printer.
- **No 32 bit hosts.**
- **Python dependencies link into Klipper's interpreter only.** Klipper and Moonraker each run in
  their own virtualenv here. A plugin's `klipper_requirements.txt` is linked into Klipper's venv
  (`PYTHON_SITE_PACKAGES` is discovered as that venv's site-packages); a Moonraker component that
  needs a Python dependency of its own has no interpreter to be linked into on this adapter.
- **No in vitro fixture.** The U1's harness is root and busybox shaped and does not model this host,
  and there is no Docker fixture for a Pi in this workspace.

## Where the layout comes from

MainsailOS and KIAUH both write the truth into `~/printer_data/systemd/klipper.env` and
`moonraker.env`, which the units then read. `jinni/layout_discovery.py` reads the environment file
each unit names (the conventional file under `printer_data` when the unit names none, and the stock
layout under the home directory when a host answers nothing) and answers with where Klipper, its
extras and its virtualenv, Moonraker, its components, the configs, the logs and the sockets really
are. Enrolment stores that as `$BESPOK3D/etc/layout.json`, and at runtime the jinni lets those
values override the `$HOME` templates in `jinni/paths.json`. A host with no layout file is served by
the templates alone, which is exactly the stock layout. Nothing here assumes the login is `pi`.

## Installing the daemon's dependencies

The daemon ships pre built wheels for CPython 3.11 on aarch64. On MainsailOS 2.x (Bookworm, Python
3.11) they install offline with no network at all. On MainsailOS 3.0.0 (Trixie, Python 3.13) they do
not fit, so enrolment reports why and falls back to an online `pip install -r requirements.txt`
against the unpinned ranges that ship in the same payload. A printer with neither the right ABI nor
a working network is told which of the two failed and what pip said.

## Layout

```text
jinni/                       the printer side half (flat files, stdlib only, Python 3.11)
  bespok3d_jinni.py          the composition root: facts, paths, restart commands, service scripts
  linux_layout.py            templates expanded for this account, overridden by discovery
  layout_discovery.py        read the real layout off the host; also the enrolment CLI
  systemd_env.py             parse a unit and its EnvironmentFile
  linux_facts.py             arch, board class, OS version, kernel release, Klipper version
  service_scripts.py         render a plugin service's init script from service.sh
  service.sh                 that template (start-stop-daemon, unprivileged)
  bespok3d.service           the daemon unit template
  bespok3d-plugins.service   the plugin services unit template
  bespok3d-plugins.sh        the autostart runner both verbs of that unit call
  s10bespok3d-daemon.sh      the daemon's autostart entry, a thin wrapper over systemctl
  bespok3d.sudoers           the sudoers drop in template
  paths.json                 the path variable templates
  manifest.json, version.json, doc/CHANGELOG.md
  tests/                     never staged into the package
client/                      the app side half (TypeScript, against @adapter-sdk)
scripts/check.sh             this adapter's gate
```

## The gate

```sh
bash scripts/check.sh
```

It is not hermetic: it reaches workspace siblings. The jinni half needs `daemon` and
`klipper-jinni` checked out (its mypy path) and runs ruff, mypy, pytest and the size ratchet. The
client half needs the `Bespok3d-desktop` repo checked out and uses its node toolchain for tsc,
eslint and vitest. The shared detectors (em dash ban, workflow pinning, shellcheck) run over the
whole adapter, the unit and sudoers templates included.
