// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { removePackageEntries, uploadPayload } from './package-deploy'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import { daemonBase } from './paths'
import { remoteHome } from './remote'
import type { ProgressSpan } from './step-progress'

// Deploying the jinni onto the printer, out of the signed jinni package: the published one when the
// lists offer a jinni newer than this build ships, because a daemon release can need a newer jinni
// and the pair has to be able to move without an app release. The package carries both halves, the
// SHARED klipper jinni runtime (the `jinni` package) and this DEVICE adapter's jinni
// (`bespok3d_jinni`), and both co-locate next to the daemon: the daemon spawns `python -m jinni` and
// the device jinni imports `from jinni import ...`.
//
// It also carries the layout discovery the enrolment runs a few steps later, and the unit, sudoers
// and boot script templates install-services renders, which is why this lands before either of them.
//
// progressSpan is the slice of the bar the jinni owns when it is one phase of a longer step; the
// standalone jinni update leaves it out, because there the jinni IS the step.
export async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext, progressSpan?: ProgressSpan): Promise<void> {
  const remoteBase = daemonBase(await remoteHome(ssh))
  const signedPackage = await openSystemPackage(ADAPTER_JINNI_PACKAGE)
  await removePackageEntries(ssh, remoteBase, signedPackage.payloadPaths)
  await uploadPayload({
    ssh,
    signedPackage,
    remoteBase,
    payloadPaths: signedPackage.payloadPaths,
    progressLabel: 'Uploading jinni…',
    onProgress: ctx.onProgress,
    progressSpan,
  })
}
