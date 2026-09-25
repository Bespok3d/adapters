// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession } from '@adapter-sdk'

import { BESPOK3D_SYSTEM_VERSION, bespok3dRoot, systemVersionFile } from '../paths'
import { remoteHome } from '../remote'

// The on-printer bespok3d tree: the one directory every later step and every plugin writes into. It
// carries its own layout version so a future release can migrate an older tree instead of guessing
// at its shape.
//
// Nothing here is chowned, which is the whole point of this adapter's runtime model: the tree is made
// by the account the app logged in as, so every file in it is already owned by the person who owns
// the printer and no daemon write ever needs privilege. That is also why it sits in that account's
// home and not somewhere under /opt. Klipper and Moonraker run as that same account, so nothing has
// to be opened up to another user, and the modes set here are set on the directories this step makes
// and on nothing that is already there: a second enrolment must not rewrite what the first one and
// the daemon have since put in place.

const TREE = [
  'bin',
  'sbin',
  'etc/daemon',
  'etc/init.d/autostart',
  'etc/systemd',
  'home',
  'root',
  'run',
  'usr/local/plugins',
  'var/db',
  'var/lib',
  'var/log',
]
// The access list and the daemon's token live here, and nothing but this account may read them.
const PRIVATE_TREE = ['auth']

export async function stepCreateWorkspace(ssh: SshSession): Promise<void> {
  const home = await remoteHome(ssh)
  const root = bespok3dRoot(home)
  const dirs = TREE.map((leaf) => shellQuote(`${root}/${leaf}`)).join(' ')
  const privateDirs = PRIVATE_TREE.map((leaf) => shellQuote(`${root}/${leaf}`)).join(' ')
  await ssh.exec(
    `mkdir -p ${dirs} ${privateDirs} &&` +
    ` ([ -f ${shellQuote(systemVersionFile(home))} ] ||` +
    ` printf '%s\\n' '${BESPOK3D_SYSTEM_VERSION}' > ${shellQuote(systemVersionFile(home))}) &&` +
    ` chmod 755 ${shellQuote(root)} ${dirs} &&` +
    ` chmod 700 ${privateDirs} &&` +
    // Pidfiles under run/ are the one thing here another account must not be able to delete.
    ` chmod +t ${shellQuote(`${root}/run`)}`
  )
}
