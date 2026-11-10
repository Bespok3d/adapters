// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
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
vi.mock('@adapter-sdk', async () => ({
  ...(await import('../fake-sdk')),
  openSystemPackage: (packageName: string) => openedPackages.open(packageName),
}))

import { stepDeployDaemon, stepRefreshDaemonVenv } from './daemon-install'
import { DAEMON_PAYLOAD, fakePackage, JINNI_PAYLOAD } from '../fake-packages'
import type { PackageRelease } from '../fake-packages'
import { fakePrinter } from '../fake-printer'
import type { FakePrinter } from '../fake-printer'
import { DAEMON_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'
import { sha256Of } from '../payload-hashes'
import type { DistributionState } from '../venv-record'

// The daemon's autostart script travels on its own, to the autostart directory; the rest goes in the stream.
const STREAMED_DAEMON_PAYLOAD = DAEMON_PAYLOAD.filter((payloadPath) => payloadPath !== 's10bespok3d-daemon')

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

const FASTAPI_WHEEL = `${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl`
const FASTAPI_DIST_INFO = `${BESPOK3D}/venv/lib/python3.11/site-packages/fastapi-0.115.0.dist-info`

function pipRuns(printer: FakePrinter): string[] {
  return printer.commands.filter((command) => command.includes('pip install'))
}

function wheelFingerprint(wheelContent: string): string {
  return createHash('sha256').update(wheelContent).digest('hex')
}

function markPackage(printer: FakePrinter, distInfoPath: string, state: DistributionState): void {
  printer.venvPackages.set(distInfoPath, { state, recordFingerprint: printer.venvPackages.get(distInfoPath)?.recordFingerprint ?? '' })
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

  // The wheel keeps its name and version, so pip would skip it as already installed unless forced.
  it('installs a wheel rebuilt at the same version over the package from the old one', async () => {
    const printer = await enrolledPrinter()
    releaseDaemon({ edited: { 'wheels/fastapi-0.115.0-py3-none-any.whl': 'a newer wheel' } })

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([['wheels/fastapi-0.115.0-py3-none-any.whl']])
    expect(pipRuns(printer)).toHaveLength(1)
    expect(printer.venvPackages.get(FASTAPI_DIST_INFO)).toEqual({ state: 'intact', recordFingerprint: wheelFingerprint('a newer wheel') })
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

    expect(printer.streams.map((stream) => stream.length)).toEqual([STREAMED_DAEMON_PAYLOAD.length + JINNI_PAYLOAD.length])
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

  it('runs no pip on the next refresh, the venv now holding those wheels whole', async () => {
    const printer = await enrolledPrinter()
    printer.files.set(NEWER_WHEEL, Buffer.from('a wheel the newer daemon brought'))

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)
    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toHaveLength(1)
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

const NEWER_WHEEL = `${DAEMON_BASE}/wheels/uvicorn-0.32.0-py3-none-any.whl`
const ADDED_WHEEL = `${DAEMON_BASE}/wheels/starlette-0.38.0-py3-none-any.whl`
const OLDER_FASTAPI_DIST_INFO = `${BESPOK3D}/venv/lib/python3.11/site-packages/fastapi-0.114.0.dist-info`
const FASTAPI_REINSTALL = `${BESPOK3D}/venv/bin/pip install --no-index --no-deps --force-reinstall '${FASTAPI_WHEEL}'`

async function refreshedPrinter(): Promise<FakePrinter> {
  const printer = await enrolledPrinter()
  printer.files.set(NEWER_WHEEL, Buffer.from('a wheel the newer daemon brought'))
  await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)
  printer.commands.length = 0

  return printer
}

// Every run judges the venv by its files against the wheels on the printer: a package that lost or
// changed a file, or came from other bytes, is installed again, and only that one.
describe('stepRefreshDaemonVenv on a venv whose files changed', () => {
  it('installs again only the package whose files no longer match its RECORD', async () => {
    const printer = await refreshedPrinter()
    markPackage(printer, FASTAPI_DIST_INFO, 'damaged')

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([FASTAPI_REINSTALL])
    expect(printer.venvPackages.get(FASTAPI_DIST_INFO)?.state).toBe('intact')
  })

  it('installs again a package gone from the venv', async () => {
    const printer = await refreshedPrinter()
    printer.venvPackages.delete(FASTAPI_DIST_INFO)

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([FASTAPI_REINSTALL])
  })

  // pip will not uninstall a package with no RECORD, so its dist-info dir is cleared before pip runs.
  it('clears a package whose RECORD is gone, then installs it again', async () => {
    const printer = await refreshedPrinter()
    markPackage(printer, FASTAPI_DIST_INFO, 'unrecorded')

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    const clearAt = printer.commands.indexOf(`rm -rf '${FASTAPI_DIST_INFO}'`)
    expect(clearAt).toBeGreaterThanOrEqual(0)
    expect(printer.commands.indexOf(FASTAPI_REINSTALL)).toBeGreaterThan(clearAt)
    expect(printer.venvPackages.get(FASTAPI_DIST_INFO)?.state).toBe('intact')
  })
})

describe('stepRefreshDaemonVenv on wheels that changed', () => {
  it('installs again only the wheel rebuilt at the version the venv holds', async () => {
    const printer = await refreshedPrinter()
    printer.files.set(FASTAPI_WHEEL, Buffer.from('a rebuilt wheel'))

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([FASTAPI_REINSTALL])
    expect(printer.venvPackages.get(FASTAPI_DIST_INFO)?.recordFingerprint).toBe(wheelFingerprint('a rebuilt wheel'))
  })

  // A new wheel brings pip in anyway, and the same run puts right what else is broken.
  it('fixes a damaged package in the run that installs a new wheel', async () => {
    const printer = await refreshedPrinter()
    printer.files.set(ADDED_WHEEL, Buffer.from('a wheel added since'))
    markPackage(printer, FASTAPI_DIST_INFO, 'damaged')

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toHaveLength(1)
    expect([...printer.venvPackages.values()].map((venvPackage) => venvPackage.state)).toEqual(['intact', 'intact', 'intact'])
  })

  // pip uninstalls the version it replaces, and refuses to when that one has no RECORD.
  it('clears another version without a RECORD in the run that installs a new wheel', async () => {
    const printer = await refreshedPrinter()
    printer.files.set(ADDED_WHEEL, Buffer.from('a wheel added since'))
    printer.venvPackages.delete(FASTAPI_DIST_INFO)
    printer.venvPackages.set(OLDER_FASTAPI_DIST_INFO, { state: 'unrecorded', recordFingerprint: '' })

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.venvPackages.has(OLDER_FASTAPI_DIST_INFO)).toBe(false)
    expect(printer.venvPackages.get(FASTAPI_DIST_INFO)?.state).toBe('intact')
  })
})
