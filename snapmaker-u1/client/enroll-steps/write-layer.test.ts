// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../../Bespok3d-desktop', import.meta.url)) },
}))

vi.mock('@adapter-sdk', async () => ({
  ...(await import('../fake-sdk')),
  connect: async () => { throw new Error('this step does not reconnect') },
}))

import { stepUnlockOverlay } from './write-layer'
import { fakePrinter } from '../fake-printer'

function unlockCommand(commands: string[]): string {
  return commands.find((command) => command.includes('touch /oem/.debug')) ?? ''
}

describe('stepUnlockOverlay', () => {
  // The bug: a plain copy wrote the screen's Wi-Fi through the link of a printer enrolled before,
  // over its kept network. What the guarded copy does in a shell is checked in wifi-persistence.test.
  it('copies the screen Wi-Fi only when /etc is not a link, then opens the write layer', async () => {
    var printer = fakePrinter()

    await stepUnlockOverlay(printer.ssh, {} as EnrollContext)

    expect(unlockCommand(printer.commands)).toContain('if [ ! -L /etc/wpa_supplicant.conf ]')
    expect(unlockCommand(printer.commands)).toContain('cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf')
    expect(unlockCommand(printer.commands)).toMatch(/; fi && touch \/oem\/\.debug$/)
  })
})
