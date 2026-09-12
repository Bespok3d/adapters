// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession } from '@adapter-sdk'

// The printer's access list, read and rewritten rather than replaced, so a second computer enrolled
// against the same printer is never cut off by the first one re-enrolling. The U1's copy of this
// reads a fixed root; here the root follows the login user's home, so it is passed in.

interface Acl {
  keys: string[]
  roles: Record<string, string>
  labels: Record<string, string>
  tokens: string[]
  token_identity: Record<string, string>
}

const EMPTY_ACL: Acl = { keys: [], roles: {}, labels: {}, tokens: [], token_identity: {} }

export async function readAcl(ssh: SshSession, root: string): Promise<Acl> {
  const present = await ssh.exec(`test -f ${root}/auth/acl.json && echo yes || echo no`)
  if (present.trim() !== 'yes') return { ...EMPTY_ACL }
  try {
    return { ...EMPTY_ACL, ...JSON.parse(await ssh.getContent(`${root}/auth/acl.json`)) }
  } catch {
    return { ...EMPTY_ACL }
  }
}

export function grantedAcl(existing: Acl, identity: string, token: string, role: string, label: string): Acl {
  return {
    keys: existing.keys.includes(identity) ? existing.keys : [...existing.keys, identity],
    roles: { ...existing.roles, [identity]: role },
    labels: { ...existing.labels, [identity]: label },
    tokens: token && !existing.tokens.includes(token) ? [...existing.tokens, token] : existing.tokens,
    token_identity: token ? { ...existing.token_identity, [token]: identity } : existing.token_identity,
  }
}
