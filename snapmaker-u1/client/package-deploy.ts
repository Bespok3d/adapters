// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Putting a package's payload on the printer. Every file this adapter deploys goes through here, so
// what lands on the printer is exactly what the signature covered, and an install only ever removes
// the entries the package itself owns.
import { posix } from 'path'

import { shellQuote } from '@adapter-sdk'
import type { BundledPackage, EnrollContext, SshSession } from '@adapter-sdk'

export interface PayloadUpload {
  ssh: SshSession
  signedPackage: BundledPackage
  remoteBase: string
  payloadPaths: readonly string[]
  progressLabel: string
  onProgress?: EnrollContext['onProgress']
}

// The directories the payload needs, deduped, so one mkdir builds the whole tree before any upload.
export function remoteDirsOf(remoteBase: string, payloadPaths: readonly string[]): string[] {
  const dirs = new Set(payloadPaths.map((payloadPath) => posix.dirname(payloadPath)).filter((dir) => dir !== '.'))

  return [...dirs].map((dir) => `${remoteBase}/${dir}`)
}

// The first path segment of everything the package carries: what an install of this package owns on
// the printer.
export function topLevelEntries(payloadPaths: readonly string[]): string[] {
  return [...new Set(payloadPaths.map((payloadPath) => payloadPath.split('/')[0]))]
}

// A reinstall clears what the package owns and nothing else, so the printer's own files under the
// bespok3d directory (its certificate, its token, its daemon data, its installed plugins) survive
// being installed over.
export async function removePackageEntries(ssh: SshSession, remoteBase: string, payloadPaths: readonly string[]): Promise<void> {
  const owned = topLevelEntries(payloadPaths).map((entry) => shellQuote(`${remoteBase}/${entry}`))
  if (owned.length === 0) return

  await ssh.exec(`rm -rf ${owned.join(' ')}`)
}

async function uploadFromIndex(upload: PayloadUpload, index: number): Promise<void> {
  if (index >= upload.payloadPaths.length) return
  const payloadPath = upload.payloadPaths[index]
  upload.onProgress?.(`${upload.progressLabel} ${index + 1}/${upload.payloadPaths.length}`)
  await upload.ssh.putBytes(`${upload.remoteBase}/${payloadPath}`, upload.signedPackage.payloadBytes(payloadPath))

  return uploadFromIndex(upload, index + 1)
}

// Bytes, never text: the daemon's payload carries its wheels, and reading a zip member as utf-8 would
// corrupt every one of them.
export async function uploadPayload(upload: PayloadUpload): Promise<void> {
  const dirs = remoteDirsOf(upload.remoteBase, upload.payloadPaths)
  await upload.ssh.exec(`mkdir -p ${[upload.remoteBase, ...dirs].map(shellQuote).join(' ')}`)

  return uploadFromIndex(upload, 0)
}
