# Story obligations

What an adapter owes the user stories. The rows below are written against the snapmaker-u1 adapter, the only one shipped so far; another adapter answers the same rows with its own machine's steps.

The stories themselves live in one place, in the app repo, under `Bespok3d-desktop/doc/stories/`. This
page lists only the rows this repo has to deliver. Nothing here is a second copy of a
story: it is the obligation, and the story is the source.

| Story | Owner | What this repo has to deliver |
| --- | --- | --- |
| `Bespok3d-desktop/doc/stories/catalog-and-install/install-plugin.md` (Install a plugin on a printer) | daemon | declare what the machine can take, so a package for another printer is never offered |
| `Bespok3d-desktop/doc/stories/identity-and-trust/verified-manufacturer.md` (Enroll as a verified manufacturer) | Bespok3d org | be the maintained, hardware-tested adapter that a manufacturer trust tier is granted against |
| `Bespok3d-desktop/doc/stories/printer-lifecycle/add.md` (Add a printer) | adapters | own the enrollment step list for the machine, and surface the daemon fingerprint on the printer so the owner can compare it |
| `Bespok3d-desktop/doc/stories/printer-lifecycle/deactivate-bespok3d.md` (Deactivate Bespok3d on a printer) | app | own the machine-side steps of standing down, and the boot hook removal |
| `Bespok3d-desktop/doc/stories/printer-lifecycle/discover.md` (Discover a printer) | app | supply the printer model shown next to a discovered printer |
| `Bespok3d-desktop/doc/stories/printer-lifecycle/reactivate-bespok3d.md` (Reactivate Bespok3d on a printer) | app | own the machine-side restore steps, including the config include lines and the boot hook |
| `Bespok3d-desktop/doc/stories/printer-lifecycle/uninstall-bespok3d.md` (Uninstall Bespok3d from a printer) | adapters | own the machine-side teardown list, and leave the printer booting exactly as it did before |
