import type { SshSession } from '@adapter-sdk'

import { BESPOK3D } from './paths'

// The overlayfs write layer is "active" while /oem/.debug exists; without it, writes to /oem and /etc
// are lost on the next reboot. A firmware OTA removes it, so its absence is how we tell a printer that
// was updated (needs full recovery) from one whose daemon merely glitched (a repair suffices). This is
// the single source for the flag: both enroll and the repair backstop read it through here.
export const OVERLAY_DEBUG_FLAG = '/oem/.debug'

export async function writeLayerActive(ssh: SshSession): Promise<boolean> {
  const out = await ssh.exec(`test -f ${OVERLAY_DEBUG_FLAG} && echo yes || echo no`)
  return out.trim() === 'yes'
}

// Enrolled-AND-intact: the write layer is active (so writes persist) and our workspace exists. A
// firmware OTA wipes the overlay (.debug gone, init hooks gone) while /userdata/bespok3d survives, so
// this goes false on an updated printer - the signal to recover it rather than just repair the daemon.
export async function verifyEnrolled(ssh: SshSession): Promise<boolean> {
  if (!(await writeLayerActive(ssh))) return false
  try {
    await ssh.exec(`test -d ${BESPOK3D}`)
    return true
  } catch {
    return false
  }
}
