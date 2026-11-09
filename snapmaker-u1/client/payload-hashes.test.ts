// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}))

import { parseHashList, payloadChanges } from './payload-hashes'

const STATE_HASH = 'a'.repeat(64)
const ROUTES_HASH = 'b'.repeat(64)

describe('parseHashList', () => {
  it('reads sha256sum lines in text and binary form, and skips anything else', () => {
    const printerHashes = parseHashList(`${STATE_HASH}  core/state.py\n${ROUTES_HASH} *api/my routes.py\nsha256sum: x: denied\n`)

    expect([...printerHashes]).toEqual([['core/state.py', STATE_HASH], ['api/my routes.py', ROUTES_HASH]])
  })
})

describe('payloadChanges', () => {
  it('names what differs or is missing as changed, and what only the printer holds as dropped', () => {
    const packageHashes = new Map([['core/state.py', STATE_HASH], ['api/routes.py', ROUTES_HASH], ['daemon.py', STATE_HASH]])
    const printerHashes = new Map([['core/state.py', STATE_HASH], ['api/routes.py', STATE_HASH], ['core/legacy.py', STATE_HASH]])

    expect(payloadChanges(packageHashes, printerHashes)).toEqual({
      changed: ['api/routes.py', 'daemon.py'],
      dropped: ['core/legacy.py'],
    })
  })
})
