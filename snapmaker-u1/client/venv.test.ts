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
vi.mock('@adapter-sdk', async () => await import('./fake-sdk'))

import { ensureVenv, syncVenvDeps } from './venv'
import { BESPOK3D, DAEMON_BASE } from './paths'

type RecordedEnroll = { commands: string[], uploads: string[], ssh: SshSession }

// A printer that answers the venv check with the lines given and every other command with nothing.
function recordingSession(venvCheckAnswer: string): RecordedEnroll {
  const commands: string[] = []
  const uploads: string[] = []
  const ssh = {
    exec: async (command: string) => {
      commands.push(command)

      return command.includes(' -I -c ') ? venvCheckAnswer : ''
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
const REMOTE_PAYLOAD_WHEELS = PAYLOAD_WHEELS.map((wheelPath) => `${DAEMON_BASE}/${wheelPath}`)
const FASTAPI_FINGERPRINT = 'a'.repeat(64)
const PIP_IN_PLACE = `installed\tintact\t${'c'.repeat(64)}\t${BESPOK3D}/venv/lib/python3.11/site-packages/pip-24.0.dist-info`
const PIP_DAMAGED = PIP_IN_PLACE.replace('\tintact\t', '\tdamaged\t')
const VENV_REMAKE = `rm -rf ${BESPOK3D}/venv && python3 -m venv ${BESPOK3D}/venv`
const FASTAPI_IN_PLACE = [
  PIP_IN_PLACE,
  `installed\tintact\t${FASTAPI_FINGERPRINT}\t${BESPOK3D}/venv/lib/python3.11/site-packages/fastapi-0.115.0.dist-info`,
  `wheel\t${FASTAPI_FINGERPRINT}\t${DAEMON_BASE}/${PAYLOAD_WHEELS[0]}`,
  `wheel\t${'b'.repeat(64)}\t${DAEMON_BASE}/${PAYLOAD_WHEELS[1]}`,
].join('\n')

function installCommandOf(commands: readonly string[]): string {
  const installCommand = commands.find((command) => command.includes('pip install'))
  expect(installCommand, 'the daemon packages must be installed').toBeTruthy()

  return installCommand!
}

function quotedArgumentsOf(command: string): string[] {
  return [...command.matchAll(/'([^']+)'/g)].map((match) => match[1])
}

describe('syncVenvDeps', () => {
  // pgpy was dropped from the daemon when on-printer PGP was suspended, and the wheel directory it was
  // read from no longer exists. Uploading a wheel here again would fail every enrollment on a machine
  // that has only the released daemon.
  it('uploads no wheel to the printer: the verified package already put them there', async () => {
    const enroll = recordingSession(PIP_IN_PLACE)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    expect(enroll.uploads).toEqual([])
    expect(enroll.commands.join('\n')).not.toContain('pgpy')
  })

  it('checks the venv against every wheel the payload declares, on the printer', async () => {
    const enroll = recordingSession(PIP_IN_PLACE)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    const checkCommand = enroll.commands.find((command) => command.includes(' -I -c '))
    expect(quotedArgumentsOf(checkCommand ?? '').slice(2)).toEqual(REMOTE_PAYLOAD_WHEELS)
  })

  it('installs only the wheels whose package the venv does not hold whole', async () => {
    const enroll = recordingSession(FASTAPI_IN_PLACE)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    expect(quotedArgumentsOf(installCommandOf(enroll.commands))).toEqual([`${DAEMON_BASE}/${PAYLOAD_WHEELS[1]}`])
  })

  // The offline contract, pinned: pip is handed FILES with its index and its resolver switched off. A
  // bare package name or a --find-links puts the resolver back on the network, which is the whole bug
  // this stage exists to kill, so anything but the exact flag set fails here.
  it('installs from files with pip off the network', async () => {
    const enroll = recordingSession(PIP_IN_PLACE)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    const installCommand = installCommandOf(enroll.commands)
    expect(quotedArgumentsOf(installCommand)).toEqual(REMOTE_PAYLOAD_WHEELS)
    expect(installCommand.replace(/'[^']+'/g, '').trim()).toBe(`${BESPOK3D}/venv/bin/pip install --no-index --no-deps --force-reinstall`)
  })

  it('runs nothing at all when the package declares no wheels', async () => {
    const enroll = recordingSession('')

    await syncVenvDeps(enroll.ssh, silentEnroll, [])

    expect(enroll.commands).toEqual([])
  })
})

describe('syncVenvDeps on a venv it cannot trust', () => {
  it('keeps a venv whose pip is whole', async () => {
    const enroll = recordingSession(PIP_IN_PLACE)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    expect(enroll.commands).not.toContain(VENV_REMAKE)
  })

  // The shell answers for a python that crashed, after whatever lines it wrote before the crash.
  it.each([
    ['the check crashes before writing a line', 'venv-check-crashed\n'],
    ['the check crashes part way', `${PIP_IN_PLACE}\nvenv-check-crashed\n`],
    ['the venv pip lost or changed a file', PIP_DAMAGED],
    ['the venv holds no record of pip', ''],
  ])('makes the venv again once and installs every wheel, unchecked, when %s', async (_venvFault, venvCheckAnswer) => {
    const enroll = recordingSession(venvCheckAnswer)

    await syncVenvDeps(enroll.ssh, silentEnroll, PAYLOAD_WHEELS)

    expect(enroll.commands.filter((command) => command.endsWith(' || echo venv-check-crashed'))).toHaveLength(1)
    expect(enroll.commands.filter((command) => command === VENV_REMAKE)).toHaveLength(1)
    expect(quotedArgumentsOf(installCommandOf(enroll.commands))).toEqual(REMOTE_PAYLOAD_WHEELS)
  })
})

describe('ensureVenv', () => {
  function probedSession(probeAnswer: string): { ssh: SshSession, commands: string[] } {
    const commands: string[] = []
    const ssh = {
      exec: async (command: string) => {
        commands.push(command)

        return command.endsWith(' && echo yes || echo no') ? probeAnswer : ''
      },
    } as unknown as SshSession

    return { ssh, commands }
  }

  it('asks the venv python to run as the venv, and the venv pip to run', async () => {
    const probedPrinter = probedSession('yes')

    await ensureVenv(probedPrinter.ssh, silentEnroll)

    expect(probedPrinter.commands).toEqual([
      `rm -f ${BESPOK3D}/venv/.bespok3d-wheels`,
      `${BESPOK3D}/venv/bin/python3 -I -c 'import sys; sys.exit(sys.prefix == sys.base_prefix)' 2>/dev/null && ` +
      `${BESPOK3D}/venv/bin/pip --version >/dev/null 2>&1 && echo yes || echo no`,
    ])
  })

  // A venv whose python is a link to nowhere still has the file, so only running it tells.
  it('makes the venv again from nothing when the probe finds it does not run', async () => {
    const probedPrinter = probedSession('no')

    await ensureVenv(probedPrinter.ssh, silentEnroll)

    expect(probedPrinter.commands).toContain(VENV_REMAKE)
  })

  it('removes the wheel list an earlier release kept in the venv', async () => {
    const probedPrinter = probedSession('yes')

    await ensureVenv(probedPrinter.ssh, silentEnroll)

    expect(probedPrinter.commands).toContain(`rm -f ${BESPOK3D}/venv/.bespok3d-wheels`)
  })
})
