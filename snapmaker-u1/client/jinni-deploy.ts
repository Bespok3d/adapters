// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openBundledPackage } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { removePackageEntries, uploadPayload } from './package-deploy'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import { DAEMON_BASE } from './paths'

// Deploying the jinni onto the printer, out of the signed package this build ships with and out of
// nothing else. Since the ADR-0037 split the jinni has two halves, and the package carries both: the
// SHARED klipper jinni runtime (the `jinni` package) and this DEVICE adapter's jinni
// (`bespok3d_jinni`). The daemon spawns `python -m jinni` and the device jinni imports
// `from jinni import ...`, so both co-locate next to the daemon under DAEMON_BASE, which is the
// layout the package already has. Enrollment and the standalone jinni-update op both run this.
export async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const signedPackage = await openBundledPackage(ADAPTER_JINNI_PACKAGE)
  await removePackageEntries(ssh, DAEMON_BASE, signedPackage.payloadPaths)
  await uploadPayload({
    ssh,
    signedPackage,
    remoteBase: DAEMON_BASE,
    payloadPaths: signedPackage.payloadPaths,
    progressLabel: 'Uploading jinni…',
    onProgress: ctx.onProgress,
  })
}
