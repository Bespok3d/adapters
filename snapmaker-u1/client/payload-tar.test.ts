// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TAR_END, tarFileEntry } from './payload-tar'

// A wheel path deep enough to need the ustar prefix field.
const LONG_PATH = `wheels/${'pydantic_core'.repeat(6)}/pydantic_core-2.27.2-cp311-cp311-manylinux_2_17_aarch64.whl`
const SENT_AT = 1_800_000_000

// The archive is read by a real tar, not by a parser written alongside the writer, so a header that
// only this code understands fails here.
function extractWithSystemTar(archive: Buffer): string {
  const extractDir = mkdtempSync(join(tmpdir(), 'payload-tar-'))
  execFileSync('tar', ['xf', '-', '-C', extractDir], { input: archive })

  return extractDir
}

describe('tarFileEntry', () => {
  it('writes an archive a real tar extracts byte for byte, long paths included', () => {
    const archive = Buffer.concat([
      tarFileEntry('daemon.py', Buffer.from('print("daemon")\n'), SENT_AT),
      tarFileEntry(LONG_PATH, Buffer.alloc(1300, 7), SENT_AT),
      tarFileEntry('empty.json', Buffer.alloc(0), SENT_AT),
      TAR_END,
    ])
    const extractDir = extractWithSystemTar(archive)

    expect(LONG_PATH.length).toBeGreaterThan(100)
    expect(readFileSync(join(extractDir, 'daemon.py'), 'utf-8')).toBe('print("daemon")\n')
    expect(readFileSync(join(extractDir, LONG_PATH)).equals(Buffer.alloc(1300, 7))).toBe(true)
    expect(readFileSync(join(extractDir, 'empty.json')).length).toBe(0)
    expect(statSync(join(extractDir, 'daemon.py')).mtimeMs).toBe(SENT_AT * 1000)
    rmSync(extractDir, { recursive: true })
  })

  it('pads every entry to whole 512-byte blocks', () => {
    expect(tarFileEntry('daemon.py', Buffer.alloc(513), SENT_AT).length).toBe(512 * 3)
  })

  it('refuses a path no header can hold', () => {
    expect(() => tarFileEntry(`${'unsplittable'.repeat(20)}.py`, Buffer.alloc(1), SENT_AT)).toThrow('path too long')
  })
})
