// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { BundledPackage, SshSession } from '@adapter-sdk'

import { DAEMON_BASE } from './paths'
import { shellArguments } from './shell-arguments'

// The printer keeps the signed manifest of each machinery package it runs, one file named after the
// package, so the daemon can report the fingerprint each one carried and the app can offer any build
// that differs. The directory is outside every package's payload on purpose: a full send
// clears the entries a package owns, and a manifest kept among them would go with them.
const MANIFEST_DIR = `${DAEMON_BASE}/manifests`

// The mode the payload's own files land with.
const MANIFEST_MODE = '644'

function manifestPathOf(packageName: string): string {
  return `${MANIFEST_DIR}/${packageName}.json`
}

// Called once the package's payload is in place, so a run cut short leaves the fingerprint of the
// package installed before it, and the app offers the same update again.
export async function keepSignedManifests(ssh: SshSession, signedPackages: readonly BundledPackage[]): Promise<void> {
  const manifestPaths = signedPackages.map((signedPackage) => manifestPathOf(signedPackage.name))
  await ssh.exec(`mkdir -p ${shellArguments([MANIFEST_DIR])}`)
  await Promise.all(signedPackages.map((signedPackage) => ssh.putBytes(manifestPathOf(signedPackage.name), signedPackage.manifestBytes())))
  await ssh.exec(`chmod ${MANIFEST_MODE} ${shellArguments(manifestPaths)}`)
}
