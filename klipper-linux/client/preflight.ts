// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { printerIsPrinting } from './print-state'
import { asRoot } from './privilege'

// Everything that would make this printer a bad host for Bespok3d, checked before a single file is
// written. Each refusal is one sentence naming what to change, because the person reading it is
// standing at a printer and not at a log.
//
// The sudo probe is deliberately last and deliberately here: it is the one check that cannot be made
// without the password, and finding out at the install-services step that root was never available
// would leave a half installed printer behind.

// 64-bit only: the daemon's packaged wheels are built for aarch64, and a 32-bit host would fall back
// to compiling every one of them on a Raspberry Pi.
const SUPPORTED_ARCHITECTURES = ['aarch64', 'x86_64']
const REQUIRED_UNITS = ['klipper.service', 'moonraker.service']

async function checkArchitecture(ssh: SshSession): Promise<void> {
  const machine = (await ssh.exec('uname -m')).trim()
  if (SUPPORTED_ARCHITECTURES.includes(machine)) return

  throw new Error(
    `Bespok3d needs a 64-bit system on the printer, and this one reports ${machine || 'an unknown architecture'}. Reinstall the printer host with a 64-bit image, then enroll.`
  )
}

async function checkSystemd(ssh: SshSession): Promise<void> {
  const systemctl = (await ssh.exec('command -v systemctl || true')).trim()
  if (systemctl) return

  throw new Error(
    'This printer does not run systemd, which is how Bespok3d starts and stops its services here. Use a Linux host with systemd, such as MainsailOS or Raspberry Pi OS.'
  )
}

async function checkServices(ssh: SshSession): Promise<void> {
  const listed = await ssh.exec(`systemctl list-unit-files ${REQUIRED_UNITS.join(' ')} --no-legend 2>/dev/null | wc -l`)
  if (Number(listed.trim()) >= REQUIRED_UNITS.length) return

  throw new Error(
    'This printer does not have both a klipper and a moonraker service, so Bespok3d has nothing to attach to. Finish the Klipper and Moonraker install on the printer, then enroll.'
  )
}

async function checkPython(ssh: SshSession): Promise<void> {
  const modern = await ssh.exec(`python3 -c 'import sys;print(sys.version_info >= (3, 11))' 2>/dev/null || true`)
  if (modern.trim() === 'True') return

  throw new Error(
    'Bespok3d needs Python 3.11 or newer on the printer, and this one does not have it. Update the printer host to a current Debian based image, then enroll.'
  )
}

async function checkIdle(ssh: SshSession): Promise<void> {
  if (!(await printerIsPrinting(ssh.host))) return

  throw new Error(
    'The printer is printing or paused. Enrolling restarts Klipper and Moonraker, so wait for the print to finish, then enroll.'
  )
}

export async function stepPreflight(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await checkArchitecture(ssh)
  await checkSystemd(ssh)
  await checkServices(ssh)
  await checkPython(ssh)
  await checkIdle(ssh)
  // Raises the "Bespok3d needs sudo on this printer" refusal itself when neither mode works.
  await asRoot(ssh, ctx, 'true')
}
