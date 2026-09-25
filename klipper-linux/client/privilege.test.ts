// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'

import type { EnrollContext, SshSession } from '@adapter-sdk'

// The one SDK function this module reaches for. The real loader drags electron's window machinery in
// behind it, which a shell-quoting helper has no business needing.
vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}))

import { asRoot, clearPrivilege } from './privilege'

const HOME = '/home/notapi'
const FAKE_PASSWORD = 'obviously-fake-password'
const PASSWORD_FILE = `${HOME}/.bespok3d-enroll/sudo-password`

const CTX = {
  credentials: { user: 'notapi', password: FAKE_PASSWORD, port: 22 },
} as EnrollContext

interface Printer {
  commands: string[]
  uploads: { path: string, content: string }[]
  ssh: SshSession
}

// A printer whose sudo behaves the way `sudoAnswers` says: 'free' is passwordless sudo, 'password'
// wants the account password on stdin, 'none' refuses either way.
function fakePrinter(sudoAnswers: 'free' | 'password' | 'none'): Printer {
  const commands: string[] = []
  const uploads: { path: string, content: string }[] = []
  const ssh = {
    host: '10.0.0.9',
    exec: async (command: string) => {
      commands.push(command)
      if (command.includes('echo "$HOME"')) return `${HOME}\n`
      if (command.startsWith('sudo -n ') && sudoAnswers !== 'free') throw new Error('sudo: a password is required')
      if (command.includes('sudo -S ') && sudoAnswers !== 'password') throw new Error('sudo: 1 incorrect password attempt')

      return ''
    },
    putContent: async (path: string, content: string) => { uploads.push({ path, content }) },
  } as unknown as SshSession

  return { commands, uploads, ssh }
}

function passwordCommands(printer: Printer): string[] {
  return printer.commands.filter((command) => command.includes('sudo -S '))
}

describe('asRoot on a printer with passwordless sudo', () => {
  it('runs the command with -n, so it can never hang on a prompt nobody is there to answer', async () => {
    const printer = fakePrinter('free')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    expect(printer.commands).toContain("sudo -n sh -c 'systemctl daemon-reload'")
  })

  it('writes no password anywhere, because none was needed', async () => {
    const printer = fakePrinter('free')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    expect(printer.uploads).toEqual([])
  })
})

// MainsailOS removes passwordless sudo at build time and Trixie never had it, so this is the ordinary
// path and not the exception.
describe('asRoot on a printer whose sudo wants the account password', () => {
  it('feeds the password in on stdin from a file it wrote over SFTP', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    expect(printer.uploads).toContainEqual({ path: PASSWORD_FILE, content: `${FAKE_PASSWORD}\n` })
    expect(passwordCommands(printer).at(-1)).toContain(`sudo -S -k -p '' sh -c 'systemctl daemon-reload' < '${PASSWORD_FILE}'`)
  })

  it('never puts the password on a command line, where every other account could read it', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    expect(printer.commands.join('\n')).not.toContain(FAKE_PASSWORD)
  })

  it('gives the file and its directory their private modes before the password is uploaded', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    const prepared = printer.commands.indexOf(
      `mkdir -p '${HOME}/.bespok3d-enroll' && chmod 700 '${HOME}/.bespok3d-enroll' && install -m 600 /dev/null '${PASSWORD_FILE}'`
    )
    expect(prepared).toBeGreaterThanOrEqual(0)
    expect(printer.uploads[0]?.path).toBe(PASSWORD_FILE)
  })

  it('removes the file in the same command that read it, whatever sudo answered', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')

    passwordCommands(printer).forEach((command) => {
      expect(command).toMatch(/^sudo -S -k -p '' sh -c /)
      expect(command).toContain(`; rm -f '${PASSWORD_FILE}'; exit $status`)
    })
  })

  it('settles the mode once per session, and writes the password again for every command', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'systemctl daemon-reload')
    await asRoot(printer.ssh, CTX, 'systemctl enable bespok3d')

    expect(printer.commands.filter((command) => command === 'sudo -n true')).toHaveLength(1)
    // One upload for the probe, then one per command: the file never outlives the command it fed.
    expect(printer.uploads).toHaveLength(3)
  })
})

describe('asRoot on a printer where neither way works', () => {
  it('says what Bespok3d needs and that sudo would not take the SSH password', async () => {
    const printer = fakePrinter('none')

    await expect(asRoot(printer.ssh, CTX, 'systemctl daemon-reload')).rejects.toThrow(
      /Bespok3d needs sudo on this printer[\s\S]*was not accepted by sudo/
    )
  })

  it('leaves no password directory behind after the refusal', async () => {
    const printer = fakePrinter('none')

    await asRoot(printer.ssh, CTX, 'true').catch(() => undefined)

    expect(printer.commands).toContain(`rm -rf '${HOME}/.bespok3d-enroll'`)
  })
})

describe('clearPrivilege', () => {
  it('takes the password directory back off the printer when the operation is over', async () => {
    const printer = fakePrinter('password')

    await asRoot(printer.ssh, CTX, 'true')
    await clearPrivilege(printer.ssh)

    expect(printer.commands).toContain(`rm -rf '${HOME}/.bespok3d-enroll'`)
  })
})
