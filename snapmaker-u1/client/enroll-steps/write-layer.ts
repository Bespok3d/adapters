import type { SshSession, EnrollContext } from '@adapter-sdk'

import { OVERLAY_DEBUG_FLAG, writeLayerActive } from '../overlay'
import { pollReconnect } from '../reconnect'

// Opening the printer's write layer. Stock U1 firmware mounts /oem and /etc read-only over an
// overlayfs whose upper layer only exists while /oem/.debug is present, so every later step here
// would be silently discarded on reboot without this. The WiFi copy runs BEFORE the flag because
// wpa-conf.sh writes credentials into that same disposable upper layer.

export async function stepUnlockOverlay(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  ctx.overlayWasActive = await writeLayerActive(ssh)
  await ssh.exec(
    `cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf 2>/dev/null || true` +
      ` && touch ${OVERLAY_DEBUG_FLAG}`
  )
}

export async function stepFixWifiPersistence(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `mkdir -p /userdata/cfg` +
      ` && { { grep -q 'network=' /tmp/wpa_supplicant.conf 2>/dev/null` +
      `         && cp -p /tmp/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; }` +
      `       || { grep -q 'network=' /etc/wpa_supplicant.conf 2>/dev/null` +
      `             && cp -p /etc/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; }` +
      `       || true; }` +
      ` && grep -q 'network=' /userdata/cfg/wpa_config.conf 2>/dev/null` +
      ` && ln -sf /userdata/cfg/wpa_config.conf /etc/wpa_supplicant.conf` +
      ` || true`
  )
}

export async function stepRebootAndReconnect(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  if (ctx.overlayWasActive) {
    ctx.onProgress?.('Overlay already active; skipping reboot')

    return
  }
  const hostname = (await ssh.exec('hostname')).trim()
  try {
    await ssh.exec('reboot')
  } catch {
    /* connection dies on reboot; expected */
  }
  ctx.onProgress?.('Waiting for printer to reboot...')
  await pollReconnect(ctx, hostname)
}
