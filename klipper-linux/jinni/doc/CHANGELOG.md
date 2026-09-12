# Changelog

## 0.2.0

The first release of the printer half for a Klipper printer that runs on a Debian style Linux host
with systemd, which is what a Voron 2.4 on MainsailOS or a KIAUH install is. One package serves both
adapter ids the app registers against it, "Voron 2.4" and "Klipper: generic", and reports itself as
whichever one the printer was enrolled under. It reads where Klipper and Moonraker actually live on
this host from the host's own service files, so a printer that keeps its configuration somewhere
other than the usual place is still understood, and it restarts Klipper and Moonraker through the
host's own service manager. The host's web server is left alone: there is no web hook here, and a
plugin that needs a web location is refused on this adapter rather than served. It advertises the
`klipper-generic` capability, which is the flag a plugin manifest asks for when it means "any
Klipper printer".
