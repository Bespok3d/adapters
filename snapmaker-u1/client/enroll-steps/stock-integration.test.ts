// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../../Bespok3d-desktop', import.meta.url)) },
}))

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
  devSourcePath: () => undefined,
  unverifiedBundledPayload: () => { throw new Error('the checkout copy is what this test reads') },
  openSystemPackage: async () => { throw new Error('this step opens no package') },
}))

import { stepKlipperIncludes } from './stock-integration'
import { fakePrinter } from '../fake-printer'

// The file the firmware's boot (S48setup-lava-env) looks for before putting its own configs back.
const ADVANCED_MODE_MARKER = '/oem/printer_data/.fluidd'

describe('stepKlipperIncludes', () => {
  it('turns on the screen Advanced mode, so the boot keeps the include lines', async () => {
    var printer = fakePrinter()

    await stepKlipperIncludes(printer.ssh, { runtimeUser: 'lava' } as EnrollContext)

    expect(printer.commands.join('\n')).toContain(`touch ${ADVANCED_MODE_MARKER}`)
    expect(printer.commands.join('\n')).toContain(`chown lava:lava ${ADVANCED_MODE_MARKER}`)
  })
})
