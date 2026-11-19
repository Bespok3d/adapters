// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { BundledPackage, EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

const openedPackages = vi.hoisted(() => ({
  open: (async () => { throw new Error('no package stubbed') }) as (packageName: string) => Promise<BundledPackage>,
}))

vi.mock('@adapter-sdk', async () => ({
  ...(await import('./fake-sdk')),
  openSystemPackage: (packageName: string) => openedPackages.open(packageName),
}))

import { uploadAdapterJinni } from './jinni-deploy'
import { fakePackage, packagedContent, packagedManifest } from './fake-packages'
import { fakePrinter } from './fake-printer'
import { ADAPTER_JINNI_PACKAGE, DAEMON_PACKAGE } from './packages'
import { DAEMON_BASE } from './paths'

// Where the daemon reads the manifests from, spelled out: the daemon's side of the contract.
const DAEMON_MANIFEST = `${DAEMON_BASE}/manifests/${DAEMON_PACKAGE}.json`
const JINNI_MANIFEST = `${DAEMON_BASE}/manifests/${ADAPTER_JINNI_PACKAGE}.json`

const REBUILT_JINNI = { edited: { 'jinni/board.py': 'board, rebuilt' }, fingerprint: 'jinni rebuilt' }

// The standalone jinni update moves the jinni alone, so the daemon reports the fingerprint of the
// jinni now running and still the one of the daemon it left in place.
describe('uploadAdapterJinni', () => {
  it("keeps the signed manifest of the jinni it placed and leaves the daemon's", async () => {
    openedPackages.open = async (packageName: string) => fakePackage(packageName, REBUILT_JINNI)
    const printer = fakePrinter({
      [DAEMON_MANIFEST]: packagedManifest(DAEMON_PACKAGE),
      [JINNI_MANIFEST]: packagedManifest(ADAPTER_JINNI_PACKAGE),
    })

    await uploadAdapterJinni(printer.ssh, {} as EnrollContext)

    expect(printer.files.get(`${DAEMON_BASE}/jinni/board.py`)?.toString()).toBe('board, rebuilt')
    expect(printer.files.get(`${DAEMON_BASE}/paths.json`)?.toString()).toBe(packagedContent(ADAPTER_JINNI_PACKAGE, 'paths.json'))
    expect(printer.files.get(JINNI_MANIFEST)?.toString()).toBe(packagedManifest(ADAPTER_JINNI_PACKAGE, 'jinni rebuilt'))
    expect(printer.files.get(DAEMON_MANIFEST)?.toString()).toBe(packagedManifest(DAEMON_PACKAGE))
    expect(printer.commands).toContain(`chmod 644 '${JINNI_MANIFEST}'`)
  })
})
