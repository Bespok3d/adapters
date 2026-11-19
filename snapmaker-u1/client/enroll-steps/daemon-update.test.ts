// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
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
import { DAEMON_PAYLOAD, fakePackage, JINNI_PAYLOAD, packagedManifest } from '../fake-packages'
import type { PackageRelease } from '../fake-packages'
import { fakePrinter } from '../fake-printer'
import type { FakePrinter } from '../fake-printer'
import { ADAPTER_JINNI_PACKAGE, DAEMON_PACKAGE } from '../packages'
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

// Where the daemon reads the fingerprint each machinery package carried.
const DAEMON_MANIFEST = `${DAEMON_BASE}/manifests/${DAEMON_PACKAGE}.json`
const JINNI_MANIFEST = `${DAEMON_BASE}/manifests/${ADAPTER_JINNI_PACKAGE}.json`

const FASTAPI_WHEEL = `${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl`
const FASTAPI_DIST_INFO = `${BESPOK3D}/venv/lib/python3.11/site-packages/fastapi-0.115.0.dist-info`

function pipRuns(printer: FakePrinter): string[] {
  return printer.commands.filter((command) => command.includes('pip install'))
}

function wheelFingerprint(wheelContent: string): string {
  return createHash('sha256').update(wheelContent).digest('hex')
}

function venvStates(printer: FakePrinter): Record<string, DistributionState> {
  return Object.fromEntries([...printer.venvPackages].map(([distInfoPath, venvPackage]) => [posix.basename(distInfoPath), venvPackage.state]))
}

function markPackage(printer: FakePrinter, distInfoPath: string, state: DistributionState): void {
  const venvPackage = printer.venvPackages.get(distInfoPath)
  if (!venvPackage) throw new Error(`No package in the venv at ${distInfoPath} to mark`)
  printer.venvPackages.set(distInfoPath, { ...venvPackage, state })
}

describe('stepDeployDaemon as an update', () => {
  it('sends no file and skips pip when the printer already holds every file', async () => {
    const printer = await enrolledPrinter()

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([])
    expect(printer.uploads).toEqual([expect.stringContaining('s10bespok3d-daemon'), DAEMON_MANIFEST, JINNI_MANIFEST])
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

describe('stepDeployDaemon as an update that only drops a file', () => {
  it('removes the file the package dropped when no file changed', async () => {
    const printer = await enrolledPrinter()
    releaseDaemon({ dropped: ['core/legacy.py'] })

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.streams).toEqual([])
    expect(printer.files.has(`${DAEMON_BASE}/core/legacy.py`)).toBe(false)
  })
})

// A daemon rebuilt at the same version is told apart only by its fingerprint, so the update leaves the
// rebuild's on the printer, and only once the rebuild is in place: an update cut short before it is
// offered again.
describe('stepDeployDaemon as an update rebuilt at the same version', () => {
  const rebuild = { edited: { 'core/state.py': 'state, rebuilt' }, fingerprint: 'daemon rebuilt' }

  it("keeps the rebuild's signed manifest", async () => {
    const printer = await enrolledPrinter()
    releaseDaemon(rebuild)

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.files.get(DAEMON_MANIFEST)?.toString()).toBe(packagedManifest(DAEMON_PACKAGE, 'daemon rebuilt'))
    expect(printer.files.get(JINNI_MANIFEST)?.toString()).toBe(packagedManifest(ADAPTER_JINNI_PACKAGE))
  })

  it("leaves the replaced daemon's manifest when cut short after the files, and the rerun keeps the rebuild's", async () => {
    const printer = await enrolledPrinter()
    releaseDaemon(rebuild)
    printer.cutPoint = /^mkdir -p '[^']*\/manifests'$/
    await expect(stepDeployDaemon(printer.ssh, updateEnroll)).rejects.toThrow('connection lost')
    printer.connectionLost = false

    expect(printer.files.get(`${DAEMON_BASE}/core/state.py`)?.toString()).toBe('state, rebuilt')
    expect(printer.files.get(DAEMON_MANIFEST)?.toString()).toBe(packagedManifest(DAEMON_PACKAGE))

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.files.get(DAEMON_MANIFEST)?.toString()).toBe(packagedManifest(DAEMON_PACKAGE, 'daemon rebuilt'))
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
    const printer = await cutThenRerun(/^chmod /)

    expectReleaseInPlace(printer)
  })

  it('is put right by running it again when cut after the removal', async () => {
    const printer = await cutThenRerun(/pip install/)

    expectReleaseInPlace(printer)
  })
})

// An update that swaps a wheel for another version and is cut short never leaves both on the printer,
// so the venv refreshes after it settle and stay settled. The old wheel goes in the same command that
// copies the new one, so a cut lands before both or after both.
describe('stepDeployDaemon swapping a wheel, cut off part way', () => {
  const NEXT_FASTAPI_WHEEL = 'wheels/fastapi-0.116.0-py3-none-any.whl'
  const wheelSwap = { dropped: ['wheels/fastapi-0.115.0-py3-none-any.whl'], added: { [NEXT_FASTAPI_WHEEL]: 'the next fastapi' } }

  function fastapiWheelsOn(printer: FakePrinter): string[] {
    return [...printer.files.keys()].filter((filePath) => filePath.startsWith(`${DAEMON_BASE}/wheels/fastapi-`))
  }

  // The fake printer cannot cut a command half run; ignoring HUP is what keeps a real one from it.
  it('removes the old wheel in the command that copies the new one, which a lost connection does not stop', async () => {
    const printer = await enrolledPrinter()
    releaseDaemon(wheelSwap)

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.commands).toContainEqual(expect.stringMatching(/^trap '' HUP; .* && cp -a .* && rm -f '[^']*fastapi-0\.115\.0[^']*' && rm -rf /))
  })

  it.each([
    [/rm -f '[^']*fastapi-0\.115\.0/],
    [/^chmod /],
    [/pip install/],
  ])('leaves no two wheels for venv refreshes to swap, when cut at %s', async (cutPoint) => {
    const printer = await enrolledPrinter()
    releaseDaemon(wheelSwap)
    printer.cutPoint = cutPoint
    await expect(stepDeployDaemon(printer.ssh, updateEnroll)).rejects.toThrow('connection lost')
    printer.connectionLost = false

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)
    printer.commands.length = 0
    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(fastapiWheelsOn(printer)).toHaveLength(1)
    expect(pipRuns(printer)).toEqual([])
  })
})

const NEWER_WHEEL = `${DAEMON_BASE}/wheels/uvicorn-0.32.0-py3-none-any.whl`

async function printerWithNewerWheel(): Promise<FakePrinter> {
  const printer = await enrolledPrinter()
  printer.files.set(NEWER_WHEEL, Buffer.from('a wheel the newer daemon brought'))

  return printer
}

// The app keeps a daemon newer than the one it ships, so the daemon step does not run, and the venv is
// brought up to the wheels that daemon left on the printer.
describe('stepRefreshDaemonVenv', () => {
  it('installs the wheels the kept daemon brought when the venv does not hold them', async () => {
    const printer = await printerWithNewerWheel()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toHaveLength(1)
    expect(pipRuns(printer)[0]).toContain(NEWER_WHEEL)
    expect(printer.streams).toEqual([])
    expect(printer.uploads).toEqual([])
  })

  it('runs no pip on the next refresh, the venv now holding those wheels whole', async () => {
    const printer = await printerWithNewerWheel()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)
    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toHaveLength(1)
  })

  it('runs no pip when the venv already holds the wheels on the printer', async () => {
    const printer = await enrolledPrinter()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([])
  })

  it('only removes the old wheel list and lists the wheels on a printer that holds none', async () => {
    const printer = fakePrinter()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.commands).toEqual([`rm -f ${BESPOK3D}/venv/.bespok3d-wheels`, expect.stringContaining('sha256sum')])
    expect(printer.files.size).toBe(0)
  })
})

const PIP_DIST_INFO = `${BESPOK3D}/venv/lib/python3.11/site-packages/pip-24.0.dist-info`
const VENV_REMAKE = `rm -rf ${BESPOK3D}/venv && python3 -m venv ${BESPOK3D}/venv`
const REFRESHED_VENV_WHOLE = { 'fastapi-0.115.0.dist-info': 'intact', 'pip-24.0.dist-info': 'intact', 'uvicorn-0.32.0.dist-info': 'intact' }
const ADDED_WHEEL = `${DAEMON_BASE}/wheels/starlette-0.38.0-py3-none-any.whl`
const OLDER_FASTAPI_DIST_INFO = `${BESPOK3D}/venv/lib/python3.11/site-packages/fastapi-0.114.0.dist-info`
const FASTAPI_REINSTALL = `${BESPOK3D}/venv/bin/pip install --no-index --no-deps --force-reinstall '${FASTAPI_WHEEL}'`

async function refreshedPrinter(): Promise<FakePrinter> {
  const printer = await printerWithNewerWheel()
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

function expectVenvMadeAgainWhole(printer: FakePrinter): void {
  expect(printer.commands).toContain(VENV_REMAKE)
  expect(pipRuns(printer)).toHaveLength(1)
  expect(venvStates(printer)).toEqual(REFRESHED_VENV_WHOLE)
}

// The check runs on the venv's own python, so a venv whose python fails is made again, then filled.
describe('stepRefreshDaemonVenv on a venv whose python does not run', () => {
  it('makes the venv again once and installs every wheel into it, without checking it', async () => {
    const printer = await refreshedPrinter()
    printer.venvPythonBroken = true

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expectVenvMadeAgainWhole(printer)
    expect(printer.commands.filter((command) => command === VENV_REMAKE)).toHaveLength(1)
    expect(venvChecks(printer)).toEqual([])
  })
})

function venvChecks(printer: FakePrinter): string[] {
  return printer.commands.filter((command) => command.endsWith(' || echo venv-check-crashed'))
}

// A python that passes the probe and then crashes inside the check gets the venv made again, once.
describe('stepRefreshDaemonVenv on a venv whose python crashes inside the check', () => {
  it('makes the venv again once and installs every wheel into it, without checking it again', async () => {
    const printer = await refreshedPrinter()
    printer.venvCheckCrashes = true

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.commands.filter((command) => command === VENV_REMAKE)).toHaveLength(1)
    expect(venvChecks(printer)).toHaveLength(1)
    expect(pipRuns(printer)).toEqual([`${FASTAPI_REINSTALL} '${NEWER_WHEEL}'`])
    expect(venvStates(printer)).toEqual(REFRESHED_VENV_WHOLE)
  })
})

// pip installs every other package, so a pip that still starts with its own files damaged is not trusted.
describe('stepRefreshDaemonVenv on a venv whose pip lost or changed a file', () => {
  it('makes the venv again and installs every wheel into it', async () => {
    const printer = await refreshedPrinter()
    markPackage(printer, PIP_DIST_INFO, 'damaged')

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expectVenvMadeAgainWhole(printer)
  })
})

// An earlier release kept the list of the wheels pip last installed in the venv. Nothing reads it now.
describe('the wheel list an earlier release kept in the venv', () => {
  const LEGACY_WHEEL_MARKER = `${BESPOK3D}/venv/.bespok3d-wheels`

  it('is removed by an update', async () => {
    const printer = await enrolledPrinter()
    printer.files.set(LEGACY_WHEEL_MARKER, Buffer.from('an old wheel list'))

    await stepDeployDaemon(printer.ssh, updateEnroll)

    expect(printer.files.has(LEGACY_WHEEL_MARKER)).toBe(false)
  })

  it('is removed by a venv refresh', async () => {
    const printer = await enrolledPrinter()
    printer.files.set(LEGACY_WHEEL_MARKER, Buffer.from('an old wheel list'))

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.files.has(LEGACY_WHEEL_MARKER)).toBe(false)
  })

  it('is removed by a venv refresh on a printer that holds no wheels', async () => {
    const printer = fakePrinter({ [LEGACY_WHEEL_MARKER]: 'an old wheel list' })

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(printer.files.has(LEGACY_WHEEL_MARKER)).toBe(false)
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
    expect(venvStates(printer)).toEqual({ ...REFRESHED_VENV_WHOLE, 'starlette-0.38.0.dist-info': 'intact' })
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

// 0.99.1 sorts after 0.115.0 as text, so only version order picks the right one.
const OLDER_FASTAPI_WHEEL = `${DAEMON_BASE}/wheels/fastapi-0.99.1-py3-none-any.whl`

async function printerWithOlderWheelBeside(): Promise<FakePrinter> {
  const printer = await refreshedPrinter()
  printer.files.set(OLDER_FASTAPI_WHEEL, Buffer.from('the fastapi an older daemon brought'))

  return printer
}

// An earlier release could leave the wheels of an older daemon beside the newer ones, and the printer
// keeps no list of which wheels its daemon brought, so the newest of each package is the one that counts.
describe('stepRefreshDaemonVenv on a printer holding two versions of one package', () => {
  it('keeps the venv as it is and removes the older wheel', async () => {
    const printer = await printerWithOlderWheelBeside()

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([])
    expect(printer.files.has(OLDER_FASTAPI_WHEEL)).toBe(false)
    expect(printer.files.has(FASTAPI_WHEEL)).toBe(true)
    expect(venvStates(printer)).toEqual(REFRESHED_VENV_WHOLE)
  })

  it('installs only the newest version into a venv that holds neither', async () => {
    const printer = await printerWithOlderWheelBeside()
    printer.venvPackages.delete(FASTAPI_DIST_INFO)

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expect(pipRuns(printer)).toEqual([FASTAPI_REINSTALL])
    expect(venvStates(printer)).toEqual(REFRESHED_VENV_WHOLE)
  })

  it('fills a venv made again with only the newest version', async () => {
    const printer = await printerWithOlderWheelBeside()
    printer.venvPythonBroken = true

    await stepRefreshDaemonVenv(printer.ssh, {} as EnrollContext)

    expectVenvMadeAgainWhole(printer)
    expect(printer.files.has(OLDER_FASTAPI_WHEEL)).toBe(false)
  })
})
