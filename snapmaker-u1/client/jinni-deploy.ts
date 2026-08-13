// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { removePackageEntries, uploadPayload } from './package-deploy'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import type { ProgressSpan } from './step-progress'
import { DAEMON_BASE } from './paths'

// Deploying the jinni onto the printer, out of the signed jinni package: the published one when the
// lists offer a jinni newer than this build ships, because a daemon release can need a newer jinni
// and the pair has to be able to move without an app release. Since the ADR-0037 split the jinni has
// two halves, and the package carries both: the SHARED klipper jinni runtime (the `jinni` package)
// and this DEVICE adapter's jinni (`bespok3d_jinni`). The daemon spawns `python -m jinni` and the
// device jinni imports `from jinni import ...`, so both co-locate next to the daemon under
// DAEMON_BASE, which is the layout the package already has. Enrollment and the standalone
// jinni-update op both run this.
// progressSpan is the slice of the bar the jinni owns when it is one phase of a longer step; the
// standalone jinni update leaves it out, because there the jinni IS the step.
export async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext, progressSpan?: ProgressSpan): Promise<void> {
  const signedPackage = await openSystemPackage(ADAPTER_JINNI_PACKAGE)
  await removePackageEntries(ssh, DAEMON_BASE, signedPackage.payloadPaths)
  await uploadPayload({
    ssh,
    signedPackage,
    remoteBase: DAEMON_BASE,
    payloadPaths: signedPackage.payloadPaths,
    progressLabel: 'Uploading jinni…',
    onProgress: ctx.onProgress,
    progressSpan,
  })
}
