// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { mkdirSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// paths.ts reads the adapter's paths.json through electron's app path at module load, exactly as the
// existing client test does.
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

import { pgpyWheelName } from './venv'

const DAEMON_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../daemon')

describe('pgpyWheelName', () => {
  it('names the wheel exactly as the daemon ships it, capitals included', () => {
    const shipped = readdirSync(join(DAEMON_DIR, 'wheels'))

    // toContain compares case-sensitively, so a name that only a case-insensitive filesystem would
    // open fails here on every host. The hardcoded 'wheels/PGPy-0.6.0-py3-none-any.whl' this replaced
    // is exactly that name, and it broke every Linux enrollment.
    expect(shipped).toContain(pgpyWheelName(DAEMON_DIR))
  })

  it('says which directory it looked in when no pgpy wheel is there', () => {
    const empty = mkdtempSync(join(tmpdir(), 'venv-test-'))

    mkdirSync(join(empty, 'wheels'))

    expect(() => pgpyWheelName(empty)).toThrow(join(empty, 'wheels'))
  })
})
