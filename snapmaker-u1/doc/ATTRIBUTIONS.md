# Attributions - Snapmaker U1 adapter

**Plugin author:** Bespok3d, against Snapmaker U1 stock firmware

Teaches Bespok3d how to talk to a Snapmaker U1.

| Upstream project | Author | Licence | Needed at runtime | Code ships in this package |
| --- | --- | --- | --- | --- |
| Snapmaker U1 stock firmware | Snapmaker | proprietary, on the printer | yes | no |

The adapter drives the printer's own stock firmware over SSH and Moonraker. Nothing from Snapmaker's
firmware ships inside this repo.

Device knowledge (service names, paths, the overlay and boot behaviour) was learned partly by
reading the SnapmakerU1 Extended Firmware (GPL-3.0, paxx12 and contributors, see its HEROES.md). No
code from it is used here.
