// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openBundledPackage } from '@adapter-sdk'
import type { BundledPackage, SshSession, EnrollContext } from '@adapter-sdk'

import { uploadAdapterJinni } from '../jinni-deploy'
import { removePackageEntries, uploadPayload } from '../package-deploy'
import { DAEMON_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'
import { cleanSystemPython, ensureVenv, installVenvDeps } from '../venv'

// Putting the daemon on the printer: its Python source, the device-side jinni it drives, its autostart
// script, and its own virtualenv. Every byte comes out of the signed package this build ships with, so
// a printer that answers on port 22 and nothing else enrolls exactly like one with a way out to the
// internet. The printer's system Python, Klipper and Moonraker are never touched, so nothing bespok3d
// installs can break the printer's own software.

// These two travel in the daemon's package but are not part of its runtime tree: one is placed under
// the bespok3d autostart directory, the other in the printer's own /etc/init.d by the stock-integration
// step.
const INIT_SCRIPTS = ['s10bespok3d-daemon', 'S99bespok3d']

// The daemon's python dependencies, baked into its package at build time (ADR-0036).
const WHEEL_DIR = 'wheels/'

// An earlier release created this under a misspelled name; a printer carrying it gets it cleared.
const LEGACY_DIR = `${BESPOK3D}/var/lib/demon`

function daemonRuntimePaths(signedPackage: BundledPackage): readonly string[] {
  return signedPackage.payloadPaths.filter((payloadPath) => !INIT_SCRIPTS.includes(payloadPath))
}

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, signedPackage: BundledPackage): Promise<void> {
  ctx.onProgress?.('Installing autostart script…')
  const autostartPath = `${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`
  await ssh.putBytes(autostartPath, signedPackage.payloadBytes('s10bespok3d-daemon'))
  await ssh.exec(`chmod 755 ${autostartPath}`)
}

export async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const signedPackage = await openBundledPackage(DAEMON_PACKAGE)
  const runtimePaths = daemonRuntimePaths(signedPackage)
  ctx.onProgress?.('Creating directories…')
  await ssh.exec(`rm -rf ${LEGACY_DIR}`)
  await removePackageEntries(ssh, DAEMON_BASE, runtimePaths)
  await uploadPayload({
    ssh,
    signedPackage,
    remoteBase: DAEMON_BASE,
    payloadPaths: runtimePaths,
    progressLabel: 'Uploading daemon files…',
    onProgress: ctx.onProgress,
  })
  await uploadAdapterJinni(ssh, ctx)
  await deployAutostartScript(ssh, ctx, signedPackage)
  await cleanSystemPython(ssh)
  await ensureVenv(ssh, ctx)
  await installVenvDeps(ssh, ctx, runtimePaths.filter((payloadPath) => payloadPath.startsWith(WHEEL_DIR)))
}
