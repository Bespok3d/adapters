import { readFileSync } from 'fs'
import { join } from 'path'

import { app } from 'electron'

import { devSourcePath } from '@adapter-sdk'

// This adapter's jinni (its daemon-side half) is shipped with the adapter and installed next to the
// generic daemon, which loads it as the top-level `bespok3d_jinni` module.
export function adapterJinniPath(): string {
  const devOverride = devSourcePath(join('adapters', 'snapmaker-u1', 'jinni'))
  if (devOverride) return devOverride

  return app.isPackaged
    ? join(process.resourcesPath, 'adapters', 'snapmaker-u1', 'jinni')
    : join(app.getAppPath(), '..', 'adapters', 'snapmaker-u1', 'jinni')
}

// The shared klipper jinni runtime (the `jinni` package: base Jinni, KlipperPrinterJinni, the facets,
// service.py / __main__.py). It lives in its own repo since the ADR-0037 split, but on the printer it
// co-locates with the daemon: the device jinni `bespok3d_jinni` imports `from jinni import ...` and the
// daemon spawns `python -m jinni`, so this package must be deployed next to the daemon (DAEMON_BASE/jinni).
export function klipperJinniPath(): string {
  const devOverride = devSourcePath(join('adapters', 'klipper-jinni', 'jinni'))
  if (devOverride) return devOverride

  return app.isPackaged
    ? join(process.resourcesPath, 'adapters', 'klipper-jinni', 'jinni')
    : join(app.getAppPath(), '..', 'adapters', 'klipper-jinni', 'jinni')
}

export function daemonSrcPath(): string {
  const devOverride = devSourcePath('daemon')
  if (devOverride) return devOverride

  return app.isPackaged
    ? join(process.resourcesPath, 'daemon')
    : join(app.getAppPath(), '..', 'daemon')
}

function loadAdapterPaths(): Record<string, string> {
  return JSON.parse(readFileSync(join(adapterJinniPath(), 'paths.json'), 'utf-8'))
}

// The U1 path variables live in ONE place: paths.json in the jinni dir. The device-side jinni reads
// it at runtime and the client reads the same file here at enrollment, so the two halves can never
// drift. Derived sub-paths (etc/daemon, run, var/lib) build off the single-sourced BESPOK3D root.
export const PATHS: Record<string, string> = loadAdapterPaths()
export const BESPOK3D = PATHS.BESPOK3D
export const PRINTER_DATA = PATHS.PRINTER_DATA
export const DAEMON_BASE = `${BESPOK3D}/var/lib/daemon`

// On-printer bespok3d layout version. Baseline for future system migrations that handle breaking
// changes to how bespok3d arranges things on a printer. Lives at $BESPOK3D/etc/version and survives
// OTA (the /userdata tree persists).
export const BESPOK3D_SYSTEM_VERSION = '0.0.1'
export const SYSTEM_VERSION_FILE = `${BESPOK3D}/etc/version`
