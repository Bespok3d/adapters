// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// A printer for tests: a file tree held in memory that answers the few shell commands the daemon
// deployment and the boot dispatcher step send, and reads the tar stream the way the printer's own tar
// does. A test sees what landed, not which commands were typed, so the same assertions hold for any
// way of getting it there.
import { createHash } from 'crypto'
import { posix } from 'path'
import type { Readable } from 'stream'

import type { SshSession } from '@adapter-sdk'

import type { DistributionState } from './venv-record'

const TAR_BLOCK = 512
const QUOTED_PATH = /'([^']*)'/g
const VENV_SITE_PACKAGES = 'lib/python3.11/site-packages'

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
  // The packages pip put in the venv, by dist-info dir: what a check against their RECORD finds, and which
  // wheel they came from, here the sha256 of that wheel file.
  venvPackages: Map<string, VenvPackage>
  // The venv's python no longer runs, until the venv is made again.
  venvPythonBroken: boolean
}

export interface VenvPackage {
  state: DistributionState
  recordFingerprint: string
}

function quotedPaths(command: string): string[] {
  return [...command.matchAll(QUOTED_PATH)].map((match) => match[1])
}

function removeTree(entries: Map<string, unknown>, removedPath: string): void {
  [...entries.keys()]
    .filter((entryPath) => entryPath === removedPath || entryPath.startsWith(`${removedPath}/`))
    .forEach((entryPath) => entries.delete(entryPath))
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

function sha256Hex(fileBytes: Buffer): string {
  return createHash('sha256').update(fileBytes).digest('hex')
}

function hashListOf(files: Map<string, Buffer>, command: string): string {
  const [remoteBase, ...ownedEntries] = quotedPaths(command.replace(/ ! -path .*$/, ''))
  const ownedPrefixes = ownedEntries.map((entry) => `${remoteBase}/${entry}`)
  const ownedFiles = [...files].filter(([filePath]) => ownedPrefixes.some((owned) => filePath === owned || filePath.startsWith(`${owned}/`)))

  return ownedFiles
    .filter(([filePath]) => !filePath.includes('/__pycache__/'))
    .map(([filePath, fileBytes]) => `${sha256Hex(fileBytes)}  ${filePath.slice(remoteBase.length + 1)}\n`)
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

function projectDistInfos(venvPackages: Map<string, VenvPackage>, projectName: string): string[] {
  return [...venvPackages.keys()].filter((distInfoPath) => posix.basename(distInfoPath).startsWith(`${projectName}-`))
}

// pip as it really behaves: a plain install skips a version already there, whole or not, and replacing
// a version starts by uninstalling it, which fails on a package whose RECORD is gone.
function pipInstallWheel(printer: FakePrinter, venvDir: string, forced: boolean, wheelPath: string): void {
  const wheelBytes = printer.files.get(wheelPath)
  if (!wheelBytes) throw new Error(`pip: no such wheel ${wheelPath}`)
  const [projectName, version] = posix.basename(wheelPath).split('-')
  const distInfoPath = `${venvDir}/${VENV_SITE_PACKAGES}/${projectName}-${version}.dist-info`
  if (!forced && printer.venvPackages.has(distInfoPath)) return
  const replaced = projectDistInfos(printer.venvPackages, projectName)
  if (replaced.some((replacedPath) => printer.venvPackages.get(replacedPath)?.state === 'unrecorded')) throw new Error('pip: cannot uninstall, no RECORD file')
  replaced.forEach((replacedPath) => printer.venvPackages.delete(replacedPath))
  printer.venvPackages.set(distInfoPath, { state: 'intact', recordFingerprint: sha256Hex(wheelBytes) })
}

function pipInstall(printer: FakePrinter, command: string): void {
  const venvDir = command.split('/bin/pip ')[0]
  const forced = command.includes(' --force-reinstall ')
  quotedPaths(command).forEach((wheelPath) => pipInstallWheel(printer, venvDir, forced, wheelPath))
}

function installedLine([distInfoPath, venvPackage]: [string, VenvPackage]): string {
  const fingerprint = venvPackage.state === 'unrecorded' ? '-' : venvPackage.recordFingerprint

  return `installed\t${venvPackage.state}\t${fingerprint}\t${distInfoPath}\n`
}

function wheelLine(files: Map<string, Buffer>, wheelPath: string): string {
  const wheelBytes = files.get(wheelPath)

  return `wheel\t${wheelBytes ? sha256Hex(wheelBytes) : '-'}\t${wheelPath}\n`
}

// The check is quoted as the venv's python, the script, then the wheel paths.
function recordCheckOf(printer: FakePrinter, command: string): string {
  if (printer.venvPythonBroken) throw new Error('command failed')
  const wheelPaths = quotedPaths(command).slice(2)

  return [...[...printer.venvPackages].map(installedLine), ...wheelPaths.map((wheelPath) => wheelLine(printer.files, wheelPath))].join('')
}

function removePaths(printer: FakePrinter, command: string): void {
  removedPathsOf(command).forEach((removedPath) => {
    removeTree(printer.files, removedPath)
    removeTree(printer.venvPackages, removedPath)
  })
}

function remakeVenv(printer: FakePrinter, venvDir: string): string {
  removeTree(printer.files, venvDir)
  removeTree(printer.venvPackages, venvDir)
  printer.venvPythonBroken = false

  return ''
}

function answer(printer: FakePrinter, command: string): string {
  const { files } = printer
  const venvRemade = /^rm -rf (\S+) && python3 -m venv \1$/.exec(command)
  if (venvRemade) return remakeVenv(printer, venvRemade[1])
  if (command.includes('sha256sum')) return hashListOf(files, command)
  if (/^(test -f|cp) /.test(command)) return fileCheckOrCopy(files, command)
  if (/\/bin\/python3 -I -c .* && echo yes \|\| echo no$/.test(command)) return printer.venvPythonBroken ? 'no' : 'yes'
  if (command.includes(' -I -c ')) return recordCheckOf(printer, command)
  if (command.includes('/bin/pip install ')) pipInstall(printer, command)
  if (command.startsWith('rm -')) removePaths(printer, command)

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
    venvPackages: new Map(),
    venvPythonBroken: false,
    ssh: {} as SshSession,
  }
  printer.ssh = {
    exec: async (command: string) => {
      receive(printer, command)

      return answer(printer, command)
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
