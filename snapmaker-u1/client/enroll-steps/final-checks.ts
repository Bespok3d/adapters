// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession } from '@adapter-sdk'

import { BESPOK3D } from '../paths'

// Starting the daemon and proving the printer came out of enrollment working. Both steps read the
// daemon log to stderr when the daemon is not alive, so a failed enroll says why on the spot instead
// of leaving someone to go find out over SSH.

export async function stepStartDaemon(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `[ -f ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon ]` +
      ` && ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon stop 2>/dev/null || true`
  )
  await ssh.exec(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon start`)
  await ssh.exec(
    `sleep 5 && pid=$(cat ${BESPOK3D}/run/bespok3d-daemon.pid 2>/dev/null) && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || { cat ${BESPOK3D}/var/log/daemon.log >&2; exit 1; }`
  )
}

export async function stepVerify(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `test -d ${BESPOK3D} && test -f /etc/init.d/S99bespok3d` +
    ` && pid=$(cat ${BESPOK3D}/run/bespok3d-daemon.pid 2>/dev/null)` +
    ` && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null` +
    ` || { cat ${BESPOK3D}/var/log/daemon.log >&2; exit 1; }`
  )
}
