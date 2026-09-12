// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

import type { EnrollContext, SshSession } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
}))

import { stepDiscoverLayout } from './layout'

const HOME = '/home/notapi'
const CTX = { credentials: { user: 'notapi', password: 'obviously-fake-password', port: 22 } } as EnrollContext

// A host somebody moved the printer data on: the stock template would put the plugin config directory
// somewhere the config file cannot include it from.
const DISCOVERED = {
  PRINTER_CFG: '/srv/klipper-data/config/printer.cfg',
  MOONRAKER_CFG: '/srv/klipper-data/config/moonraker.conf',
  KLIPPER_SRC: '/opt/klipper/klippy',
  PYTHON_SITE_PACKAGES: '/home/notapi/klippy-env/lib/python3.13/site-packages',
}

function recordingSession(): { written: Record<string, string>, ssh: SshSession } {
  const written: Record<string, string> = {}

  return {
    written,
    ssh: {
      host: '10.0.0.9',
      exec: async (command: string) => {
        if (command.includes('echo "$HOME"')) return `${HOME}\n`

        return JSON.stringify(DISCOVERED)
      },
      putContent: async (path: string, content: string) => { written[path] = content },
    } as unknown as SshSession,
  }
}

describe('the discover-layout step', () => {
  it('records what the printer answered, plus what only the app knows about it', async () => {
    const session = recordingSession()

    await stepDiscoverLayout(session.ssh, CTX, 'voron-24')

    const layout = JSON.parse(session.written[`${HOME}/bespok3d/etc/layout.json`])
    expect(layout.adapter).toBe('voron-24')
    expect(layout.runtime_user).toBe('notapi')
    expect(layout.home).toBe(HOME)
    expect(layout.KLIPPER_SRC).toBe(DISCOVERED.KLIPPER_SRC)
    expect(layout.PYTHON_SITE_PACKAGES).toBe(DISCOVERED.PYTHON_SITE_PACKAGES)
  })

  // The include line is relative to the config file that carries it, so the plugin config directory
  // has to sit beside the config this host actually has. Deriving it here is what keeps the directory
  // the enrolment creates and the one the jinni later hands a plugin the same directory.
  it('puts the plugin config directories beside the configs this host actually has', async () => {
    const session = recordingSession()

    await stepDiscoverLayout(session.ssh, CTX, 'klipper-generic')

    const layout = JSON.parse(session.written[`${HOME}/bespok3d/etc/layout.json`])
    expect(layout.BESPOK3D_KLIPPER).toBe('/srv/klipper-data/config/bespok3d/klipper')
    expect(layout.BESPOK3D_MOONRAKER).toBe('/srv/klipper-data/config/bespok3d/moonraker')
  })

  it('writes the id the printer was enrolled under, so the jinni reports itself as that adapter', async () => {
    const session = recordingSession()

    await stepDiscoverLayout(session.ssh, CTX, 'klipper-generic')

    expect(JSON.parse(session.written[`${HOME}/bespok3d/etc/layout.json`]).adapter).toBe('klipper-generic')
  })
})
