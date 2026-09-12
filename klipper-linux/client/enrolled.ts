// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession } from '@adapter-sdk'

import { bespok3dRoot, SHELL_HOME } from './paths'
import { succeeds } from './remote'

// What the app reads back off an enrolled printer: whether the setup is still there, the daemon's own
// log, and one line naming what is wrong when it will not start.
//
// Each of these is one command and no round trip: the workspace hangs off the login account's home,
// and the remote shell already knows where that is, so `$HOME` is left for it to expand rather than
// asked for first. These run on a printer whose daemon may be down, which is exactly when an extra
// round trip is least welcome.

const ROOT = bespok3dRoot(SHELL_HOME)
const DAEMON_PORT = 4269
const LOG_TAIL_LINES = 200

// Enrolled AND intact: the daemon's tree is there, the boot service is registered, and the printer
// still means to start it. Unlike the U1 there is no overlay to be wiped by an update here, so the
// answer only goes false when somebody removed part of the install.
export async function verifyEnrolled(ssh: SshSession): Promise<boolean> {
  return succeeds(
    ssh,
    `test -d ${ROOT}/var/lib/daemon` +
    ` && test -f /etc/systemd/system/bespok3d.service` +
    ` && systemctl is-enabled --quiet bespok3d`
  )
}

// The daemon's own log, for the screen that reports a daemon which did not come up. Silence rather
// than an error when there is no log yet: on a printer that never started one, "nothing" is the
// finding, and a failed command would hide it behind a shell message.
export function readDaemonLog(ssh: SshSession): Promise<string> {
  return ssh.exec(`tail -${LOG_TAIL_LINES} ${ROOT}/var/log/daemon.log 2>/dev/null || true`)
}

// One line naming what is wrong with a daemon that will not start, shown as a progress hint before a
// repair redeploys it. Each fact is one systemd knows: whether the unit is running, whether it is
// meant to start at boot, and whether something else already holds the port it binds.
export function diagnoseDaemon(ssh: SshSession): Promise<string> {
  return ssh.exec(
    `active=$(systemctl is-active bespok3d 2>/dev/null || true); ` +
    `enabled=$(systemctl is-enabled bespok3d 2>/dev/null || true); ` +
    `port=free; ss -ltn 2>/dev/null | grep -q ':${DAEMON_PORT} ' && port=occupied; ` +
    `echo "Diagnosis: the bespok3d service is \${active:-unknown} and \${enabled:-unknown}, ` +
    `port ${DAEMON_PORT} is $port"`
  )
}
