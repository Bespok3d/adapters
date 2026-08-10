// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { SshSession, EnrollContext } from '@adapter-sdk'

// paths.ts reads the adapter's paths.json through electron's app path at module load, exactly as the
// existing client test does.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

// The SDK surface this module reaches for, and nothing else: the real loader drags electron's window
// machinery in behind it, which a shell-quoting helper has no business needing.
vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
}))

import { installVenvDeps } from './venv'
import { BESPOK3D, DAEMON_BASE } from './paths'

type RecordedEnroll = { commands: string[], uploads: string[], ssh: SshSession }

function recordingSession(importProbeAnswer: string): RecordedEnroll {
  const commands: string[] = []
  const uploads: string[] = []
  const ssh = {
    exec: async (command: string) => {
      commands.push(command)

      return command.includes('-c "import ') ? importProbeAnswer : ''
    },
    putBytes: async (remotePath: string) => {
      uploads.push(remotePath)
    },
  } as unknown as SshSession

  return { commands, uploads, ssh }
}

const silentEnroll = {} as EnrollContext

const PAYLOAD_WHEELS = [
  'wheels/fastapi-0.115.0-py3-none-any.whl',
  'wheels/starlette-0.38.0-py3-none-any.whl',
]

function installCommandOf(commands: readonly string[]): string {
  const installCommand = commands.find((command) => command.includes('pip install'))
  expect(installCommand, 'the daemon packages must be installed').toBeTruthy()

  return installCommand!
}

describe('installVenvDeps', () => {
  // pgpy was dropped from the daemon when on-printer PGP was suspended, and the wheel directory it was
  // read from no longer exists. Uploading a wheel here again would fail every enrollment on a machine
  // that has only the released daemon.
  it('uploads no wheel to the printer: the verified package already put them there', async () => {
    const enroll = recordingSession('missing')

    await installVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    expect(enroll.uploads).toEqual([])
    expect(enroll.commands.join('\n')).not.toContain('pgpy')
  })

  // A printer enrolled by an older app already imports fastapi, uvicorn and multipart, and is missing
  // whatever the newer daemon added. An import probe cannot see that, so there is no probe: every wheel
  // the payload declares is installed on every enrollment.
  it('installs every wheel the payload declares on a venv that already has the original packages', async () => {
    const enroll = recordingSession('ok')

    await installVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    const installCommand = installCommandOf(enroll.commands)
    PAYLOAD_WHEELS.forEach((wheelPath) => expect(installCommand).toContain(`${DAEMON_BASE}/${wheelPath}`))
    expect(enroll.commands.filter((command) => command.includes('-c "import '))).toEqual([])
  })

  // The offline contract, pinned: pip is handed FILES with its index and its resolver switched off. A
  // bare package name or a --find-links puts the resolver back on the network, which is the whole bug
  // this stage exists to kill, so anything but the exact flag set fails here.
  it('installs from files with pip off the network', async () => {
    const enroll = recordingSession('missing')

    await installVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    const installCommand = installCommandOf(enroll.commands)
    const quotedArguments = [...installCommand.matchAll(/'([^']+)'/g)].map((match) => match[1])
    expect(quotedArguments).toEqual(PAYLOAD_WHEELS.map((wheelPath) => `${DAEMON_BASE}/${wheelPath}`))
    expect(installCommand.replace(/'[^']+'/g, '').trim()).toBe(`${BESPOK3D}/venv/bin/pip install --no-index --no-deps`)
  })

  it('runs no install at all when the package declares no wheels', async () => {
    const enroll = recordingSession('missing')

    await installVenvDeps(enroll.ssh, silentEnroll, [])

    expect(enroll.commands).toEqual([])
  })
})
