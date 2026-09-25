// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { AdapterLifecycle, EnrollContext, EnrollStep, SshSession } from '@adapter-sdk'

import { restoreIncludes } from './enroll-steps/includes'
import { START_DAEMON } from './enroll-steps'
import { bespok3dRoot } from './paths'
import { clearPrivilege } from './privilege'
import { remoteHome } from './remote'
import { removeSudoers, removeUnits, setServicesEnabled } from './systemd'

// What switching Bespok3d off, back on, removing it, and power cycling do to this printer's own
// filesystem. The app owns the daemon side of each operation (stopping the plugins, tearing them
// down, the waits) and asks the adapter for this half, because which boot system carries the hook and
// what a reboot is spelled as are device knowledge and belong with the device.
//
// Every list that touches root ends by taking the sudo password back off the printer, so the window
// in which it exists there is exactly one operation long.

async function disableServices(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await setServicesEnabled(ssh, ctx, false)
  await clearPrivilege(ssh)
}

// The last thing in a reactivation that needs the password: starting the daemon after it goes through
// the sudoers drop-in, which needs no password at all. So the password leaves the printer here rather
// than at the end of the list.
async function enableServices(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await setServicesEnabled(ssh, ctx, true)
  await clearPrivilege(ssh)
}

// The order matters: the sudoers drop-in goes last, because after it there is no privilege left to
// remove anything else with.
async function removeSystemFiles(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await removeUnits(ssh, ctx)
  await removeSudoers(ssh, ctx)
  await clearPrivilege(ssh)
}

// The workspace is the login account's own directory, so removing it needs no privilege at all, and
// it happens after the privileged half precisely so a failure there cannot strand the system files.
async function removeWorkspace(ssh: SshSession): Promise<void> {
  await ssh.exec(`rm -rf ${shellQuote(bespok3dRoot(await remoteHome(ssh)))}`)
}

// The printer drops the link the moment it starts going down, so the exec never returns cleanly: that
// dropped connection IS the reboot happening, not a failure to report to the user. A refusal from sudo
// is a different thing: the printer is still up, and the drop-in that lets this account ask for a
// reboot is gone, which is worth a sentence rather than a success screen.
async function askForThePowerCycle(ssh: SshSession): Promise<void> {
  try {
    await ssh.exec('sudo -n /usr/bin/systemctl reboot')
  } catch (dropped) {
    if (dropped instanceof Error && dropped.message.includes('sudo')) {
      throw new Error(
        'Bespok3d can no longer ask this printer to reboot: its administrator command list (/etc/sudoers.d/bespok3d) is missing or was changed. Run full recovery to put it back, or reboot the printer yourself.',
        { cause: dropped }
      )
    }
  }
}

const DISABLE_SERVICES: EnrollStep = {
  id: 'disable-services',
  label: 'Taking bespok3d out of the boot sequence',
  detail: 'Stops the bespok3d services and stops the printer starting them at boot',
  run: (ssh, ctx) => disableServices(ssh, ctx),
}

export const LIFECYCLE: AdapterLifecycle = {
  deactivate: [DISABLE_SERVICES],
  reactivate: [
    {
      id: 'remove-marker',
      label: 'Removing deactivated marker',
      detail: 'Clears the deactivated flag from the printer workspace',
      run: async (ssh) => { await ssh.exec(`rm -f ${shellQuote(`${bespok3dRoot(await remoteHome(ssh))}/etc/deactivated`)}`) },
    },
    {
      id: 'restore-includes',
      label: 'Restoring plugin includes',
      detail: 'Re-adds the Klipper and Moonraker include lines above the block Klipper rewrites',
      run: (ssh) => restoreIncludes(ssh),
    },
    {
      id: 'enable-services',
      label: 'Putting bespok3d back into the boot sequence',
      detail: 'Tells the printer to start the bespok3d services at boot again',
      run: (ssh, ctx) => enableServices(ssh, ctx),
    },
    START_DAEMON,
  ],
  remove: [
    DISABLE_SERVICES,
    {
      id: 'remove-system-files',
      label: 'Removing the bespok3d system changes',
      detail: 'Removes the boot services and the administrator command list',
      run: (ssh, ctx) => removeSystemFiles(ssh, ctx),
    },
    {
      id: 'remove-workspace',
      label: 'Removing bespok3d from the printer',
      detail: 'Removes the bespok3d workspace and everything in it',
      run: (ssh) => removeWorkspace(ssh),
    },
  ],
  reboot: [
    {
      id: 'power-cycle',
      label: 'Rebooting your printer',
      detail: 'Asks the printer to power cycle',
      run: (ssh) => askForThePowerCycle(ssh),
    },
  ],
}
