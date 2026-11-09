# Changelog

## 0.1.12

A printer on firmware 2.0 dropped out of Bespok3d on every reboot. Its boot puts Snapmaker's own copy
of `printer.cfg` and `moonraker.conf` (under `/home/lava/origin_printer_data/config`) back over the
live files whenever they differ, and that copy did not carry the Bespok3d include lines, so after
each boot Klipper and Moonraker loaded no plugin and "Put it back" never stuck. Putting the lines
back now writes them into that copy too, enrolling writes them there as well, and switching
Bespok3d off takes them out of both. A printer counts as set up only when both carry the lines, so
one enrolled before this release shows the banner once, and "Put it back" fixes it across reboots.
A firmware without that copy is wired exactly as before.

## 0.1.11

Nothing changes on the printer. This release is what lets the store show what each version of the
printer half changed, which it could not do before.

## 0.1.10

The printer stops asking to be switched off and on again because its screen had gone to sleep. It
reports a screen that only a power cycle will bring back when it can tell a sleeping panel from a
dead one, and says nothing when it cannot, so the app offers a power cycle only where one is really
needed.

This is the first version of the printer half released as its own package, so it is where this
changelog starts. What came before it is in the repository history.
