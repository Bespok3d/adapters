// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession } from '@adapter-sdk'

import { bespok3dIncludeCommand, KLIPPER_INCLUDE, MOONRAKER_INCLUDE } from '../klipper-includes'
import { layoutPath, readLayout } from '../layout'
import { remoteHome } from '../remote'

// Where Bespok3d meets the printer's own Klipper and Moonraker configuration: one include line in
// each, pointing at a directory plugins drop their .cfg files into. Both edits are additive and
// idempotent, so the printer keeps working exactly as it did and a re-enrolment never doubles them up.
//
// Which config file and which directory are facts about this printer, so both come out of the
// discovered layout. The include line is relative, which is why the directory has to be the one the
// layout names rather than one this adapter picked: on a host whose printer data was moved, the
// template's path is not where the config file is.

const PLACEHOLDER = 'main.cfg'

interface IncludeTarget {
  config: string
  directory: string
  include: typeof KLIPPER_INCLUDE
}

async function includeTargets(ssh: SshSession): Promise<IncludeTarget[]> {
  const home = await remoteHome(ssh)
  const layout = await readLayout(ssh, home)

  return [
    {
      config: layoutPath(layout, 'PRINTER_CFG', home),
      directory: layoutPath(layout, 'BESPOK3D_KLIPPER', home),
      include: KLIPPER_INCLUDE,
    },
    {
      config: layoutPath(layout, 'MOONRAKER_CFG', home),
      directory: layoutPath(layout, 'BESPOK3D_MOONRAKER', home),
      include: MOONRAKER_INCLUDE,
    },
  ]
}

async function writeInclude(ssh: SshSession, target: IncludeTarget): Promise<void> {
  await ssh.exec(
    `mkdir -p ${shellQuote(target.directory)} &&` +
    ` touch ${shellQuote(`${target.directory}/${PLACEHOLDER}`)}`
  )
  await ssh.exec(bespok3dIncludeCommand(target.config, target.include))
}

// Also what switching Bespok3d back on runs, so enrolment and reactivation write the same line the
// same way and can never drift apart.
export async function restoreIncludes(ssh: SshSession): Promise<void> {
  const targets = await includeTargets(ssh)
  await writeInclude(ssh, targets[0])
  await writeInclude(ssh, targets[1])
}

export function stepKlipperIncludes(ssh: SshSession): Promise<void> {
  return restoreIncludes(ssh)
}
