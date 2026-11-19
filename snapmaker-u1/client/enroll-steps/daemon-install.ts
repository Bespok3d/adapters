// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { BundledPackage, SshSession, EnrollContext } from '@adapter-sdk'

import { openJinniSource } from '../jinni-deploy'
import { keepSignedManifests } from '../machinery-manifests'
import { newestWheelPerProject } from '../newest-wheels'
import { syncPayload } from '../package-deploy'
import { parseHashList, remoteHashCommand } from '../payload-hashes'
import { DAEMON_PACKAGE } from '../packages'
import { BESPOK3D, DAEMON_BASE } from '../paths'
import { shellArguments } from '../shell-arguments'
import { cleanSystemPython, removeLegacyWheelMarker, syncVenvDeps } from '../venv'

// Putting the daemon on the printer: its Python source, the device-side jinni it drives, its autostart
// script, and its own virtualenv. Every byte comes out of the signed daemon package: the published one
// when the lists offer a daemon newer than this build ships, and otherwise the copy in the build, so a
// printer that answers on port 22 and nothing else enrolls exactly like one with a way out to the
// internet. The printer's system Python, Klipper and Moonraker are never touched, so nothing bespok3d
// installs can break the printer's own software.

// The daemon's own autostart script travels in its package but is placed under the bespok3d autostart
// directory, not in its runtime tree. The boot dispatcher (S99bespok3d) does stay in the runtime tree:
// the stock-integration step copies it from there, so the printer always boots with the dispatcher of
// the daemon it runs, even when the app keeps a newer daemon than the one it ships.
const AUTOSTART_SCRIPT = 's10bespok3d-daemon'

// The daemon's python dependencies, baked into its package at build time (ADR-0036).
const WHEEL_DIR_NAME = 'wheels'
const WHEEL_DIR = `${WHEEL_DIR_NAME}/`

// An earlier release created this under a misspelled name; a printer carrying it gets it cleared.
const LEGACY_DIR = `${BESPOK3D}/var/lib/demon`

// How this step's own progress bar is shared out. The upload of the daemon and the jinni together is
// the bulk of it and the only part whose size is known before it starts, so it owns most of the bar and
// moves it a file at a time. The tail is one pip run installing the wheels, and nothing here can see
// inside it, so the bar holds at the last mark until the step finishes rather than inventing movement.
const UPLOAD_SPAN = { from: 0, to: 0.88 }
const AUTOSTART_MARK = 0.9

function daemonRuntimePaths(signedPackage: BundledPackage): readonly string[] {
  return signedPackage.payloadPaths.filter((payloadPath) => payloadPath !== AUTOSTART_SCRIPT)
}

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, signedPackage: BundledPackage): Promise<void> {
  ctx.onProgress?.('Installing autostart script…', AUTOSTART_MARK)
  const autostartPath = `${BESPOK3D}/etc/init.d/autostart/${AUTOSTART_SCRIPT}`
  await ssh.putBytes(autostartPath, signedPackage.payloadBytes(AUTOSTART_SCRIPT))
  await ssh.exec(`chmod 755 ${autostartPath}`)
}

// The daemon and the jinni share the daemon's directory, so they travel in one stream. With
// sendChangedFilesOnly it sends only the files whose checksum differs from the printer's. pip runs only
// for the packages the venv does not hold whole, from these exact wheels.
export async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const signedPackage = await openSystemPackage(DAEMON_PACKAGE)
  const jinniSource = await openJinniSource()
  const runtimePaths = daemonRuntimePaths(signedPackage)
  ctx.onProgress?.('Creating directories…', UPLOAD_SPAN.from)
  await ssh.exec(`rm -rf ${LEGACY_DIR}`)
  await syncPayload({
    ssh,
    remoteBase: DAEMON_BASE,
    sources: [{ signedPackage, payloadPaths: runtimePaths }, jinniSource],
    sendChangedFilesOnly: ctx.sendChangedFilesOnly,
    progressLabel: 'Uploading daemon files…',
    onProgress: ctx.onProgress,
    progressSpan: UPLOAD_SPAN,
  })
  await deployAutostartScript(ssh, ctx, signedPackage)
  await cleanSystemPython(ssh)
  await removeLegacyWheelMarker(ssh)
  await syncVenvDeps(ssh, ctx, runtimePaths.filter((payloadPath) => payloadPath.startsWith(WHEEL_DIR)))
  await keepSignedManifests(ssh, [signedPackage, jinniSource.signedPackage])
}

async function removeStaleWheels(ssh: SshSession, staleWheels: readonly string[]): Promise<void> {
  if (staleWheels.length === 0) return
  await ssh.exec(`rm -f ${shellArguments(staleWheels.map((wheelPath) => `${DAEMON_BASE}/${wheelPath}`))}`)
}

// When the app keeps a newer daemon than the one it ships, the daemon step does not run, yet the venv
// can still lack that daemon's packages (a venv made afresh, a pip run cut short, a file lost since). The
// wheels that daemon brought are already on the printer, so pip installs from them, and only the packages
// the venv does not hold whole. The printer keeps no list of the wheels its daemon brought, and an
// earlier release left the wheels of an older daemon beside them, so only the newest wheel of each
// package counts and the older ones are removed.
export async function stepRefreshDaemonVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await removeLegacyWheelMarker(ssh)
  const printerWheels = [...parseHashList(await ssh.exec(remoteHashCommand(DAEMON_BASE, [WHEEL_DIR_NAME]))).keys()]
  if (printerWheels.length === 0) return
  const currentWheels = newestWheelPerProject(printerWheels)
  await removeStaleWheels(ssh, printerWheels.filter((wheelPath) => !currentWheels.includes(wheelPath)))
  await syncVenvDeps(ssh, ctx, currentWheels)
}
