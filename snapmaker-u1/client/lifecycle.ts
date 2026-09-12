// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AdapterLifecycle, EnrollStep, SshSession } from '@adapter-sdk'

import { ENROLL_STEPS } from './enroll-steps'
import { bespok3dIncludeCommand, KLIPPER_INCLUDE, MOONRAKER_INCLUDE } from './klipper-includes'
import { BESPOK3D, PRINTER_DATA } from './paths'
import { patchS90lmd } from './stock-patches'

// What switching bespok3d off, back on, removing it, and power cycling do to a U1's own filesystem.
// The app owns the daemon side of each operation (stopping the plugins, tearing them down, the waits)
// and asks the adapter for this half: which boot script carries the hook, which files a removal has to
// put back, and what a reboot is spelled as are device knowledge, and belong with the device.

const DAEMON_LOG_TAIL_LINES = 200

async function restoreIncludes(ssh: SshSession): Promise<void> {
  await ssh.exec(bespok3dIncludeCommand(`${PRINTER_DATA}/config/printer.cfg`, KLIPPER_INCLUDE))
  await ssh.exec(bespok3dIncludeCommand(`${PRINTER_DATA}/config/moonraker.conf`, MOONRAKER_INCLUDE))
}

async function restoreBootHook(ssh: SshSession): Promise<void> {
  const stockBootScript = await ssh.getContent('/etc/init.d/S90lmd')
  const patched = patchS90lmd(stockBootScript)
  if (patched !== stockBootScript) await ssh.putContent('/etc/init.d/S90lmd', patched)
}

// The printer drops the link the moment it starts going down, so the exec never returns cleanly:
// that dropped connection IS the reboot happening, not a failure to report to the user.
async function askForThePowerCycle(ssh: SshSession): Promise<void> {
  try {
    await ssh.exec('reboot')
  } catch {
    /* the connection dies as the printer goes down; expected */
  }
}

// Switching bespok3d back on starts the daemon the way enrollment does, and it is the SAME step
// object rather than a second copy of the command, so the two can never drift apart.
function enrollStep(stepId: string): EnrollStep {
  const step = ENROLL_STEPS.find((candidate) => candidate.id === stepId)
  if (!step) throw new Error(`snapmaker-u1 has no ${stepId} step`)

  return step
}

// The SSH-side reversal of enrollment for a clean removal. Kept as one named, testable string because a
// regression here strands the printer: the dhcpcd state dir must be RECREATED (a dangling symlink leaves
// it with no lease and no network on the next boot), and /oem/.debug must be REMOVED (re-locking the
// overlay so the next boot resets the write layer to stock). Mirrors reset-to-stock.invitro.ts.
export function bespok3dRemovalCommand(): string {
  return (
    `sed -i '/S99bespok3d/d' /etc/init.d/S90lmd` +
    ` && sed -i '/bespok3d\\/etc\\/nginx\\/locations/d' /etc/nginx/sites-enabled/fluidd` +
    ` && rm -f /etc/init.d/S99bespok3d` +
    ` && rm -f /etc/udev/rules.d/70-wlan0-mac.rules` +
    ` ; rm -f /var/db/dhcpcd ; mkdir -p /var/db/dhcpcd` +
    ` ; rm -rf /userdata/bespok3d` +
    ` ; rm -f /oem/.debug`
  )
}

export const LIFECYCLE: AdapterLifecycle = {
  deactivate: [
    {
      id: 'remove-boot-hook',
      label: 'Removing boot hook',
      detail: 'Removes the S99bespok3d call from the firmware boot script',
      run: async (ssh) => { await ssh.exec("sed -i '/S99bespok3d/d' /etc/init.d/S90lmd") },
    },
  ],
  reactivate: [
    {
      id: 'remove-marker',
      label: 'Removing deactivated marker',
      detail: 'Clears the deactivated flag from the printer workspace',
      run: async (ssh) => { await ssh.exec(`rm -f ${BESPOK3D}/etc/deactivated`) },
    },
    {
      id: 'restore-includes',
      label: 'Restoring plugin includes',
      detail: 'Re-adds Klipper and Moonraker include lines above the SAVE_CONFIG boundary',
      run: (ssh) => restoreIncludes(ssh),
    },
    {
      id: 'restore-boot-hook',
      label: 'Restoring boot hook',
      detail: 'Re-patches S90lmd to invoke S99bespok3d at boot',
      run: (ssh) => restoreBootHook(ssh),
    },
    enrollStep('start-daemon'),
  ],
  remove: [
    {
      id: 'remove-files',
      label: 'Removing bespok3d from the printer',
      detail: 'Removes all bespok3d files and system configuration changes',
      run: async (ssh) => { await ssh.exec(bespok3dRemovalCommand()) },
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

// The daemon's own log, for the screen that reports a daemon which did not come up.
export function readDaemonLog(ssh: SshSession): Promise<string> {
  return ssh.exec(`tail -${DAEMON_LOG_TAIL_LINES} ${BESPOK3D}/var/log/daemon.log 2>/dev/null || true`)
}

// One line naming what is wrong with a daemon that will not start, shown as a progress hint before a
// repair redeploys it. Every check is a U1 fact: where the daemon lives, the legacy `demon` spelling a
// past deploy left behind, and the busybox netstat that reports the listening port.
export function diagnoseDaemon(ssh: SshSession): Promise<string> {
  return ssh.exec(
    `out=""; ` +
    `[ -d ${BESPOK3D}/var/lib/demon ] && out="$out stale-demon-dir"; ` +
    `[ -f ${BESPOK3D}/var/lib/daemon/daemon.py ] || out="$out missing-daemon.py"; ` +
    `grep -q 'var/lib/demon' ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon 2>/dev/null && out="$out wrong-autostart-path"; ` +
    `netstat -ltnp 2>/dev/null | grep -q ':4269 ' && out="$out port-4269-occupied"; ` +
    `[ -z "$out" ] && out=" no-issues-detected"; ` +
    `echo "Diagnosis:$out"`
  )
}
