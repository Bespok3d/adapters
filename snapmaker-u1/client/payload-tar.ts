// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// A tar archive, written by hand: the files sent in one stream to the printer's own `tar x`. Only what
// that needs is here: regular files in the ustar layout, which busybox tar reads.

const BLOCK_SIZE = 512
const NAME_FIELD_SIZE = 100
const PREFIX_FIELD_SIZE = 155
const FILE_MODE = 0o644
const REGULAR_FILE = '0'

// Field offsets in a ustar header.
const MODE_OFFSET = 100
const OWNER_OFFSET = 108
const GROUP_OFFSET = 116
const SIZE_OFFSET = 124
const MTIME_OFFSET = 136
const CHECKSUM_OFFSET = 148
const CHECKSUM_FIELD_SIZE = 8
const TYPE_OFFSET = 156
const MAGIC_OFFSET = 257
const OWNER_NAME_OFFSET = 265
const GROUP_NAME_OFFSET = 297
const PREFIX_OFFSET = 345

// Two empty blocks close the archive. A stream cut before them reads as cut, not as complete.
export const TAR_END = Buffer.alloc(BLOCK_SIZE * 2)

interface SplitPath {
  name: string
  prefix: string
}

// A path over 100 bytes goes in two fields, split at a slash: the wheel paths come close to it.
function splitPath(payloadPath: string): SplitPath {
  if (Buffer.byteLength(payloadPath) <= NAME_FIELD_SIZE) return { name: payloadPath, prefix: '' }
  const splitAt = payloadPath.indexOf('/', payloadPath.length - NAME_FIELD_SIZE - 1)
  if (splitAt <= 0 || splitAt > PREFIX_FIELD_SIZE) throw new Error(`path too long for a tar header: ${payloadPath}`)

  return { name: payloadPath.slice(splitAt + 1), prefix: payloadPath.slice(0, splitAt) }
}

function octalField(value: number, fieldSize: number): string {
  return value.toString(8).padStart(fieldSize - 1, '0')
}

function headerChecksum(header: Buffer): string {
  const byteSum = [...header].reduce((sum, headerByte) => sum + headerByte, 0)

  return `${octalField(byteSum, CHECKSUM_FIELD_SIZE - 1)}\0 `
}

// The modification time is the time of sending, never a fixed one: python trusts a cached .pyc whose
// source keeps its size and mtime, so a fixed time would let an edit of the same length run the old code.
function fileHeader(payloadPath: string, size: number, sentAt: number): Buffer {
  const header = Buffer.alloc(BLOCK_SIZE)
  const { name, prefix } = splitPath(payloadPath)
  header.write(name, 0)
  header.write(octalField(FILE_MODE, 8), MODE_OFFSET)
  header.write(octalField(0, 8), OWNER_OFFSET)
  header.write(octalField(0, 8), GROUP_OFFSET)
  header.write(octalField(size, 12), SIZE_OFFSET)
  header.write(octalField(sentAt, 12), MTIME_OFFSET)
  header.write(' '.repeat(CHECKSUM_FIELD_SIZE), CHECKSUM_OFFSET)
  header.write(REGULAR_FILE, TYPE_OFFSET)
  header.write('ustar\u000000', MAGIC_OFFSET)
  header.write('root', OWNER_NAME_OFFSET)
  header.write('root', GROUP_NAME_OFFSET)
  header.write(prefix, PREFIX_OFFSET)
  header.write(headerChecksum(header), CHECKSUM_OFFSET)

  return header
}

function blockPadding(size: number): Buffer {
  return Buffer.alloc((BLOCK_SIZE - (size % BLOCK_SIZE)) % BLOCK_SIZE)
}

// One file as it sits in the archive: its header, its bytes, and the padding to a whole block.
export function tarFileEntry(payloadPath: string, fileBytes: Buffer, sentAt: number): Buffer {
  return Buffer.concat([fileHeader(payloadPath, fileBytes.length, sentAt), fileBytes, blockPadding(fileBytes.length)])
}
