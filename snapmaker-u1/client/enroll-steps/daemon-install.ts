// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'fs'
import { join } from 'path'

import type { SshSession, EnrollContext } from '@adapter-sdk'

import { daemonFiles, daemonModuleDirs, uploadDaemonFile } from '../deploy'
import { uploadAdapterJinni } from '../jinni-deploy'
import { BESPOK3D, DAEMON_BASE, daemonSrcPath } from '../paths'
import { cleanSystemPython, ensureVenv, installVenvDeps } from '../venv'

// Putting the daemon on the printer: its Python source, the device-side adapter it drives, its
// autostart script, and its own virtualenv. The printer's system Python, Klipper and Moonraker are
// never touched, so nothing bespok3d installs can break the printer's own software.

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  ctx.onProgress?.('Installing autostart script…')
  const startupScript = readFileSync(join(src, 's10bespok3d-daemon'), 'utf-8')
  await ssh.putContent(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`, startupScript)
  await ssh.exec(`chmod 755 ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`)
}

export async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const src = daemonSrcPath()
  const files = daemonFiles(src)
  ctx.onProgress?.('Creating directories…')
  const moduleDirs = daemonModuleDirs(files).map((dir) => `${DAEMON_BASE}/${dir}`)
  await ssh.exec(
    `rm -rf ${BESPOK3D}/var/lib/demon ${DAEMON_BASE}` +
      ` && mkdir -p ${DAEMON_BASE}/wheels ${moduleDirs.join(' ')}`
  )
  const total = files.length

  async function uploadFromIndex(index: number): Promise<void> {
    if (index >= total) return
    ctx.onProgress?.(`Uploading source files… ${index + 1}/${total}`)
    await uploadDaemonFile(ssh, src, files[index])

    return uploadFromIndex(index + 1)
  }

  await uploadFromIndex(0)
  await uploadAdapterJinni(ssh, ctx)
  await deployAutostartScript(ssh, ctx, src)
  await cleanSystemPython(ssh)
  await ensureVenv(ssh, ctx)
  await installVenvDeps(ssh, ctx, src)
}
