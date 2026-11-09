// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { OVERLAY_DEBUG_FLAG, writeLayerActive } from '../overlay'
import { pollReconnect } from '../reconnect'
import {
  WIFI_CREDENTIAL_SOURCES,
  WIFI_LIVE_CONFIG,
  WIFI_PERSISTENT_CONFIG,
  wifiPersistenceCommand,
} from '../wifi-persistence'

// Opening the printer's write layer. Stock U1 firmware runs its system on an overlayfs whose upper
// layer the boot wipes unless /oem/.debug is present, so every later step here would be lost on
// reboot without this. Once the flag is set that layer is kept, so the screen's saved Wi-Fi goes into
// /etc first and the kept layer starts with a Wi-Fi config that connects.

export async function stepUnlockOverlay(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  ctx.overlayWasActive = await writeLayerActive(ssh)
  await ssh.exec(
    `cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf 2>/dev/null || true` +
      ` && touch ${OVERLAY_DEBUG_FLAG}`
  )
}

export async function stepFixWifiPersistence(ssh: SshSession): Promise<void> {
  await ssh.exec(wifiPersistenceCommand(WIFI_LIVE_CONFIG, WIFI_PERSISTENT_CONFIG, WIFI_CREDENTIAL_SOURCES))
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
