# What an adapter is, and why Bespok3d needs one

Bespok3d installs plugins on a 3D printer that is running the firmware it shipped with. No flashing,
no SSH for the user, no forked firmware. To do that, something has to know where that particular
printer keeps its Klipper config, how it restarts Moonraker, whether its filesystem forgets writes on
reboot, and which of its files survive a firmware update.

That knowledge is the adapter. Everything else in Bespok3d is written as if all printers were the
same, because the adapter is the one place allowed to know they are not.

## Read this first if you have a printer we do not support

You are in the right place. Adding a printer means writing one adapter. It does not mean touching the
app, the daemon, or any plugin.

Go in this order:

| Question | Page |
| --- | --- |
| What is an adapter made of? | [anatomy-of-an-adapter.md](anatomy-of-an-adapter.md) |
| What does the app-side half do? | [anatomy-of-a-client.md](anatomy-of-a-client.md) |
| What does the printer-side half do? | [anatomy-of-a-jinni.md](anatomy-of-a-jinni.md) |
| How do I build one, start to finish? | [adapter-zero-to-hero.md](adapter-zero-to-hero.md) |
| How does mine become part of Bespok3d? | [publishing-an-adapter.md](publishing-an-adapter.md) |

## The pieces of Bespok3d, in one table

| Piece | Where it runs | What it knows |
| --- | --- | --- |
| The desktop app | your computer | printers, plugins, the user |
| The daemon | the printer | how to install a plugin, in general |
| A plugin | the printer | what it wants installed, never where |
| **The adapter** | **both** | **this printer model, and nothing else** |

A plugin says "put this file where Klipper extras go". It never names a directory, because that
directory is somewhere different on every printer and the plugin author has no way to know which
printer you own. Turning that sentence into a real directory on a real machine is the adapter's job,
and the adapter is the only thing in the system allowed to do it.

## An adapter is two halves

An adapter is one directory holding two programs that ship as a pair.

**The client** is TypeScript and runs inside the desktop app. It logs into a printer that has never
heard of Bespok3d and turns it into one that has: it does whatever this particular printer needs
before a file written to it is still there tomorrow, creates the directory tree Bespok3d owns,
installs the daemon, and hands the user back a working printer. After that it stays available for the
operations the app offers on an enrolled printer, such as updating the printer half.

**The jinni** is Python and runs on the printer, next to the daemon, as a separate process. The daemon
asks it questions ("where does Klipper config live here?", "is a print running?") and gives it work to
do ("place these files", "restart Moonraker"). The daemon never learns the answers itself.

The two halves talk to different systems and never call each other. They share two small files so
their facts cannot drift apart.

## Why the split exists

When enrollment starts there is nothing of ours on the printer. No daemon, no jinni, nothing to talk
to. The only way in is SSH from the outside, and that is the client.

Once the daemon is running the questions change. Where exactly is this file on this machine, is a
print running right now, did that service really come back up. Those have to be answered on the
printer at the moment they are asked, and that is the jinni.

Swapping the two does not work either way round. Device knowledge in the app means a printer can never
repair itself unless the app is attached. Enrollment on the printer means the printer has to be
enrolled before it can be enrolled.

## The rule that keeps it honest

The daemon orchestrates and owns the filesystem and the wire protocol. The jinni actuates and owns
device knowledge.

A board name, a kernel version, a Klipper path, a restart command: all of that is a jinni fact. The
order in which files are placed, what a package is allowed to contain, what happens when an install
fails: all of that is the daemon, and it is identical on every printer. When you find yourself adding
a printer name to the daemon, or generic install logic to a jinni, the split has been broken.

## What an adapter is not

An adapter is not a plugin. Plugins are features a user chooses; an adapter is the ground they stand
on, and a printer has exactly one.

An adapter is not firmware, and it does not replace any. It sits on top of what the vendor shipped and
is expected to survive a vendor update, or to be repairable in one click after one.

An adapter is not a fork. If your printer needs a change to the daemon or the app, that is a
conversation to have before you write it, not a patch to carry.

## The one that exists today

The Snapmaker U1 is the reference adapter, and it is the hardest kind: a read-only root filesystem, an
overlay that a firmware update wipes, a boot sequence that ignores anything added over SSH, and a
broken `pip`. Every page here uses it for its examples. A printer with a normal writable Linux and
systemd is considerably less work than the reference makes it look.

`klipper-jinni/` is the shared Klipper runtime that every printer-side half builds on. Generic Klipper
knowledge already lives there. Your adapter supplies what is left, which on a well behaved printer is
mostly a list of paths.
