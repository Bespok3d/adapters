// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EnrollContext, SshSession } from '@adapter-sdk'

// The two facts every other step on this printer is built out of, and the one-line question that
// answers whether a command worked.
//
// The U1 knows where everything lives because it is always root on the same firmware. Here the whole
// tree hangs off the login user's home directory, and that account is whatever its owner called it,
// so the home directory is read off the printer once per session and remembered: asking again for
// every path would put an SSH round trip in front of every command.

const HOMES = new WeakMap<SshSession, Promise<string>>()

export function remoteHome(ssh: SshSession): Promise<string> {
  const known = HOMES.get(ssh)
  if (known) return known
  const asking = ssh.exec('echo "$HOME"').then(
    (answer) => answer.trim(),
    (unreachable) => {
      // Forgotten rather than remembered as a failure, so a retry of the step asks again.
      HOMES.delete(ssh)
      throw unreachable
    }
  )
  HOMES.set(ssh, asking)

  return asking
}

// Bespok3d runs as the account the app logged in with: no service user is created, nothing is
// chowned, and every file it writes is already owned by the person who owns the printer.
export function runtimeUser(ctx: EnrollContext): string {
  return ctx.credentials.user
}

// Did this command exit zero? A probe, not an action: the caller is choosing between paths, so a
// non-zero exit is an answer rather than a failure to report.
export async function succeeds(ssh: SshSession, command: string): Promise<boolean> {
  try {
    await ssh.exec(command)

    return true
  } catch {
    return false
  }
}

// The message a failing command wrote, or null when it worked. The SSH transport rejects with the
// command's own stderr, which is the text worth showing a user when pip or nginx refuses.
export async function failureOf(ssh: SshSession, command: string): Promise<string | null> {
  try {
    await ssh.exec(command)

    return null
  } catch (refused) {
    return refused instanceof Error ? refused.message : String(refused)
  }
}
