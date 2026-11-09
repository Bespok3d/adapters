// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Putting a package's payload on the printer. Every file this adapter deploys goes through here, so
// what lands on the printer is exactly what the signature covered, and an install only ever removes
// the entries the package itself owns. The files travel in one tar stream into the printer's own tar:
// one transfer however many files, where one transfer per file cost over a minute.
import { Readable } from 'stream'

import { shellQuote } from '@adapter-sdk'
import type { BundledPackage, EnrollContext, SshSession } from '@adapter-sdk'

import { parseHashList, payloadChanges, remoteHashCommand, sha256Of, topLevelEntries } from './payload-hashes'
import type { HashesByPath } from './payload-hashes'
import { TAR_END, tarFileEntry } from './payload-tar'
import { spanFraction } from './step-progress'
import type { ProgressSpan } from './step-progress'

export interface PayloadSource {
  signedPackage: BundledPackage
  payloadPaths: readonly string[]
}

export interface PayloadSync {
  ssh: SshSession
  remoteBase: string
  // Packages that share the base, sent together in the one stream.
  sources: readonly PayloadSource[]
  // An update compares hashes and sends what differs; without it every file is sent.
  sendChangedFilesOnly?: boolean
  progressLabel: string
  onProgress?: EnrollContext['onProgress']
  // The slice of the step's bar this upload owns, when the step does more than this one upload.
  progressSpan?: ProgressSpan
}

interface PayloadFile {
  payloadPath: string
  fileBytes: Buffer
}

function payloadFiles(sources: readonly PayloadSource[]): PayloadFile[] {
  return sources.flatMap((source) => source.payloadPaths.map((payloadPath) => ({
    payloadPath,
    fileBytes: source.signedPackage.payloadBytes(payloadPath),
  })))
}

function packageHashes(files: readonly PayloadFile[]): HashesByPath {
  return new Map(files.map((file) => [file.payloadPath, sha256Of(file.fileBytes)]))
}

function ownedEntries(files: readonly PayloadFile[]): string[] {
  return topLevelEntries(files.map((file) => file.payloadPath))
}

// The stream lands in a staging directory first and reaches the live tree only once every file arrived,
// so a stream cut by the network leaves the daemon that was there whole. HUP is ignored so a connection
// lost after that point cannot stop the copy half way. A full send clears what the packages own just
// before the copy, so a file the package dropped goes with it.
function applyCommand(sync: PayloadSync, fileCount: number, entriesToClear: readonly string[]): string {
  const base = shellQuote(sync.remoteBase)
  const staging = shellQuote(`${sync.remoteBase}/.incoming`)
  const clearOwned = entriesToClear.map((entry) => `rm -rf ${shellQuote(`${sync.remoteBase}/${entry}`)} && `).join('')

  return `trap '' HUP; rm -rf ${staging} && mkdir -p ${staging} && tar xf - -C ${staging} && ` +
    `test "$(find ${staging} -type f | wc -l)" -eq ${fileCount} && ` +
    `${clearOwned}cp -a ${staging}/. ${base}/ && rm -rf ${staging}`
}

// The bar advances as each file is pulled into the stream, so the count beside it is what moved it.
function* tarStreamFrom(sync: PayloadSync, files: readonly PayloadFile[], index: number, sentAt: number): Generator<Buffer> {
  if (index >= files.length) {
    yield TAR_END

    return
  }
  sync.onProgress?.(`${sync.progressLabel} ${index + 1}/${files.length}`, spanFraction(sync.progressSpan, (index + 1) / files.length))
  yield tarFileEntry(files[index].payloadPath, files[index].fileBytes, sentAt)
  yield* tarStreamFrom(sync, files, index + 1, sentAt)
}

async function sendFiles(sync: PayloadSync, files: readonly PayloadFile[], entriesToClear: readonly string[]): Promise<void> {
  const sentAt = Math.floor(Date.now() / 1000)
  const tarStream = Readable.from(tarStreamFrom(sync, files, 0, sentAt))

  await sync.ssh.execWithInput(applyCommand(sync, files.length, entriesToClear), tarStream)
}

async function sendChangedFiles(sync: PayloadSync, changedFiles: readonly PayloadFile[]): Promise<void> {
  if (changedFiles.length > 0) return sendFiles(sync, changedFiles, [])

  sync.onProgress?.('The printer already has these files', spanFraction(sync.progressSpan, 1))
}

async function removeDropped(sync: PayloadSync, droppedPaths: readonly string[]): Promise<void> {
  if (droppedPaths.length === 0) return

  await sync.ssh.exec(`rm -f ${droppedPaths.map((droppedPath) => shellQuote(`${sync.remoteBase}/${droppedPath}`)).join(' ')}`)
}

// Removal comes after the copy, so an update cut off at any point leaves either the old tree or the new
// files beside a few stale ones, and running it again finishes the job.
async function sendChanges(sync: PayloadSync, files: readonly PayloadFile[]): Promise<void> {
  sync.onProgress?.('Comparing files with the printer…', spanFraction(sync.progressSpan, 0))
  const printerHashes = parseHashList(await sync.ssh.exec(remoteHashCommand(sync.remoteBase, ownedEntries(files))))
  const changes = payloadChanges(packageHashes(files), printerHashes)
  await sendChangedFiles(sync, files.filter((file) => changes.changed.includes(file.payloadPath)))
  await removeDropped(sync, changes.dropped)
}

// A hash list or an update stream that fails is not trusted to say what the printer holds, so the
// update falls back to sending everything.
async function sendChangesOrEverything(sync: PayloadSync, files: readonly PayloadFile[]): Promise<void> {
  try {
    await sendChanges(sync, files)
  } catch (updateFailure) {
    sync.onProgress?.(`Update stream failed (${String(updateFailure)}); sending every file…`, spanFraction(sync.progressSpan, 0))
    await sendFiles(sync, files, ownedEntries(files))
  }
}

export async function syncPayload(sync: PayloadSync): Promise<void> {
  const files = payloadFiles(sync.sources)
  if (sync.sendChangedFilesOnly) return sendChangesOrEverything(sync, files)

  return sendFiles(sync, files, ownedEntries(files))
}
