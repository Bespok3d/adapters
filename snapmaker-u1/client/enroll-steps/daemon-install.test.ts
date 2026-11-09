// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { BundledPackage, EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../../Bespok3d-desktop', import.meta.url)) },
}))

const openedPackages = vi.hoisted(() => ({
  open: (async () => { throw new Error('no package stubbed') }) as (packageName: string) => Promise<BundledPackage>,
}))

// The daemon and the jinni both come through the SDK's machinery door, because the app can offer a
// published one newer than the copy it ships with, and a daemon release can need a newer jinni.
vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
  openSystemPackage: (packageName: string) => openedPackages.open(packageName),
}))

import { stepDeployDaemon } from './daemon-install'
import { fakePackage, JINNI_PAYLOAD, packagedContent } from '../fake-packages'
import { fakePrinter } from '../fake-printer'
import { DAEMON_PACKAGE, ADAPTER_JINNI_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'

const DAEMON_RUNTIME = [
  'daemon.py',
  'version.py',
  'api/routes.py',
  'core/state.py',
  'core/legacy.py',
  'wheels/fastapi-0.115.0-py3-none-any.whl',
  'S99bespok3d',
]

function stubBundledPackages(): void {
  openedPackages.open = async (packageName: string) => fakePackage(packageName)
}

const silentEnroll = {} as EnrollContext

describe('stepDeployDaemon', () => {
  // The whole point of the stage: a package whose signature does not check out must not put a byte on
  // the printer. Not "the error was raised": that nothing was uploaded and no command was run.
  it('leaves the printer untouched when the package is refused', async () => {
    openedPackages.open = async () => {
      throw new Error('the signature on the package for "bespok3d-daemon" does not check out')
    }
    const printer = fakePrinter()

    await expect(stepDeployDaemon(printer.ssh, silentEnroll)).rejects.toThrow('does not check out')

    expect(printer.files.size).toBe(0)
    expect(printer.commands).toEqual([])
  })

  // The boot dispatcher stays beside the daemon, for the step that installs it to copy; the daemon's
  // own autostart script goes to the autostart directory alone.
  it('places the daemon runtime and its boot dispatcher from the package, and its autostart script outside the runtime tree', async () => {
    stubBundledPackages()
    const printer = fakePrinter()

    await stepDeployDaemon(printer.ssh, silentEnroll)

    DAEMON_RUNTIME.forEach((payloadPath) => {
      expect(printer.files.get(`${DAEMON_BASE}/${payloadPath}`)?.toString()).toBe(packagedContent(DAEMON_PACKAGE, payloadPath))
    })
    expect(printer.files.get(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`)?.toString())
      .toBe(packagedContent(DAEMON_PACKAGE, 's10bespok3d-daemon'))
    expect([...printer.files.keys()].some((filePath) => filePath.startsWith('/etc/'))).toBe(false)
    expect(printer.files.has(`${DAEMON_BASE}/s10bespok3d-daemon`)).toBe(false)
  })

  // ADR-0037: the jinni is its own signed package, and the files placed on the printer are its payload,
  // never a copy read out of the adapter checkout the app was built from.
  it('places the jinni from the jinni package alone', async () => {
    stubBundledPackages()
    const printer = fakePrinter()

    await stepDeployDaemon(printer.ssh, silentEnroll)

    JINNI_PAYLOAD.forEach((payloadPath) => {
      expect(printer.files.get(`${DAEMON_BASE}/${payloadPath}`)?.toString()).toBe(packagedContent(ADAPTER_JINNI_PACKAGE, payloadPath))
    })
  })

  // Enrollment and repair send everything, so a printer whose files were damaged in place is put right
  // even where its hashes would never be asked.
  it('sends every daemon and jinni file in one stream when it is not an update', async () => {
    stubBundledPackages()
    const printer = fakePrinter()

    await stepDeployDaemon(printer.ssh, silentEnroll)
    await stepDeployDaemon(printer.ssh, silentEnroll)

    expect(printer.streams).toHaveLength(2)
    expect(printer.streams[1].sort()).toEqual([...DAEMON_RUNTIME, ...JINNI_PAYLOAD].sort())
    expect(printer.commands.filter((command) => command.includes('sha256sum'))).toEqual([])
  })
})

// The step is minutes long and sends over a hundred files. A bar that cannot move while the file
// count beside it climbs reads as a hung app, so the upload reports how far through it is, and owns a
// slice of the bar so the reported number only ever climbs.
describe('stepDeployDaemon progress', () => {
  it('advances a file at a time through the upload and never reports backwards', async () => {
    stubBundledPackages()
    const printer = fakePrinter()
    const reports: [string, number | undefined][] = []
    const watchedEnroll = { onProgress: (hint: string, stepFraction?: number) => { reports.push([hint, stepFraction]) } } as EnrollContext

    await stepDeployDaemon(printer.ssh, watchedEnroll)

    const uploadFractions = reports.filter(([hint]) => hint.startsWith('Uploading daemon files…')).map(([, fraction]) => fraction ?? -1)
    expect(uploadFractions).toHaveLength(DAEMON_RUNTIME.length + JINNI_PAYLOAD.length)
    expect(uploadFractions[uploadFractions.length - 1]).toBeCloseTo(0.88)
    const allFractions = reports.map(([, fraction]) => fraction).filter((fraction) => fraction !== undefined)
    expect(allFractions).toEqual([...allFractions].sort((earlier, later) => earlier - later))
  })
})

describe('stepDeployDaemon over an already enrolled printer', () => {
  // Installing over an existing tree clears what the two packages own and nothing else, so a printer
  // that is already enrolled keeps its certificate, its token, its daemon data and its installed
  // plugins through a reinstall, while a file the package no longer carries goes.
  it("preserves the printer's own files and drops the package's stale ones", async () => {
    stubBundledPackages()
    const printerOwned = {
      [`${BESPOK3D}/etc/token`]: 'token',
      [`${BESPOK3D}/var/lib/plugins/camera/manifest.json`]: '{}',
      [`${DAEMON_BASE}/data/state.json`]: '{}',
    }
    const printer = fakePrinter({
      ...printerOwned,
      [`${DAEMON_BASE}/api/retired_route.py`]: 'old',
      [`${BESPOK3D}/var/lib/demon/daemon.py`]: 'misspelled',
    })

    await stepDeployDaemon(printer.ssh, silentEnroll)

    Object.keys(printerOwned).forEach((printerOwnedPath) => expect(printer.files.has(printerOwnedPath)).toBe(true))
    expect(printer.files.has(`${DAEMON_BASE}/api/retired_route.py`)).toBe(false)
    expect(printer.files.has(`${BESPOK3D}/var/lib/demon/daemon.py`)).toBe(false)
  })

  it('installs the wheels the package carries, offline, from files already on the printer', async () => {
    stubBundledPackages()
    const printer = fakePrinter()

    await stepDeployDaemon(printer.ssh, silentEnroll)

    const installCommand = printer.commands.find((command) => command.includes('pip install'))
    expect(installCommand).toBe(
      `${BESPOK3D}/venv/bin/pip install --no-index --no-deps '${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl'`,
    )
  })
})
