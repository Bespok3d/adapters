// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// What the printer already holds, by hash, against what the signed package carries: the files an update
// has to send and the files it has to remove.
import { createHash } from 'crypto'

import { shellQuote } from '@adapter-sdk'

export interface PayloadChanges {
  changed: string[]
  dropped: string[]
}

// sha256 hex of each file, keyed by its payload path.
export type HashesByPath = ReadonlyMap<string, string>

export function sha256Of(fileBytes: Buffer): string {
  return createHash('sha256').update(fileBytes).digest('hex')
}

// The first path segment of everything the package carries: what an install of this package owns on
// the printer.
export function topLevelEntries(payloadPaths: readonly string[]): string[] {
  return [...new Set(payloadPaths.map((payloadPath) => payloadPath.split('/')[0]))]
}

// One sha256sum run over the entries the packages own, and nothing else under the base: the printer
// keeps its own files there. Python's caches are not package files, so they are neither compared nor
// removed. A missing entry or base is a printer that lacks those files, so it lists nothing for them.
export function remoteHashCommand(remoteBase: string, ownedEntries: readonly string[]): string {
  const entries = ownedEntries.map(shellQuote).join(' ')

  return `cd ${shellQuote(remoteBase)} 2>/dev/null || exit 0; ` +
    `find ${entries} -type f ! -path '*/__pycache__/*' -exec sha256sum {} + 2>/dev/null; true`
}

// sha256sum prints "<hash>  <path>", one file a line.
function hashLineEntry(hashLine: string): [string, string] | null {
  const match = /^([0-9a-f]{64}) [ *](.+)$/.exec(hashLine)
  if (!match) return null

  return [match[2], match[1]]
}

export function parseHashList(sha256sumOutput: string): HashesByPath {
  const entries = sha256sumOutput.split('\n').map(hashLineEntry).filter((entry) => entry !== null)

  return new Map(entries)
}

export function payloadChanges(packageHashes: HashesByPath, printerHashes: HashesByPath): PayloadChanges {
  return {
    changed: [...packageHashes].filter(([path, hash]) => printerHashes.get(path) !== hash).map(([path]) => path),
    dropped: [...printerHashes.keys()].filter((path) => !packageHashes.has(path)),
  }
}
