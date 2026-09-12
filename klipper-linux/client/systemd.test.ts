// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
  openSystemPackage: () => { throw new Error('no package stubbed') },
}))

import { renderTemplate } from './systemd'

const VALUES = {
  USER: 'notapi',
  BESPOK3D: '/home/notapi/bespok3d',
  VENV: '/home/notapi/bespok3d/venv',
}

const VISUDO = '/usr/sbin/visudo'
const TEMPLATES = ['bespok3d.service', 'bespok3d-plugins.service', 'bespok3d.sudoers']

function template(name: string): string {
  return readFileSync(new URL(`../jinni/${name}`, import.meta.url), 'utf-8')
}

describe('renderTemplate', () => {
  it('leaves no sentinel behind in any template that reaches the printer', () => {
    TEMPLATES.forEach((name) => {
      expect(renderTemplate(template(name), VALUES), name).not.toMatch(/__[A-Z0-9_]+__/)
    })
  })

  it('fills the login account, the workspace and the daemon interpreter into the unit', () => {
    const unit = renderTemplate(template('bespok3d.service'), VALUES)

    expect(unit).toContain('User=notapi')
    expect(unit).toContain('Environment=BESPOK3D_DATA_ROOT=/home/notapi/bespok3d')
    expect(unit).toContain('ExecStart=/bin/sh -c \'exec "/home/notapi/bespok3d/venv/bin/python3" "/home/notapi/bespok3d/var/lib/daemon/daemon.py" >>"/home/notapi/bespok3d/var/log/daemon.log" 2>&1\'')
  })

  it('names the account in the sudoers rule, so the rights belong to that login and no other', () => {
    const sudoers = renderTemplate(template('bespok3d.sudoers'), VALUES)

    expect(sudoers).toContain('notapi ALL=(root) NOPASSWD: BESPOK3D_SERVICES')
    expect(sudoers).not.toContain('ALL=(ALL)')
  })
})

// A sudoers file that does not parse takes sudo down for every account on the printer, which on a
// printer is unrecoverable without pulling the card. The enrolment runs visudo before installing it;
// this runs the same check here, so a bad edit to the template fails on a laptop instead.
describe('the rendered sudoers drop-in', () => {
  it.skipIf(!existsSync(VISUDO))('parses, as visudo will be asked on the printer', () => {
    const rendered = renderTemplate(template('bespok3d.sudoers'), VALUES)
    const file = join(mkdtempSync(join(tmpdir(), 'bespok3d-sudoers-')), 'bespok3d')
    writeFileSync(file, rendered, { mode: 0o600 })

    expect(() => execFileSync(VISUDO, ['-cf', file], { encoding: 'utf-8' })).not.toThrow()
  })
})
