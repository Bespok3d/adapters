// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The one place that writes a bespok3d include line into the printer's own klipper and moonraker
// config. Enrollment does it once and switching bespok3d back on does it again, so both go through
// here; the jinni owns the same edit on the device side, for the times there is a daemon to ask.
import type { SshSession } from '@adapter-sdk'

import { PATHS } from './paths'

export interface Bespok3dInclude {
  // What any form of our include line looks like, so a config that already carries one (including
  // the older per-file form) is left alone rather than given a second one.
  pattern: string
  line: string
}

export const KLIPPER_INCLUDE: Bespok3dInclude = { pattern: 'bespok3d/klipper', line: '[include bespok3d/klipper/*.cfg]' }
export const MOONRAKER_INCLUDE: Bespok3dInclude = { pattern: 'bespok3d/moonraker', line: '[include bespok3d/moonraker/*.cfg]' }

// The shell command that puts our include line into one of the printer's own configs, above the
// SAVE_CONFIG block klipper owns at the tail of the file (anything below that marker is klipper's
// to rewrite, so an include placed under it is lost the next time the printer saves).
//
// The blank line above the include is WRITTEN, never added to what is already there. Taking the
// line out leaves its blank line behind, so a version that just prefixed another one grew the
// user's config by one empty line every time bespok3d was switched off and back on, until the
// include sat a screenful of blank space down the file.
export function bespok3dIncludeCommand(cfgPath: string, include: Bespok3dInclude): string {
  return `grep -q '${include.pattern}' ${cfgPath} 2>/dev/null || python3 -c "
content = open('${cfgPath}').read()
marker = '#*# <---------------------- SAVE_CONFIG'
at = content.find(marker)
head = (content if at < 0 else content[:at]).rstrip('\\n')
tail = '' if at < 0 else '\\n' + content[at:]
open('${cfgPath}', 'w').write(head + '\\n\\n' + '${include.line}' + '\\n' + tail)
"`
}

// The include for a config only some firmware has. A firmware without it never reads it, and then
// nothing is written.
export function bespok3dIncludeIfPresentCommand(cfgPath: string, include: Bespok3dInclude): string {
  return `test ! -f ${cfgPath} || { ${bespok3dIncludeCommand(cfgPath, include)}; }`
}

// Every config the printer may start Klipper or Moonraker on. Firmware 2.0 starts Klipper on
// printer_v2.cfg instead of printer.cfg when the mainboard is the newer gd32h757 one (S60klipper),
// so a printer on that board loads no plugin unless that file carries the include too. Firmware 2.0
// also keeps its own copy of each config under /home/lava/origin_printer_data, and its boot
// (S48setup-lava-env) puts that copy back over a live config that differs, so a line written only
// into the live config is gone after the next boot. Each copy gets the same line.
export async function writeBespok3dIncludes(ssh: SshSession): Promise<void> {
  await ssh.exec(bespok3dIncludeCommand(PATHS.PRINTER_CFG, KLIPPER_INCLUDE))
  await ssh.exec(bespok3dIncludeCommand(PATHS.MOONRAKER_CFG, MOONRAKER_INCLUDE))
  await ssh.exec(newerMainboardIncludesCommand())
  await ssh.exec(bespok3dIncludeIfPresentCommand(PATHS.PRINTER_CFG_ORIGIN, KLIPPER_INCLUDE))
  await ssh.exec(bespok3dIncludeIfPresentCommand(PATHS.MOONRAKER_CFG_ORIGIN, MOONRAKER_INCLUDE))
}

// The firmware copy of printer_v2.cfg is wired only when the live one exists, the same rule the
// jinni follows, so switching Bespok3d off on the printer finds every line this wrote.
export function newerMainboardIncludesCommand(): string {
  return `test ! -f ${PATHS.PRINTER_V2_CFG} || { ${bespok3dIncludeCommand(PATHS.PRINTER_V2_CFG, KLIPPER_INCLUDE)} && ${bespok3dIncludeIfPresentCommand(PATHS.PRINTER_V2_CFG_ORIGIN, KLIPPER_INCLUDE)}; }`
}
