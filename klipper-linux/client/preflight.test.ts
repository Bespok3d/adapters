// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'

import type { EnrollContext, SshSession } from '@adapter-sdk'

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}))

// The print-state read is a real HTTP call to the printer, which a unit test has no business making.
const printer = vi.hoisted(() => ({ busy: false }))
vi.mock('./print-state', () => ({ printerIsPrinting: async () => printer.busy }))

import { stepPreflight } from './preflight'

const CTX = {
  credentials: { user: 'notapi', password: 'obviously-fake-password', port: 22 },
} as EnrollContext

// A printer that would pass every check, by the substring of the command that asks each question.
const HEALTHY: Record<string, string> = {
  'echo "$HOME"': '/home/notapi\n',
  'uname -m': 'aarch64\n',
  'command -v systemctl': '/usr/bin/systemctl\n',
  'list-unit-files': '2\n',
  'sys.version_info': 'True\n',
}

function fakeSsh(answers: Record<string, string>): SshSession {
  const replies = { ...HEALTHY, ...answers }

  return {
    host: '10.0.0.9',
    exec: async (command: string) => {
      const asked = Object.keys(replies).find((question) => command.includes(question))

      return asked ? replies[asked] : ''
    },
  } as unknown as SshSession
}

describe('preflight refusals, before a single file is written', () => {
  it('refuses a 32-bit host, naming the 64-bit system it needs', async () => {
    await expect(stepPreflight(fakeSsh({ 'uname -m': 'armv7l\n' }), CTX)).rejects.toThrow(
      /64-bit system on the printer.*armv7l/
    )
  })

  it('refuses a host without systemd, naming what it should run instead', async () => {
    await expect(stepPreflight(fakeSsh({ 'command -v systemctl': '\n' }), CTX)).rejects.toThrow(
      /does not run systemd/
    )
  })

  it('refuses a host that is not a finished Klipper printer yet', async () => {
    await expect(stepPreflight(fakeSsh({ 'list-unit-files': '1\n' }), CTX)).rejects.toThrow(
      /klipper and a moonraker service/
    )
  })

  it('refuses a Python older than the daemon can run on', async () => {
    await expect(stepPreflight(fakeSsh({ 'sys.version_info': 'False\n' }), CTX)).rejects.toThrow(
      /Python 3.11 or newer/
    )
  })

  it('refuses a printer that is mid-print, because enrolling restarts Klipper', async () => {
    printer.busy = true
    await expect(stepPreflight(fakeSsh({}), CTX)).rejects.toThrow(/printing or paused/)
    printer.busy = false
  })

  it('refuses a printer whose sudo takes neither the probe nor the password', async () => {
    const refusing = {
      host: '10.0.0.9',
      exec: async (command: string) => {
        // The password form is `chmod 600 <file> && sudo -S ...`, so the refusal keys on sudo anywhere.
        if (command.includes('sudo -')) throw new Error('sudo: a password is required')
        const asked = Object.keys(HEALTHY).find((question) => command.includes(question))

        return asked ? HEALTHY[asked] : ''
      },
      putContent: async () => undefined,
    } as unknown as SshSession

    await expect(stepPreflight(refusing, CTX)).rejects.toThrow(/Bespok3d needs sudo on this printer/)
  })
})

describe('preflight on a printer that is ready', () => {
  it('lets the enrolment through', async () => {
    printer.busy = false

    await expect(stepPreflight(fakeSsh({}), CTX)).resolves.toBeUndefined()
  })
})
