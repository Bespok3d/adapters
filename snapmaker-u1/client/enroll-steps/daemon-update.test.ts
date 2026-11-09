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

import { stepDeployDaemon, stepRefreshDaemonVenv } from './daemon-install'
import { fakePackage, JINNI_PAYLOAD } from '../fake-packages'
import type { PackageRelease } from '../fake-packages'
import { fakePrinter } from '../fake-printer'
import type { FakePrinter } from '../fake-printer'
import { DAEMON_PACKAGE } from '../packages'
import { DAEMON_BASE } from '../paths'
import { sha256Of } from '../payload-hashes'

// An update compares the printer's files with the signed package and sends only what differs.
const updateEnroll = { sendChangedFilesOnly: true } as EnrollContext

function releaseDaemon(daemonRelease: PackageRelease): void {
  openedPackages.open = async (packageName: string) => fakePackage(packageName, packageName === DAEMON_PACKAGE ? daemonRelease : {})
}

async function enrolledPrinter(printerFiles: Record<string, string> = {}): Promise<FakePrinter> {
  releaseDaemon({})
  const printer = fakePrinter(printerFiles)
  await stepDeployDaemon(printer.ssh, {} as EnrollContext)
  printer.commands.length = 0
  printer.streams.length = 0
  printer.uploads.length = 0

  return printer
}

function pipRuns(printer: FakePrinter): string[] {
  return printer.commands.filter((command) => command.includes('pip install'))
}

describe('stepDeployDaemon as an update', () => {
  it('sends no file and skips pip when the printer already holds every file', async () => {
    const printer = await enrolledPrinter()

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([])
    expect(printer.uploads).toEqual([expect.stringContaining('s10bespok3d-daemon')])
    expect(pipRuns(printer)).toEqual([])
  })

  it('sends the changed file in one stream with the signed bytes, and removes the file the package dropped', async () => {
    const printer = await enrolledPrinter({ [`${DAEMON_BASE}/data/state.json`]: '{}' })
    releaseDaemon({ edited: { 'core/state.py': 'state, edited' }, dropped: ['core/legacy.py'] })

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([['core/state.py']])
    expect(sha256Of(printer.files.get(`${DAEMON_BASE}/core/state.py`)!)).toBe(sha256Of(Buffer.from('state, edited')))
    expect(printer.files.has(`${DAEMON_BASE}/core/legacy.py`)).toBe(false)
    expect(printer.files.has(`${DAEMON_BASE}/data/state.json`)).toBe(true)
    expect(pipRuns(printer)).toEqual([])
  })

  it('runs pip when a wheel changed', async () => {
    const printer = await enrolledPrinter()
    releaseDaemon({ edited: { 'wheels/fastapi-0.115.0-py3-none-any.whl': 'a newer wheel' } })

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([['wheels/fastapi-0.115.0-py3-none-any.whl']])
    expect(pipRuns(printer)).toHaveLength(1)
  })

  // Whether the files go one by one or all together, pip decides on the wheels the venv already holds.
  it('skips pip on a full send when the venv already holds these wheels', async () => {
    const printer = await enrolledPrinter()

    await stepDeployDaemon(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([])
  })

  it('falls back to sending every file when the printer cannot list its hashes', async () => {
    const printer = await enrolledPrinter()
    releaseDaemon({ edited: { 'core/state.py': 'state, edited' } })
    printer.failingCommand = /sha256sum/

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams.map((stream) => stream.length)).toEqual([7 + JINNI_PAYLOAD.length])
  })
})

// A connection lost part way through leaves the printer in a state the same update finishes.
describe('stepDeployDaemon as an update cut off part way', () => {
  const release = { edited: { 'core/state.py': 'state, edited', 'wheels/fastapi-0.115.0-py3-none-any.whl': 'a newer wheel' }, dropped: ['core/legacy.py'] }

  async function cutThenRerun(cutPoint: RegExp): Promise<FakePrinter> {
    const printer = await enrolledPrinter()
    releaseDaemon(release)
    printer.cutPoint = cutPoint
    await expect(stepDeployDaemon(printer.ssh, updateEnroll)).rejects.toThrow('connection lost')
    printer.connectionLost = false
    printer.commands.length = 0
    await stepDeployDaemon(printer.ssh, updateEnroll)

    return printer
  }

  function expectReleaseInPlace(printer: FakePrinter): void {
    expect(printer.files.get(`${DAEMON_BASE}/core/state.py`)?.toString()).toBe('state, edited')
    expect(printer.files.has(`${DAEMON_BASE}/core/legacy.py`)).toBe(false)
    expect(pipRuns(printer)).toHaveLength(1)
  }

  it('is put right by running it again when cut after the stream', async () => {
    const printer = await cutThenRerun(/^rm -f /)

    expectReleaseInPlace(printer)
  })

  it('is put right by running it again when cut after the removal', async () => {
    const printer = await cutThenRerun(/pip install/)

    expectReleaseInPlace(printer)
  })
})

// The app keeps a daemon newer than the one it ships, so the daemon step does not run, and the venv is
// brought up to the wheels that daemon left on the printer.
describe('stepRefreshDaemonVenv', () => {
  const NEWER_WHEEL = `${DAEMON_BASE}/wheels/uvicorn-0.32.0-py3-none-any.whl`

  it('installs the wheels the kept daemon brought when the venv does not hold them', async () => {
    const printer = await enrolledPrinter()
    printer.files.set(NEWER_WHEEL, Buffer.from('a wheel the newer daemon brought'))

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toHaveLength(1)
    expect(pipRuns(printer)[0]).toContain(NEWER_WHEEL)
    expect(printer.streams).toEqual([])
    expect(printer.uploads).toEqual([])
  })

  it('runs no pip when the venv already holds the wheels on the printer', async () => {
    const printer = await enrolledPrinter()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([])
  })

  it('touches nothing on a printer that holds no wheels', async () => {
    const printer = fakePrinter()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.commands).toHaveLength(1)
    expect(printer.files.size).toBe(0)
  })
})
