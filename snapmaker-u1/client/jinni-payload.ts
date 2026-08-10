// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Reading ONE file out of this printer's jinni for a value the app needs about itself: the printer's
// path variables and the jinni version this adapter reports. A working copy reads the sibling
// checkout; an installed app reads the package it ships with, so the jinni travels in the app once
// and only once. Nothing read here reaches a printer: what is deployed comes from the verified
// package read in jinni-deploy.
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { app } from 'electron'

import { devSourcePath, unverifiedBundledPayload } from '@adapter-sdk'

import { ADAPTER_JINNI_PACKAGE } from './packages'

function jinniCheckoutPath(): string {
  const devOverride = devSourcePath(join('adapters', 'snapmaker-u1', 'jinni'))
  if (devOverride) return devOverride

  return join(app.getAppPath(), '..', 'adapters', 'snapmaker-u1', 'jinni')
}

export function jinniPayloadFile(payloadPath: string): string {
  const checkoutCopy = join(jinniCheckoutPath(), payloadPath)
  if (!app.isPackaged && existsSync(checkoutCopy)) return readFileSync(checkoutCopy, 'utf-8')

  return unverifiedBundledPayload(ADAPTER_JINNI_PACKAGE, payloadPath).toString('utf-8')
}
