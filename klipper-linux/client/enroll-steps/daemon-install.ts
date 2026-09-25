// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { BundledPackage, EnrollContext, SshSession } from '@adapter-sdk'

import { uploadAdapterJinni } from '../jinni-deploy'
import { removePackageEntries, uploadPayload } from '../package-deploy'
import { DAEMON_PACKAGE } from '../packages'
import { daemonBase } from '../paths'
import { remoteHome } from '../remote'
import { ensureVenv, installVenvDeps } from '../venv'

// Putting the daemon on the printer: its Python source, the device-side jinni it drives, and its own
// virtualenv. Every byte comes out of the signed daemon package, so a printer with no route to the
// internet enrolls exactly like one with a way out. The printer's system Python, Klipper and
// Moonraker are never touched, so nothing Bespok3d installs can break the printer's own software.

// The U1's two boot scripts travel in the daemon package and mean nothing here: this host boots with
// systemd, and its equivalents are rendered from the jinni package by the install-services step. They
// are filtered out rather than uploaded and ignored, so nothing on the printer can ever run them.
const U1_BOOT_SCRIPTS = ['S99bespok3d', 's10bespok3d-daemon']

// The daemon's python dependencies, baked into its package at build time (ADR-0036).
const WHEEL_DIR = 'wheels/'

// How this step's own progress bar is shared out. The two uploads are the bulk of it and the only
// parts whose size is known before they start, so they own most of the bar and move it a file at a
// time; the daemon carries far more files than the jinni, hence the split. The tail is one pip run,
// and nothing here can see inside it, so the bar holds at the last mark rather than inventing
// movement.
const DAEMON_UPLOAD_SPAN = { from: 0, to: 0.75 }
const JINNI_UPLOAD_SPAN = { from: 0.75, to: 0.88 }

export function daemonRuntimePaths(signedPackage: BundledPackage): readonly string[] {
  return signedPackage.payloadPaths.filter((payloadPath) => !U1_BOOT_SCRIPTS.includes(payloadPath))
}

export async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const signedPackage = await openSystemPackage(DAEMON_PACKAGE)
  const home = await remoteHome(ssh)
  const runtimePaths = daemonRuntimePaths(signedPackage)
  ctx.onProgress?.('Creating directories…', DAEMON_UPLOAD_SPAN.from)
  await removePackageEntries(ssh, daemonBase(home), runtimePaths)
  await uploadPayload({
    ssh,
    signedPackage,
    remoteBase: daemonBase(home),
    payloadPaths: runtimePaths,
    progressLabel: 'Uploading daemon files…',
    onProgress: ctx.onProgress,
    progressSpan: DAEMON_UPLOAD_SPAN,
  })
  await uploadAdapterJinni(ssh, ctx, JINNI_UPLOAD_SPAN)
  const hasPip = await ensureVenv(ssh, ctx, home)
  const wheelPaths = runtimePaths.filter((payloadPath) => payloadPath.startsWith(WHEEL_DIR))
  await installVenvDeps({ ssh, ctx, home, wheelPaths, hasPip })
}
