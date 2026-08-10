// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { jinniPayloadFile } from './jinni-payload'

function loadAdapterPaths(): Record<string, string> {
  return JSON.parse(jinniPayloadFile('paths.json'))
}

// The U1 path variables live in ONE place: paths.json in the jinni dir. The device-side jinni reads
// it at runtime and the client reads the same file here at enrollment, so the two halves can never
// drift. Derived sub-paths (etc/daemon, run, var/lib) build off the single-sourced BESPOK3D root.
export const PATHS: Record<string, string> = loadAdapterPaths()
export const BESPOK3D = PATHS.BESPOK3D
export const PRINTER_DATA = PATHS.PRINTER_DATA
// The daemon and both jinni halves co-locate here: the daemon spawns `python -m jinni` and the device
// jinni imports `from jinni import ...`, so the packages sit side by side under one root.
export const DAEMON_BASE = `${BESPOK3D}/var/lib/daemon`

// On-printer bespok3d layout version. Baseline for future system migrations that handle breaking
// changes to how bespok3d arranges things on a printer. Lives at $BESPOK3D/etc/version and survives
// OTA (the /userdata tree persists).
export const BESPOK3D_SYSTEM_VERSION = '0.0.1'
export const SYSTEM_VERSION_FILE = `${BESPOK3D}/etc/version`
