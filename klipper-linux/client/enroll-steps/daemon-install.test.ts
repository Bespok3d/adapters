// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

import type { BundledPackage, EnrollContext, SshSession } from '@adapter-sdk'

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

import { ADAPTER_JINNI_PACKAGE, DAEMON_PACKAGE } from '../packages'
import { daemonRuntimePaths, stepDeployDaemon } from './daemon-install'

const HOME = '/home/notapi'
const DAEMON_BASE = `${HOME}/bespok3d/var/lib/daemon`

const DAEMON_PAYLOAD = [
  'daemon.py',
  'version.py',
  'api/routes.py',
  'requirements.txt',
  'wheels/fastapi-0.115.0-py3-none-any.whl',
  's10bespok3d-daemon',
  'S99bespok3d',
]

const JINNI_PAYLOAD = ['bespok3d_jinni.py', 'layout_discovery.py', 'jinni/board.py', 'bespok3d.service']

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
  const payloads: Record<string, readonly string[]> = {
    [DAEMON_PACKAGE]: DAEMON_PAYLOAD,
    [ADAPTER_JINNI_PACKAGE]: JINNI_PAYLOAD,
  }
  openedPackages.open = async (packageName: string) => {
    if (!payloads[packageName]) throw new Error(`unexpected package ${packageName}`)

    return fakePackage(packageName, payloads[packageName])
  }
}

type RecordedEnroll = { commands: string[], uploads: { remotePath: string, content: string }[], ssh: SshSession }

function recordingSession(): RecordedEnroll {
  const commands: string[] = []
  const uploads: { remotePath: string, content: string }[] = []
  const ssh = {
    host: '10.0.0.9',
    exec: async (command: string) => {
      commands.push(command)

      return command.includes('echo "$HOME"') ? `${HOME}\n` : ''
    },
    putBytes: async (remotePath: string, content: Buffer) => {
      uploads.push({ remotePath, content: content.toString('utf-8') })
    },
  } as unknown as SshSession

  return { commands, uploads, ssh }
}

const silentEnroll = {} as EnrollContext

// The U1's two boot scripts travel in the daemon package and mean nothing on a systemd host, where
// the equivalents are rendered from the jinni package instead. Uploading them would leave a script on
// the printer that nothing runs and that contradicts the unit that does.
describe('the daemon payload this adapter puts on a systemd host', () => {
  it('drops both of the U1 boot scripts and keeps everything else', () => {
    const kept = daemonRuntimePaths(fakePackage(DAEMON_PACKAGE, DAEMON_PAYLOAD))

    expect(kept).not.toContain('S99bespok3d')
    expect(kept).not.toContain('s10bespok3d-daemon')
    expect(kept).toContain('daemon.py')
    expect(kept).toContain('requirements.txt')
  })
})

describe('stepDeployDaemon', () => {
  it('leaves the printer untouched when the package is refused', async () => {
    openedPackages.open = async () => { throw new Error('the signature on the package does not check out') }
    const enroll = recordingSession()

    await expect(stepDeployDaemon(enroll.ssh, silentEnroll)).rejects.toThrow('does not check out')

    expect(enroll.uploads).toEqual([])
    expect(enroll.commands).toEqual([])
  })

  it('uploads the daemon under the login account home, and neither U1 boot script anywhere', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    const fromDaemon = enroll.uploads.filter((upload) => upload.content.startsWith(`from ${DAEMON_PACKAGE}:`))
    expect(fromDaemon.map((upload) => upload.remotePath)).toEqual([
      `${DAEMON_BASE}/daemon.py`,
      `${DAEMON_BASE}/version.py`,
      `${DAEMON_BASE}/api/routes.py`,
      `${DAEMON_BASE}/requirements.txt`,
      `${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl`,
    ])
    expect(enroll.uploads.some((upload) => upload.remotePath.includes('bespok3d-daemon'))).toBe(false)
  })

  it('uploads the jinni from the jinni package alone, beside the daemon', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    const fromJinni = enroll.uploads.filter((upload) => upload.content.startsWith(`from ${ADAPTER_JINNI_PACKAGE}:`))
    expect(fromJinni.map((upload) => upload.remotePath)).toEqual(JINNI_PAYLOAD.map((path) => `${DAEMON_BASE}/${path}`))
    expect(enroll.uploads.every((upload) => upload.content.startsWith('from '))).toBe(true)
  })

  // The offline contract, pinned: pip is handed FILES with its index and its resolver switched off, so
  // a printer with no route out installs exactly like one with one.
  it('installs the wheels offline, from files already on the printer', async () => {
    stubBundledPackages()
    const enroll = recordingSession()

    await stepDeployDaemon(enroll.ssh, silentEnroll)

    expect(enroll.commands).toContain(
      `'${HOME}/bespok3d/venv/bin/pip' install --no-index --no-deps '${DAEMON_BASE}/wheels/fastapi-0.115.0-py3-none-any.whl'`
    )
  })
})
