// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { BESPOK3D, BESPOK3D_SYSTEM_VERSION, SYSTEM_VERSION_FILE } from '../paths'

// The on-printer bespok3d tree: the one directory every later step and every plugin writes into. It
// lives under /userdata, which survives a firmware update, and it carries its own layout version so
// a future release can migrate an older tree instead of guessing at its shape.
export async function stepCreateWorkspace(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await ssh.exec(
    `
    mkdir -p ${BESPOK3D}/bin \
              ${BESPOK3D}/sbin \
              ${BESPOK3D}/etc/daemon \
              ${BESPOK3D}/etc/init.d/autostart \
              ${BESPOK3D}/etc/nginx/locations \
              ${BESPOK3D}/home \
              ${BESPOK3D}/root \
              ${BESPOK3D}/run \
              ${BESPOK3D}/usr/local/plugins \
              ${BESPOK3D}/var/db \
              ${BESPOK3D}/var/lib \
              ${BESPOK3D}/var/log &&
    ([ -f ${SYSTEM_VERSION_FILE} ] || printf '%s\n' '${BESPOK3D_SYSTEM_VERSION}' > ${SYSTEM_VERSION_FILE}) &&
    chmod +t ${BESPOK3D}/run &&
    chown -R ${ctx.runtimeUser}:${ctx.runtimeUser} ${BESPOK3D} &&
    chmod -R 755 ${BESPOK3D}
  `.trim()
  )
}
