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
