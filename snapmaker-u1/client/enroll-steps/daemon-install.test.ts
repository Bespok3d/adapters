// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { BundledPackage, SshSession, EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../../Bespok3d-desktop', import.meta.url)) },
}))

const openedPackages = vi.hoisted(() => ({ open: (async () => { throw new Error('no package stubbed') }) as (packageName: string) => Promise<BundledPackage> }))

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
  openBundledPackage: (packageName: string) => openedPackages.open(packageName),
}))

import { stepDeployDaemon } from './daemon-install'
import { DAEMON_PACKAGE, ADAPTER_JINNI_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'

const DAEMON_PAYLOAD = [
  'daemon.py',
  'version.py',
  'api/routes.py',
  'core/state.py',
  'wheels/fastapi-0.115.0-py3-none-any.whl',
  's10bespok3d-daemon',
  'S99bespok3d',
]

const JINNI_PAYLOAD = ['bespok3d_jinni.py', 'jinni/board.py', 'paths.json', 'version.json']

// The marker proves provenance: an upload carrying it can only have come from the package member, so a
// second copy read off a source tree would fail these tests rather than pass them silently.
function fakePackage(packageName: string, payloadPaths: readonly string[]): BundledPackage {
  return {
    name: packageName,
    version: '0.0.0',
    trust: 'unknown',
    payloadPaths,
    payloadBytes: (payloadPath: string) => Buffer.from(`from ${packageName}: ${payloadPath}`),
  }
}

function stubBundledPackages(): void {
  openedPackages.open = async (packageName: string) => {
    if (packageName === DAEMON_PACKAGE) return fakePackage(DAEMON_PACKAGE, DAEMON_PAYLOAD)
    if (packageName === ADAPTER_JINNI_PACKAGE) return fakePackage(ADAPTER_JINNI_PACKAGE, JINNI_PAYLOAD)
    throw new Error(`unexpected package ${packageName}`)
  }
}

type RecordedUpload = { remotePath: string, content: string }
type RecordedEnroll = { commands: string[], uploads: RecordedUpload[], ssh: SshSession }

function recordingSession(): RecordedEnroll {
  const commands: string[] = []
  const uploads: RecordedUpload[] = []
  const ssh = {
    exec: async (command: string) => {
      commands.push(command)

      return ''
    },
    putBytes: async (remotePath: string, content: Buffer) => {
      uploads.push({ remotePath, content: content.toString('utf-8') })
    },
  } as unknown as SshSession

  return { commands, uploads, ssh }
}

const silentEnroll = {} as EnrollContext

function removedPaths(commands: readonly string[]): string[] {
  return commands
    .filter((command) => command.startsWith('rm -rf '))
    .flatMap((command) => command.slice('rm -rf '.length).split(' '))
    .map((removed) => removed.replace(/^'|'$/g, ''))
}

describe('stepDeployDaemon', () => {
  // The whole point of the stage: a package whose signature does not check out must not put a byte on
  // the printer. Not "the error was raised": that nothing was uploaded and no command was run.
  it('leaves the printer untouched when the package is refused', async () => {
    openedPackages.open = async () => {
      throw new Error('the signature on the package for "bespok3d-daemon" does not check out')
    }
    const enroll = recordingSession()

    await expect(stepDeployDaemon(enroll.ssh, silentEnroll)).rejects.toThrow('does not check out')

    expect(enroll.uploads).toEqual([])
    expect(enroll.commands).toEqual([])
  })

  it('uploads the daemon runtime from the package, and the init scripts nowhere near the runtime tree', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    const daemonUploads = enroll.uploads.filter((upload) => upload.content.startsWith(`from ${DAEMON_PACKAGE}:`))
    expect(daemonUploads.map((upload) => upload.remotePath)).toEqual([
      `${DAEMON_BASE}/daemon.py`,
      `${DAEMON_BASE}/version.py`,
      `${DAEMON_BASE}/api/routes.py`,
      `${DAEMON_BASE}/core/state.py`,
      `${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl`,
      `${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`,
    ])
    expect(enroll.uploads.some((upload) => upload.remotePath.includes('S99bespok3d'))).toBe(false)
  })

  // ADR-0037: the jinni is its own signed package, and the files placed on the printer are its payload,
  // never a copy read out of the adapter checkout the app was built from.
  it('uploads the jinni from the jinni package alone', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    const jinniUploads = enroll.uploads.filter((upload) => upload.content.startsWith(`from ${ADAPTER_JINNI_PACKAGE}:`))
    expect(jinniUploads.map((upload) => upload.remotePath)).toEqual(JINNI_PAYLOAD.map((payloadPath) => `${DAEMON_BASE}/${payloadPath}`))
    expect(enroll.uploads.every((upload) => upload.content.startsWith('from '))).toBe(true)
  })

})

// The step is minutes long and uploads over a hundred files. A bar that cannot move while the file
// count beside it climbs reads as a hung app, so every phase that knows its own size reports how far
// through it is, and each phase owns a slice of the bar so the reported number only ever climbs.
describe('stepDeployDaemon progress', () => {
  function reportedFractions(reports: [string, number | undefined][], label: string): number[] {
    return reports.filter(([hint]) => hint.startsWith(label)).map(([, fraction]) => fraction ?? -1)
  }

  it('advances a file at a time through each upload and never reports backwards', async () => {
    stubBundledPackages()
    const enroll = recordingSession()
    const reports: [string, number | undefined][] = []
    const watchedEnroll = { onProgress: (hint: string, stepFraction?: number) => { reports.push([hint, stepFraction]) } } as EnrollContext

    await stepDeployDaemon(enroll.ssh, watchedEnroll)

    const daemonFractions = reportedFractions(reports, 'Uploading daemon files…')
    const jinniFractions = reportedFractions(reports, 'Uploading jinni…')
    expect(daemonFractions).toHaveLength(5)
    expect(jinniFractions).toHaveLength(JINNI_PAYLOAD.length)
    expect(daemonFractions[daemonFractions.length - 1]).toBeCloseTo(0.75)
    expect(jinniFractions[jinniFractions.length - 1]).toBeCloseTo(0.88)
    const allFractions = reports.map(([, fraction]) => fraction).filter((fraction) => fraction !== undefined)
    expect(allFractions).toEqual([...allFractions].sort((earlier, later) => earlier - later))
  })
})

describe('stepDeployDaemon over an already enrolled printer', () => {
  // Installing over an existing tree clears what the two packages own and nothing else, so a printer
  // that is already enrolled keeps its certificate, its token, its daemon data and its installed
  // plugins through a reinstall.
  it("preserves the printer's own files when it installs over an existing tree", async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    expect(removedPaths(enroll.commands).sort()).toEqual([
      `${BESPOK3D}/var/lib/demon`,
      `${DAEMON_BASE}/api`,
      `${DAEMON_BASE}/bespok3d_jinni.py`,
      `${DAEMON_BASE}/core`,
      `${DAEMON_BASE}/daemon.py`,
      `${DAEMON_BASE}/jinni`,
      `${DAEMON_BASE}/paths.json`,
      `${DAEMON_BASE}/version.json`,
      `${DAEMON_BASE}/version.py`,
      `${DAEMON_BASE}/wheels`,
    ].sort())
    const preserved = [`${BESPOK3D}/etc`, `${BESPOK3D}/var/lib/plugins`, `${DAEMON_BASE}/data`, DAEMON_BASE, BESPOK3D]
    preserved.forEach((printerOwnedPath) => expect(removedPaths(enroll.commands)).not.toContain(printerOwnedPath))
  })

  it('installs the wheels the package carries, offline, from files already on the printer', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    const installCommand = enroll.commands.find((command) => command.includes('pip install'))
    expect(installCommand).toBe(
      `${BESPOK3D}/venv/bin/pip install --no-index --no-deps '${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl'`,
    )
  })
})
