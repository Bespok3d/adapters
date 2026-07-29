// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { lookup } from 'dns/promises'

import { connect } from '@adapter-sdk'
import type { EnrollContext } from '@adapter-sdk'

const POLL_INTERVAL_MS = 3_000
const WIFI_HINT_MS = 42_000
const GIVE_UP_MS = 300_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tryMdnsLookup(hostname: string): Promise<string | null> {
  try {
    const { address } = await lookup(`${hostname}.local`)

    return address
  } catch {
    return null
  }
}

async function tryConnect(ctx: EnrollContext): Promise<boolean> {
  try {
    const session = await connect({
      host: ctx.ip,
      port: ctx.credentials.port,
      user: ctx.credentials.user,
      password: ctx.credentials.password,
    })
    session.close()

    return true
  } catch {
    return false
  }
}

// Poll for the printer to come back after a reboot, prompting a WiFi nudge after the hint window and
// chasing a new mDNS address if the printer reconnected on a different IP. Gives up after the cap.
export async function pollReconnect(
  ctx: EnrollContext,
  hostname: string,
  start = Date.now(),
  hintSent = false
): Promise<void> {
  if (Date.now() - start >= GIVE_UP_MS)
    throw new Error('Printer did not reconnect; check WiFi and retry from this step')
  await sleep(POLL_INTERVAL_MS)
  if (await tryConnect(ctx)) return
  const elapsed = Date.now() - start
  if (!hintSent && elapsed >= WIFI_HINT_MS) {
    ctx.onProgress?.('⚠ Printer not back yet; toggle WiFi off and on again on your printer, then wait')
    const newIp = await tryMdnsLookup(hostname)
    if (newIp && newIp !== ctx.ip) {
      ctx.onProgress?.(`Printer reconnected at new IP ${newIp}; updating`)
      ctx.ip = newIp

      return
    }

    return pollReconnect(ctx, hostname, start, true)
  }

  return pollReconnect(ctx, hostname, start, hintSent)
}
