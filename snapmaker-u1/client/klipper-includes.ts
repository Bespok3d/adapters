// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The one place that writes a bespok3d include line into the printer's own klipper and moonraker
// config. Enrollment does it once and switching bespok3d back on does it again, so both go through
// here; the jinni owns the same edit on the device side, for the times there is a daemon to ask.

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
