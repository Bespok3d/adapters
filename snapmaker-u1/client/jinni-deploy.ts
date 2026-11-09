// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { syncPayload } from './package-deploy'
import type { PayloadSource } from './package-deploy'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import { DAEMON_BASE } from './paths'

// Deploying the jinni onto the printer, out of the signed jinni package: the published one when the
// lists offer a jinni newer than this build ships, because a daemon release can need a newer jinni
// and the pair has to be able to move without an app release. Since the ADR-0037 split the jinni has
// two halves, and the package carries both: the SHARED klipper jinni runtime (the `jinni` package)
// and this DEVICE adapter's jinni (`bespok3d_jinni`). The daemon spawns `python -m jinni` and the
// device jinni imports `from jinni import ...`, so both co-locate next to the daemon under
// DAEMON_BASE, which is the layout the package already has. The daemon step sends it in the daemon's
// own stream; the standalone jinni-update op sends it alone.
export async function openJinniSource(): Promise<PayloadSource> {
  const signedPackage = await openSystemPackage(ADAPTER_JINNI_PACKAGE)

  return { signedPackage, payloadPaths: signedPackage.payloadPaths }
}

export async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await syncPayload({
    ssh,
    remoteBase: DAEMON_BASE,
    sources: [await openJinniSource()],
    sendChangedFilesOnly: ctx.sendChangedFilesOnly,
    progressLabel: 'Uploading jinni…',
    onProgress: ctx.onProgress,
  })
}
