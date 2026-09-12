# Changelog

## 0.2.0

The first release of the printer half for a Klipper printer that runs on a Debian style Linux host
with systemd, which is what a Voron 2.4 on MainsailOS or a KIAUH install is. It reads where Klipper
and Moonraker actually live on this host from the host's own service files, so a printer that keeps
its configuration somewhere other than the usual place is still understood, and it restarts Klipper,
Moonraker and the web server through the host's own service manager.
