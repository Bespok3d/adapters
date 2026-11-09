// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'

import { describe, it, expect } from 'vitest'

import {
  bespok3dIncludeCommand,
  bespok3dIncludeIfPresentCommand,
  KLIPPER_INCLUDE,
  MOONRAKER_INCLUDE,
} from './klipper-includes'

describe('bespok3dIncludeCommand', () => {
  it('leaves a config that already includes bespok3d alone', () => {
    expect(bespok3dIncludeCommand('/cfg/printer.cfg', KLIPPER_INCLUDE)).toContain(
      "grep -q 'bespok3d/klipper' /cfg/printer.cfg 2>/dev/null ||"
    )
  })

  it('writes the blank line above the include instead of adding one', () => {
    // Switching bespok3d off leaves the include's blank line behind. A version that prefixed another
    // one grew the user's config by an empty line on every switch off and back on, until the include
    // sat a screenful of blank space down the file.
    const command = bespok3dIncludeCommand('/cfg/printer.cfg', KLIPPER_INCLUDE)

    expect(command).toContain(String.raw`.rstrip('\n')`)
    expect(command).toContain(String.raw`head + '\n\n' + '[include bespok3d/klipper/*.cfg]' + '\n' + tail`)
  })

  it('keeps the include above the SAVE_CONFIG block klipper rewrites', () => {
    const command = bespok3dIncludeCommand('/cfg/moonraker.conf', MOONRAKER_INCLUDE)

    expect(command).toContain("marker = '#*# <---------------------- SAVE_CONFIG'")
    expect(command).toContain("head = (content if at < 0 else content[:at])")
  })
})

describe('bespok3dIncludeIfPresentCommand', () => {
  // The firmware's own copy of a config, which its boot puts back over the live one on firmware 2.0.
  const command = bespok3dIncludeIfPresentCommand('/origin/printer.cfg', KLIPPER_INCLUDE)

  it('writes the same include line the live config gets', () => {
    expect(command).toContain(bespok3dIncludeCommand('/origin/printer.cfg', KLIPPER_INCLUDE))
  })

  it('does nothing on a firmware that has no copy to restore from', () => {
    expect(command.startsWith('test ! -f /origin/printer.cfg || {')).toBe(true)
  })
})

// Enrollment writes the include from here, over SSH, before there is a daemon to ask. Once there is
// one, the jinni writes the same line on the device. Two copies of one edit, so if they ever drift
// the printer gets a second include line or loads nothing, and this is what fails first.
describe('the include lines the jinni writes on the device', () => {
  const jinniIntegration = readFileSync(
    new URL('../../klipper-jinni/jinni/include_lines.py', import.meta.url), 'utf-8'
  )

  it('are the same lines the app writes at enrollment', () => {
    expect(jinniIntegration).toContain(`_KLIPPER_INCLUDE_LINE = "${KLIPPER_INCLUDE.line}"`)
    expect(jinniIntegration).toContain(`_MOONRAKER_INCLUDE_LINE = "${MOONRAKER_INCLUDE.line}"`)
  })

  it('recognise an existing include by the same marker', () => {
    expect(jinniIntegration).toContain(`_KLIPPER_INCLUDE = "[include ${KLIPPER_INCLUDE.pattern}"`)
    expect(jinniIntegration).toContain(`_MOONRAKER_INCLUDE = "[include ${MOONRAKER_INCLUDE.pattern}"`)
  })
})
