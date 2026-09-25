// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession } from '@adapter-sdk'

import { bespok3dRoot } from '../paths'
import { clearPrivilege } from '../privilege'
import { remoteHome } from '../remote'

// Starting Bespok3d and proving the printer came out of enrolment working.
//
// "Running" is the daemon listening on its port, not the unit being active: a Type=simple unit is
// active the moment its process is forked, before Python has imported a thing, so asking systemd
// would say yes to a daemon that dies a second later. The wait and the report are one shell command
// rather than a poll from here, so a printer answering over a slow link does not pay a round trip per
// second. When the daemon does not come up, or systemd gives it up as failed, the same command puts
// the daemon's own log and the unit's journal on stderr, which the SSH transport raises as the error
// text, so a failed enrolment says why on the spot instead of leaving somebody to go and find out.

const DAEMON_PORT = 4269
const STARTUP_SECONDS = 20
const LOG_TAIL_LINES = 50

const LISTENING = `ss -ltn 2>/dev/null | grep -q ':${DAEMON_PORT} '`

function reportFailure(root: string, reason: string): string {
  return (
    `{ echo ${shellQuote(reason)}; tail -${LOG_TAIL_LINES} ${shellQuote(`${root}/var/log/daemon.log`)} 2>/dev/null;` +
    ` journalctl -u bespok3d -n ${LOG_TAIL_LINES} --no-pager 2>/dev/null; true; } >&2`
  )
}

function waitForTheDaemon(root: string): string {
  return [
    'attempt=0',
    `while [ "$attempt" -lt ${STARTUP_SECONDS} ]; do`,
    `  ${LISTENING} && exit 0`,
    '  systemctl is-failed --quiet bespok3d && break',
    '  sleep 1',
    '  attempt=$((attempt + 1))',
    'done',
    reportFailure(root, `the bespok3d daemon did not start listening on port ${DAEMON_PORT} within ${STARTUP_SECONDS} seconds`),
    'exit 1',
  ].join('\n')
}

export async function stepStartDaemon(ssh: SshSession): Promise<void> {
  const root = bespok3dRoot(await remoteHome(ssh))
  const autostart = shellQuote(`${root}/etc/init.d/autostart/s10bespok3d-daemon`)
  await ssh.exec(`${autostart} stop 2>/dev/null || true`)
  await ssh.exec(`${autostart} start`)
  // The plugin services are their own unit, so a daemon restart never takes a running plugin down.
  await ssh.exec('sudo -n /usr/bin/systemctl start bespok3d-plugins')
  await ssh.exec(waitForTheDaemon(root))
}

// The last step of enrolment, and so the one that takes the sudo password back off the printer.
export async function stepVerify(ssh: SshSession): Promise<void> {
  const root = bespok3dRoot(await remoteHome(ssh))
  await ssh.exec(
    `{ test -d ${shellQuote(root)}` +
    ` && test -f /etc/systemd/system/bespok3d.service` +
    ` && systemctl is-enabled --quiet bespok3d` +
    ` && ${LISTENING}; }` +
    ` || { ${reportFailure(root, 'the bespok3d service is not enabled and listening after enrolment')}; exit 1; }`
  )
  await clearPrivilege(ssh)
}
