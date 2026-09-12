// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { grantedAcl, readAcl } from '../acl'
import { bespok3dRoot } from '../paths'
import { remoteHome } from '../remote'

// Binding this computer to this printer. The printer generates its own TLS certificate and the app
// records it, so from here on the app talks to a printer it can recognise; the app's identity goes
// into the printer's access list, so the printer only answers computers their owner let in.
//
// Both files are written by the login user into that user's own tree, so neither needs root. The
// certificate's private half and the access list (it holds the bearer token) are readable by that
// account alone: the workspace is world readable so Klipper and Moonraker can read what plugins put in
// it, and on MainsailOS the web server's account can see into this home directory too.

export async function stepGenerateDaemonCert(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const root = bespok3dRoot(await remoteHome(ssh))
  const certificate = `${root}/etc/daemon/server.crt`
  const present = await ssh.exec(`test -f ${shellQuote(certificate)} && echo yes || echo no`)
  if (present.trim() === 'yes') {
    ctx.daemonCert = await ssh.getContent(certificate)

    return
  }
  const key = shellQuote(`${root}/etc/daemon/server.key`)
  await ssh.exec(
    // The umask keeps the key private from the moment openssl creates it, not from a chmod after.
    `umask 077 && openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout ${key}` +
    ` -out ${shellQuote(certificate)} -sha256 -days 3650 -nodes -subj '/CN=bespok3d-daemon' 2>&1` +
    ` && chmod 600 ${key} && chmod 644 ${shellQuote(certificate)}`
  )
  ctx.daemonCert = await ssh.getContent(certificate)
}

// Read-modify-write so re-enrolling this computer (or a multi-client ACL) is never clobbered: the
// enroller is admin only when it is the first key in, and a computer that is already in keeps the
// role it has, so re-enrolling the printer's one admin does not demote it. A second computer never
// runs this; it uses the access-request flow.
export async function stepEnrollDaemonKey(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const root = bespok3dRoot(await remoteHome(ssh))
  const authDir = shellQuote(`${root}/auth`)
  await ssh.exec(`mkdir -p ${authDir} && chmod 700 ${authDir}`)
  const existing = await readAcl(ssh, root)
  const identity = ctx.clientFingerprint || ctx.clientId || ''
  const token = ctx.daemonToken || ''
  const role = existing.roles[identity] ?? (existing.keys.length === 0 ? 'admin' : 'user')
  const next = identity
    ? grantedAcl(existing, identity, token, role, ctx.clientLabel || '')
    : { ...existing, tokens: token && !existing.tokens.includes(token) ? [...existing.tokens, token] : existing.tokens }
  await ssh.putContent(`${root}/auth/acl.json`, JSON.stringify(next, null, 2))
  if (ctx.clientPublicKey) {
    await ssh.putContent(`${root}/auth/trusted_keys.asc`, ctx.clientPublicKey)
  }
  await ssh.exec(`chmod 600 ${shellQuote(`${root}/auth/acl.json`)} && chmod 600 ${authDir}/*.asc 2>/dev/null || true`)
}
