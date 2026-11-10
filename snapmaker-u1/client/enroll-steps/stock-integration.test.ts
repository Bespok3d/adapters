// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { fileURLToPath } from 'node:url'

import type { EnrollContext } from '@adapter-sdk'

vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../../Bespok3d-desktop', import.meta.url)) },
}))

vi.mock('@adapter-sdk', async () => {
  const { fakePackage } = await import('../fake-packages')

  return {
    ...(await import('../fake-sdk')),
    openSystemPackage: async (packageName: string) => fakePackage(packageName),
  }
})

import { stepDeployS99, stepKlipperIncludes } from './stock-integration'
import { packagedContent } from '../fake-packages'
import { fakePrinter } from '../fake-printer'
import { DAEMON_PACKAGE } from '../packages'
import { DAEMON_BASE } from '../paths'

const INSTALLED_DISPATCHER = '/etc/init.d/S99bespok3d'

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

// The printer must boot with the dispatcher of the daemon it runs. When the app keeps a newer daemon
// than the one it ships, an older dispatcher out of the app's package would boot that daemon wrong.
describe('stepDeployS99', () => {
  it('installs the dispatcher the daemon on the printer brought, not the one in the app', async () => {
    var printer = fakePrinter({ [`${DAEMON_BASE}/S99bespok3d`]: 'the newer daemon dispatcher' })

    await stepDeployS99(printer.ssh)

    expect(printer.files.get(INSTALLED_DISPATCHER)?.toString()).toBe('the newer daemon dispatcher')
    expect(printer.commands).toContain(`chmod 755 ${INSTALLED_DISPATCHER}`)
  })

  it('installs the packaged dispatcher when the daemon on the printer carries none', async () => {
    var printer = fakePrinter()

    await stepDeployS99(printer.ssh)

    expect(printer.files.get(INSTALLED_DISPATCHER)?.toString()).toBe(packagedContent(DAEMON_PACKAGE, 'S99bespok3d'))
    expect(printer.commands).toContain(`chmod 755 ${INSTALLED_DISPATCHER}`)
  })
})
