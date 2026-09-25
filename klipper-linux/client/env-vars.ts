// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { PATHS } from './paths'

// The environment contract a plugin author can rely on: every variable bespok3d exposes on the
// printer, its value (sourced from the shared paths.json, never a second hardcoded copy), and what it
// is for. Surfaced in the app and documented for plugin authors.
//
// The values are shown as the templates they are, `$HOME` and all: on this printer the tree lives in
// the login user's home, so the real paths are only known once the app has logged in, and a screen
// that promised `/home/pi/...` to someone whose account is called something else would be lying.
const BESPOK3D = PATHS.BESPOK3D

export const ENV_VARS = [
  {
    name: 'BESPOK3D',
    value: PATHS.BESPOK3D,
    description: 'Workspace root: all bespok3d files live under here, owned by the login user',
  },
  {
    name: 'BESPOK3D_DAEMON',
    value: `${BESPOK3D}/etc/daemon`,
    description: 'Daemon identity store: keypair and TLS cert live here, never leave the printer',
  },
  {
    name: 'BESPOK3D_PLUGINS',
    value: PATHS.BESPOK3D_PLUGINS,
    description: 'Plugin installation directory: one sub-dir per plugin',
  },
  {
    name: 'BESPOK3D_AUTOSTART',
    value: `${BESPOK3D}/etc/init.d/autostart`,
    description:
      'Drop init scripts here to have them started at boot by the bespok3d-plugins service',
  },
  {
    name: 'BESPOK3D_LOG',
    value: `${BESPOK3D}/var/log`,
    description: 'Log directory: survives reboots and system updates',
  },
  {
    name: 'BESPOK3D_RUN',
    value: `${BESPOK3D}/run`,
    description: 'PID files directory (sticky bit set): cleaned of stale PIDs on each boot',
  },
  {
    name: 'BESPOK3D_LIB',
    value: `${BESPOK3D}/var/lib`,
    description: 'Persistent plugin data: survives reboots and system updates',
  },
  {
    name: 'PRINTER_DATA',
    value: PATHS.PRINTER_DATA,
    description: 'Printer data root: contains Klipper and Moonraker configs, logs and sockets',
  },
  {
    name: 'PRINTER_CFG',
    value: PATHS.PRINTER_CFG,
    description: 'Main Klipper config: plugins append sections here via start commands',
  },
  {
    name: 'MOONRAKER_CFG',
    value: PATHS.MOONRAKER_CFG,
    description: 'Main Moonraker config: plugins append sections here via start commands',
  },
  {
    name: 'KLIPPER_SRC',
    value: PATHS.KLIPPER_SRC,
    description: 'Klipper source root: instrument targets are named relative to here',
  },
  {
    name: 'KLIPPER_EXTRAS',
    value: PATHS.KLIPPER_EXTRAS,
    description: 'Klipper extras directory: plugins symlink Python modules here',
  },
  {
    name: 'MOONRAKER_COMPONENTS',
    value: PATHS.MOONRAKER_COMPONENTS,
    description: 'Moonraker components directory: plugins symlink Python modules here',
  },
  {
    name: 'BESPOK3D_KLIPPER',
    value: PATHS.BESPOK3D_KLIPPER,
    description: 'Drop *.cfg files here to load Klipper extensions; included via printer.cfg',
  },
  {
    name: 'BESPOK3D_MOONRAKER',
    value: PATHS.BESPOK3D_MOONRAKER,
    description: 'Drop *.cfg files here to extend Moonraker; included via moonraker.conf',
  },
  {
    name: 'RUNTIME_USER',
    value: PATHS.RUNTIME_USER,
    description:
      'OS user that owns and runs all bespok3d services, Klipper and Moonraker; use for chown/chmod',
  },
  {
    name: 'SSH_USER',
    value: 'pi',
    description:
      'SSH authentication user: on this printer it is also the runtime user, since bespok3d runs as whoever logs in',
  },
]
