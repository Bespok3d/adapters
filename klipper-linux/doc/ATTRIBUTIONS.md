# Attributions - Klipper on Linux adapter

**Plugin author:** Bespok3d, against a stock MainsailOS, Fluidd or KIAUH install

Teaches Bespok3d how to enrol and talk to a Klipper printer whose host is a Debian style Linux box
with systemd, which is what a Voron 2.4 normally runs.

| Upstream project | Author | Licence | Needed at runtime | Code ships in this package |
| --- | --- | --- | --- | --- |
| Klipper | Kevin O'Connor and contributors | GPL-3.0 | yes, on the printer | no |
| Moonraker | Eric Callahan (Arksine) and contributors | GPL-3.0 | yes, on the printer | no |
| MainsailOS | the mainsail-crew | GPL-3.0 | no, it is one supported image | no |
| KIAUH | Dominik Willner (dw-0) and contributors | GPL-3.0 | no, it is one supported installer | no |
| nginx | Igor Sysoev, Nginx Inc and contributors | BSD-2-Clause | only where the host runs one | no |

The adapter drives the host's own Klipper, Moonraker, systemd and nginx over SSH. Nothing from any
of those projects ships inside this repo.

Device knowledge (where the environment files sit, what `KLIPPER_ARGS` and `MOONRAKER_ARGS` hold,
the unit names, the data folder shape, the nginx site names and what they proxy) was learned by
reading the published sources of MainsailOS, KIAUH and Moonraker's own installer. No code from them
is used here.
