// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// A printer for tests: a file tree held in memory that answers the few shell commands the daemon
// deployment and the boot dispatcher step send, and reads the tar stream the way the printer's own tar
// does. A test sees what landed, not which commands were typed, so the same assertions hold for any
// way of getting it there.
import { createHash } from 'crypto'
import type { Readable } from 'stream'

import type { SshSession } from '@adapter-sdk'

const TAR_BLOCK = 512
const QUOTED_PATH = /'([^']*)'/g

export interface FakePrinter {
  ssh: SshSession
  // Every file on the printer, by its absolute path.
  files: Map<string, Buffer>
  commands: string[]
  // The payload paths each tar stream carried, one list per stream.
  streams: string[][]
  // The paths sent one file at a time, outside any stream.
  uploads: string[]
  // The connection drops at the next command matching this, and stays down until a test brings it back.
  cutPoint: RegExp | null
  connectionLost: boolean
  // The next command matching this fails on the printer, while the connection stays up.
  failingCommand: RegExp | null
}

function quotedPaths(command: string): string[] {
  return [...command.matchAll(QUOTED_PATH)].map((match) => match[1])
}

function removeTree(files: Map<string, Buffer>, removedPath: string): void {
  [...files.keys()]
    .filter((filePath) => filePath === removedPath || filePath.startsWith(`${removedPath}/`))
    .forEach((filePath) => files.delete(filePath))
}

function tarField(header: Buffer, offset: number, size: number): string {
  return header.subarray(offset, offset + size).toString('utf-8').replace(/\0.*$/s, '')
}

function tarEntries(archive: Buffer, offset: number): [string, Buffer][] {
  const header = archive.subarray(offset, offset + TAR_BLOCK)
  if (header.length < TAR_BLOCK || header.every((headerByte) => headerByte === 0)) return []
  const prefix = tarField(header, 345, 155)
  const name = tarField(header, 0, 100)
  const size = parseInt(tarField(header, 124, 12), 8)
  const fileBytes = archive.subarray(offset + TAR_BLOCK, offset + TAR_BLOCK + size)
  const nextOffset = offset + TAR_BLOCK + Math.ceil(size / TAR_BLOCK) * TAR_BLOCK

  return [[prefix ? `${prefix}/${name}` : name, fileBytes], ...tarEntries(archive, nextOffset)]
}

function hashListOf(files: Map<string, Buffer>, command: string): string {
  const [remoteBase, ...ownedEntries] = quotedPaths(command.replace(/ ! -path .*$/, ''))
  const ownedPrefixes = ownedEntries.map((entry) => `${remoteBase}/${entry}`)
  const ownedFiles = [...files].filter(([filePath]) => ownedPrefixes.some((owned) => filePath === owned || filePath.startsWith(`${owned}/`)))

  return ownedFiles
    .filter(([filePath]) => !filePath.includes('/__pycache__/'))
    .map(([filePath, fileBytes]) => `${createHash('sha256').update(fileBytes).digest('hex')}  ${filePath.slice(remoteBase.length + 1)}\n`)
    .join('')
}

// `rm -rf /some/dir` from the daemon step, `rm -f 'a' 'b'` from the package sync.
function removedPathsOf(command: string): string[] {
  const quoted = quotedPaths(command)
  if (quoted.length > 0) return quoted

  return command.split(' ').slice(2)
}

// `test -f <path> && echo yes || echo no`, and `cp <from> <to>` for a single file.
function fileCheckOrCopy(files: Map<string, Buffer>, command: string): string {
  const fileCheck = /^test -f (\S+) /.exec(command)
  if (fileCheck) return files.has(fileCheck[1]) ? 'yes' : 'no'
  const copy = /^cp (\S+) (\S+)$/.exec(command)
  const copiedBytes = copy ? files.get(copy[1]) : undefined
  if (copy && copiedBytes) files.set(copy[2], Buffer.from(copiedBytes))

  return ''
}

function answer(files: Map<string, Buffer>, command: string): string {
  if (command.includes('sha256sum')) return hashListOf(files, command)
  if (/^(test -f|cp) /.test(command)) return fileCheckOrCopy(files, command)
  if (command.startsWith('test -x')) return 'yes'
  if (command.startsWith('cat ')) return files.get(command.split(' ')[1])?.toString('utf-8') ?? ''
  if (command.startsWith('rm -')) removedPathsOf(command).forEach((removedPath) => removeTree(files, removedPath))
  const marker = /^printf %s (\S+) > (\S+)$/.exec(command)
  if (marker) files.set(marker[2], Buffer.from(marker[1]))

  return ''
}

// The apply command clears what a full send replaces, then copies the staged files into the base.
async function applyStream(printer: FakePrinter, command: string, input: Readable): Promise<string> {
  const archive = Buffer.concat(await input.toArray())
  const remoteBase = /cp -a '[^']*'\/\. '([^']*)'\//.exec(command)?.[1] ?? ''
  const cleared = [...command.matchAll(/rm -rf '([^']*)'/g)].map((match) => match[1]).filter((clearedPath) => !clearedPath.endsWith('/.incoming'))
  cleared.forEach((clearedPath) => removeTree(printer.files, clearedPath))
  const landed = tarEntries(archive, 0)
  landed.forEach(([payloadPath, fileBytes]) => printer.files.set(`${remoteBase}/${payloadPath}`, Buffer.from(fileBytes)))
  printer.streams.push(landed.map(([payloadPath]) => payloadPath))

  return ''
}

function receive(printer: FakePrinter, command: string): void {
  if (printer.connectionLost) throw new Error('connection lost')
  printer.commands.push(command)
  if (printer.failingCommand?.test(command)) {
    printer.failingCommand = null
    throw new Error('command failed')
  }
  if (!printer.cutPoint?.test(command)) return
  printer.cutPoint = null
  printer.connectionLost = true
  throw new Error('connection lost')
}

export function fakePrinter(startingFiles: Record<string, string> = {}): FakePrinter {
  const printer: FakePrinter = {
    files: new Map(Object.entries(startingFiles).map(([filePath, content]) => [filePath, Buffer.from(content)])),
    commands: [],
    streams: [],
    uploads: [],
    cutPoint: null,
    connectionLost: false,
    failingCommand: null,
    ssh: {} as SshSession,
  }
  printer.ssh = {
    exec: async (command: string) => {
      receive(printer, command)

      return answer(printer.files, command)
    },
    execWithInput: async (command: string, input: Readable) => {
      receive(printer, command)

      return applyStream(printer, command, input)
    },
    putBytes: async (remotePath: string, content: Buffer) => {
      printer.uploads.push(remotePath)
      printer.files.set(remotePath, content)
    },
  } as unknown as SshSession

  return printer
}
