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

import { installVenvDeps, pgpyWheelName, wheelhouseNames } from './venv'

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

describe('wheelhouseNames', () => {
  it('says which directory it looked in when the wheelhouse is empty', () => {
    const empty = mkdtempSync(join(tmpdir(), 'venv-test-'))

    mkdirSync(join(empty, 'wheels'))

    expect(() => wheelhouseNames(empty)).toThrow(join(empty, 'wheels'))
  })
})

describe('installVenvDeps', () => {
  // A bare 'pip install fastapi' reaches for the index, so the venv could only be built where the
  // printer itself had an internet connection.
  it('builds the venv from the shipped wheels and never reaches a package index', async () => {
    const commands: string[] = []
    const uploaded: string[] = []
    const ssh = {
      exec: async (command: string) => {
        commands.push(command)

        return command.includes('import ') ? 'missing' : ''
      },
      putBytes: async (remotePath: string) => {
        uploaded.push(remotePath)
      },
    }

    await installVenvDeps(ssh as never, {} as never, DAEMON_DIR)

    const installs = commands.filter((command) => command.includes('pip install'))

    expect(installs).toHaveLength(2)
    expect(installs.every((command) => command.includes('--no-index') || command.includes('--no-deps'))).toBe(true)
    expect(installs[0]).toContain('--find-links')
    expect(installs[0]).toContain('fastapi')
    expect(uploaded.some((remotePath) => remotePath.endsWith(pgpyWheelName(DAEMON_DIR)))).toBe(true)
  })
})
