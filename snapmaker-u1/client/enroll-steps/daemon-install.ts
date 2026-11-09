// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { BundledPackage, SshSession, EnrollContext } from '@adapter-sdk'

import { openJinniSource } from '../jinni-deploy'
import { syncPayload } from '../package-deploy'
import { sha256Of } from '../payload-hashes'
import { DAEMON_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'
import { cleanSystemPython, ensureVenv, syncVenvDeps } from '../venv'

// Putting the daemon on the printer: its Python source, the device-side jinni it drives, its autostart
// script, and its own virtualenv. Every byte comes out of the signed daemon package: the published one
// when the lists offer a daemon newer than this build ships, and otherwise the copy in the build, so a
// printer that answers on port 22 and nothing else enrolls exactly like one with a way out to the
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

// How this step's own progress bar is shared out. The upload of the daemon and the jinni together is
// the bulk of it and the only part whose size is known before it starts, so it owns most of the bar and
// moves it a file at a time. The tail is one pip run installing the wheels, and nothing here can see
// inside it, so the bar holds at the last mark until the step finishes rather than inventing movement.
const UPLOAD_SPAN = { from: 0, to: 0.88 }
const AUTOSTART_MARK = 0.9

function daemonRuntimePaths(signedPackage: BundledPackage): readonly string[] {
  return signedPackage.payloadPaths.filter((payloadPath) => !INIT_SCRIPTS.includes(payloadPath))
}

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, signedPackage: BundledPackage): Promise<void> {
  ctx.onProgress?.('Installing autostart script…', AUTOSTART_MARK)
  const autostartPath = `${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`
  await ssh.putBytes(autostartPath, signedPackage.payloadBytes('s10bespok3d-daemon'))
  await ssh.exec(`chmod 755 ${autostartPath}`)
}

function wheelHashes(signedPackage: BundledPackage, runtimePaths: readonly string[]): Map<string, string> {
  const wheelPaths = runtimePaths.filter((payloadPath) => payloadPath.startsWith(WHEEL_DIR))

  return new Map(wheelPaths.map((wheelPath) => [wheelPath, sha256Of(signedPackage.payloadBytes(wheelPath))]))
}

// The daemon and the jinni share the daemon's directory, so they travel in one stream. An update sends
// only the files the printer does not already hold, and runs pip only when a wheel changed.
export async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const signedPackage = await openSystemPackage(DAEMON_PACKAGE)
  const runtimePaths = daemonRuntimePaths(signedPackage)
  ctx.onProgress?.('Creating directories…', UPLOAD_SPAN.from)
  await ssh.exec(`rm -rf ${LEGACY_DIR}`)
  await syncPayload({
    ssh,
    remoteBase: DAEMON_BASE,
    sources: [{ signedPackage, payloadPaths: runtimePaths }, await openJinniSource()],
    sendChangedFilesOnly: ctx.sendChangedFilesOnly,
    progressLabel: 'Uploading daemon files…',
    onProgress: ctx.onProgress,
    progressSpan: UPLOAD_SPAN,
  })
  await deployAutostartScript(ssh, ctx, signedPackage)
  await cleanSystemPython(ssh)
  await ensureVenv(ssh, ctx)
  await syncVenvDeps(ssh, ctx, wheelHashes(signedPackage, runtimePaths))
}
