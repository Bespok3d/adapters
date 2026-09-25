// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'

import { describe, it, expect, vi } from 'vitest'

vi.mock('@adapter-sdk', () => ({
  shellQuote: (value: string) => `'${value.replace(/'/g, "'\\''")}'`,
}))

import { bespok3dIncludeCommand, KLIPPER_INCLUDE, MOONRAKER_INCLUDE } from './klipper-includes'

describe('bespok3dIncludeCommand', () => {
  it('leaves a config that already includes bespok3d alone', () => {
    expect(bespok3dIncludeCommand('/cfg/printer.cfg', KLIPPER_INCLUDE)).toContain(
      "grep -q 'bespok3d/klipper' '/cfg/printer.cfg' 2>/dev/null ||"
    )
  })

  // The path came off the printer's own service files, so it is whatever that host was set up with.
  it('hands the config path to the shell quoted and to Python as an argument, never as code', () => {
    const command = bespok3dIncludeCommand("/srv/my printer's data/config/printer.cfg", KLIPPER_INCLUDE)

    expect(command).toContain("grep -q 'bespok3d/klipper' '/srv/my printer'\\''s data/config/printer.cfg'")
    expect(command).toContain('path = sys.argv[1]')
    expect(command.trimEnd().endsWith("'/srv/my printer'\\''s data/config/printer.cfg'")).toBe(true)
    expect(command).not.toContain("open('/srv")
  })

  it('writes the blank line above the include instead of adding one', () => {
    const command = bespok3dIncludeCommand('/cfg/printer.cfg', KLIPPER_INCLUDE)

    expect(command).toContain(String.raw`.rstrip('\n')`)
    expect(command).toContain(String.raw`head + '\n\n' + '[include bespok3d/klipper/*.cfg]' + '\n' + tail`)
  })

  it('keeps the include above the SAVE_CONFIG block klipper rewrites', () => {
    const command = bespok3dIncludeCommand('/cfg/moonraker.conf', MOONRAKER_INCLUDE)

    expect(command).toContain("marker = '#*# <---------------------- SAVE_CONFIG'")
    expect(command).toContain('head = (content if at < 0 else content[:at])')
  })
})

// Enrolment writes the include from here, over SSH, before there is a daemon to ask. Once there is
// one, the jinni writes the same line on the device. Two copies of one edit, so if they ever drift
// the printer gets a second include line or loads nothing, and this is what fails first.
describe('the include lines the jinni writes on the device', () => {
  const jinniIntegration = readFileSync(
    new URL('../../klipper-jinni/jinni/integration.py', import.meta.url), 'utf-8'
  )

  it('are the same lines the app writes at enrolment', () => {
    expect(jinniIntegration).toContain(`_KLIPPER_INCLUDE_LINE = "${KLIPPER_INCLUDE.line}"`)
    expect(jinniIntegration).toContain(`_MOONRAKER_INCLUDE_LINE = "${MOONRAKER_INCLUDE.line}"`)
  })

  it('recognise an existing include by the same marker', () => {
    expect(jinniIntegration).toContain(`_KLIPPER_INCLUDE = "[include ${KLIPPER_INCLUDE.pattern}"`)
    expect(jinniIntegration).toContain(`_MOONRAKER_INCLUDE = "[include ${MOONRAKER_INCLUDE.pattern}"`)
  })
})
