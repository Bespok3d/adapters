// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { remoteHome, succeeds } from './remote'

// The only door to root on this printer, and it is open for the length of one command and no longer.
//
// MainsailOS deliberately removes passwordless sudo at build time and Trixie never had it, so `sudo`
// here asks for the account password, which is the SSH password the user already gave the app. A
// password cannot go on a command line (it would be visible in the process list to anyone else on the
// box and would land in shell history), so for each privileged command it is written to a file only
// this account can read, fed to `sudo -S` on stdin, and removed again by that same command whatever
// sudo answered. The file is created empty with mode 600 in a directory of mode 700 before a byte of
// the password reaches it, so it is never readable by another account, and it exists only between
// one upload and the command that consumes it: a connection lost in that gap leaves it behind until
// the next operation's probe or tidy-up removes it, and nothing else on the printer can read it.
//
// The host that does have passwordless sudo skips all of that, which is what the first probe is for.

const PRIVILEGE_DIR = '.bespok3d-enroll'
const PASSWORD_FILE = 'sudo-password'

type SudoMode = 'passwordless' | 'password'

const MODES = new WeakMap<SshSession, Promise<SudoMode>>()

function privilegeDir(home: string): string {
  return `${home}/${PRIVILEGE_DIR}`
}

function passwordFile(home: string): string {
  return `${privilegeDir(home)}/${PASSWORD_FILE}`
}

// `-n` never waits on a prompt, so a host without passwordless sudo answers immediately instead of
// hanging the enrolment on a question nobody is there to read. `-k` on the password form ignores any
// cached timestamp, so the file is what authenticates and the result is the same every time. The
// file is removed in the same command, after sudo has read it, and the command's own exit status is
// what comes back.
function rootCommand(mode: SudoMode, command: string, home: string): string {
  if (mode === 'passwordless') return `sudo -n sh -c ${shellQuote(command)}`
  const file = shellQuote(passwordFile(home))

  return `sudo -S -k -p '' sh -c ${shellQuote(command)} < ${file}; status=$?; rm -f ${file}; exit $status`
}

// The directory and the empty file get their modes before the password is uploaded into the file,
// so there is no moment at which another account could read it. The upload goes over SFTP, never
// through a command: the password must not exist as an argument anywhere.
async function writePasswordFile(ssh: SshSession, ctx: EnrollContext, home: string): Promise<void> {
  const directory = shellQuote(privilegeDir(home))
  await ssh.exec(`mkdir -p ${directory} && chmod 700 ${directory} && install -m 600 /dev/null ${shellQuote(passwordFile(home))}`)
  await ssh.putContent(passwordFile(home), `${ctx.credentials.password}\n`)
}

async function runAsRoot(ssh: SshSession, ctx: EnrollContext, mode: SudoMode, command: string, home: string): Promise<string> {
  if (mode === 'password') await writePasswordFile(ssh, ctx, home)

  return ssh.exec(rootCommand(mode, command, home))
}

async function passwordAccepted(ssh: SshSession, ctx: EnrollContext, home: string): Promise<boolean> {
  try {
    await runAsRoot(ssh, ctx, 'password', 'true', home)

    return true
  } catch {
    return false
  }
}

async function establish(ssh: SshSession, ctx: EnrollContext, home: string): Promise<SudoMode> {
  if (await succeeds(ssh, 'sudo -n true')) return 'passwordless'
  if (await passwordAccepted(ssh, ctx, home)) return 'password'
  await clearPrivilege(ssh)

  throw new Error(
    'Bespok3d needs sudo on this printer to register its services, and the SSH password was not accepted by sudo. Check that this account may run sudo and that the password you entered is its login password, then enroll again.'
  )
}

function sudoMode(ssh: SshSession, ctx: EnrollContext, home: string): Promise<SudoMode> {
  const known = MODES.get(ssh)
  if (known) return known
  const establishing = establish(ssh, ctx, home).catch((refused) => {
    // Forgotten rather than remembered as a failure, so retrying the step probes again.
    MODES.delete(ssh)
    throw refused
  })
  MODES.set(ssh, establishing)

  return establishing
}

// Run one command as root. The mode is settled once per SSH session, so the probe costs one round
// trip for an entire enrolment; the password itself travels once per privileged command.
export async function asRoot(ssh: SshSession, ctx: EnrollContext, command: string): Promise<string> {
  const home = await remoteHome(ssh)

  return runAsRoot(ssh, ctx, await sudoMode(ssh, ctx, home), command, home)
}

// The end of every operation that needed root: the directory the password passed through leaves the
// printer with it. Each command already removed its own file, so this is the belt to that braces,
// and best effort, because failing to tidy up must not fail an operation that otherwise worked.
export async function clearPrivilege(ssh: SshSession): Promise<void> {
  MODES.delete(ssh)
  const home = await remoteHome(ssh)
  await succeeds(ssh, `rm -rf ${shellQuote(privilegeDir(home))}`)
}
