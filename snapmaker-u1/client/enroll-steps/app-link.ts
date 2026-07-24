import type { SshSession, EnrollContext } from '@adapter-sdk'

import { readAcl, grantedAcl } from '../acl'
import { BESPOK3D } from '../paths'

// Binding this computer to this printer. The printer generates its own TLS certificate and the app
// records it, so from here on the app talks to a printer it can recognise; the app's identity goes
// into the printer's access list, so the printer only answers computers their owner let in.

export async function stepGenerateDaemonCert(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const certExists = await ssh.exec(
    `test -f ${BESPOK3D}/etc/daemon/server.crt && echo yes || echo no`
  )
  if (certExists.trim() === 'yes') {
    ctx.daemonCert = await ssh.getContent(`${BESPOK3D}/etc/daemon/server.crt`)

    return
  }
  await ssh.exec(
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout ${BESPOK3D}/etc/daemon/server.key -out ${BESPOK3D}/etc/daemon/server.crt -sha256 -days 3650 -nodes -subj '/CN=bespok3d-daemon' 2>&1`
  )
  ctx.daemonCert = await ssh.getContent(`${BESPOK3D}/etc/daemon/server.crt`)
}

// Read-modify-write so re-enrolling this computer (or a multi-client ACL) is never clobbered: the
// enroller is admin only when it is the first key in. A second computer never runs this; it uses the
// access-request flow.
export async function stepEnrollDaemonKey(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await ssh.exec(`mkdir -p ${BESPOK3D}/auth`)
  const existing = await readAcl(ssh)
  const identity = ctx.clientFingerprint || ctx.clientId || ''
  const token = ctx.daemonToken || ''
  const role = existing.keys.length === 0 ? 'admin' : 'user'
  const next = identity
    ? grantedAcl(existing, identity, token, role, ctx.clientLabel || '')
    : { ...existing, tokens: token && !existing.tokens.includes(token) ? [...existing.tokens, token] : existing.tokens }
  await ssh.putContent(`${BESPOK3D}/auth/acl.json`, JSON.stringify(next, null, 2))
  if (ctx.clientPublicKey) {
    await ssh.putContent(`${BESPOK3D}/auth/trusted_keys.asc`, ctx.clientPublicKey)
  }
}
