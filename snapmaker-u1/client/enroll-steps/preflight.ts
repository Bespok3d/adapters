import type { SshSession } from '@adapter-sdk'

import { printerIsPrinting } from '../print-state'

// Refuse before touching the printer, on two grounds. The firmware sniff is an SSH filesystem check
// because firmware identity is this adapter's concern: Bespok3d's U1 adapter targets the stock
// firmware (the Extended firmware ships /usr/local/bin/extended-config.py and conflicts). The
// mid-print check is a normal Moonraker HTTP call, because enrolling restarts services + reboots and
// must not run mid-print.
export async function stepPreflight(ssh: SshSession): Promise<void> {
  const firmware = (await ssh.exec('[ -e /usr/local/bin/extended-config.py ] && echo extended || echo stock')).trim()
  if (firmware === 'extended') {
    throw new Error('This printer runs the Extended firmware, which Bespok3d is not compatible with. Please revert to the stock Snapmaker firmware, then enroll.')
  }
  if (await printerIsPrinting(ssh.host)) {
    throw new Error('The printer is printing or paused. Enrolling restarts services and reboots the printer, so wait for the print to finish, then enroll.')
  }
}
