# Changelog

## 0.1.12

A printer on firmware 2.0 lost its Bespok3d plugins after every reboot, and "Put it back" never
stuck. On every boot that firmware puts back its own saved copy of the printer and Moonraker
settings, and that copy did not know about Bespok3d. "Put it back" now adds Bespok3d to that copy
too, and switching Bespok3d off takes it out of both. A printer that already had Bespok3d shows the
banner once, and "Put it back" then fixes it for good. Printers on other firmware work as before.
Thanks to olavgm.

When the printer lost its Wi-Fi, Bespok3d put back the network saved on the screen, and that could
replace the network Bespok3d keeps. The kept network now stays, and if the screen's network
cannot be put back, the printer says so in its log. If restarting the Wi-Fi fails, the printer
now says so in its log and tries again 30 seconds later. Before, some failures made it stop trying
until the printer was restarted.

After a restart the screen could show Wi-Fi off while the printer was connected. When that happens,
the printer now restarts the screen app once, and the screen shows Wi-Fi on.

When a plugin stopped Klipper from starting, Bespok3d sometimes failed to notice which plugin it
was, so it did not switch that plugin off and the printer stayed stopped. On firmware 2.1 it was
reading an old Klipper log that the printer no longer writes. It now reads the log the running
Klipper and Moonraker really write, starts from the error Klipper itself reports, and never trusts
an old log. When a plugin's code made Klipper's own code fail, Bespok3d now still finds the plugin,
instead of looking only at the last file in the error.

When Klipper had stopped, the printer waited about 25 seconds before saying so, at every check.
It now says so at once, and while Klipper is still starting it checks every second, so a plugin
that stops Klipper is switched off within seconds.

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
