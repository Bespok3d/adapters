// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { BESPOK3D, PATHS } from './paths'

// The environment contract a plugin author can rely on: every variable bespok3d exposes on the
// printer, its value (sourced from the shared paths.json, never a second hardcoded copy), and what it
// is for. Surfaced in the app and documented for plugin authors.
export const ENV_VARS = [
  {
    name: 'BESPOK3D',
    value: PATHS.BESPOK3D,
    description: 'Workspace root: all bespok3d files live under here',
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
    description: 'Drop init scripts here to have them auto-started at boot by S99bespok3d',
  },
  {
    name: 'BESPOK3D_NGINX',
    value: `${BESPOK3D}/etc/nginx/locations`,
    description: 'Drop *.conf files here to expose plugin endpoints through the printer nginx',
  },
  {
    name: 'BESPOK3D_LOG',
    value: `${BESPOK3D}/var/log`,
    description: 'Log directory: survives reboots and OTA updates',
  },
  {
    name: 'BESPOK3D_RUN',
    value: `${BESPOK3D}/run`,
    description: 'PID files directory (sticky bit set): cleaned of stale PIDs on each boot',
  },
  {
    name: 'BESPOK3D_LIB',
    value: `${BESPOK3D}/var/lib`,
    description: 'Persistent plugin data: survives reboots and OTA updates',
  },
  {
    name: 'PRINTER_DATA',
    value: PATHS.PRINTER_DATA,
    description: 'OEM printer data root: contains Klipper and Moonraker configs',
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
      'OS user that owns and runs all bespok3d services and Klipper; use for chown/chmod',
  },
  {
    name: 'SSH_USER',
    value: 'root',
    description: 'SSH authentication user: only relevant during enrollment and remote ops',
  },
]
