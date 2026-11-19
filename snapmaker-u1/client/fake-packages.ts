// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The daemon and jinni packages, as tests see them: a handful of paths whose bytes name the package
// they came from, so a file on the fake printer proves which package put it there.
import type { BundledPackage } from '@adapter-sdk'

import { ADAPTER_JINNI_PACKAGE, DAEMON_PACKAGE } from './packages'

export const DAEMON_PAYLOAD = [
  'daemon.py',
  'version.py',
  'api/routes.py',
  'core/state.py',
  'core/legacy.py',
  'wheels/fastapi-0.115.0-py3-none-any.whl',
  's10bespok3d-daemon',
  'S99bespok3d',
]

export const JINNI_PAYLOAD = ['bespok3d_jinni.py', 'jinni/board.py', 'paths.json', 'version.json']

const PAYLOADS: Record<string, readonly string[]> = {
  [DAEMON_PACKAGE]: DAEMON_PAYLOAD,
  [ADAPTER_JINNI_PACKAGE]: JINNI_PAYLOAD,
}

export function packagedContent(packageName: string, payloadPath: string): string {
  return `from ${packageName}: ${payloadPath}`
}

// The signed manifest a package carries, naming the fingerprint it was packed with.
export function packagedManifest(packageName: string, fingerprint = `${packageName} as shipped`): string {
  return JSON.stringify({ name: packageName, fingerprint })
}

// A release is the shipped payload with some files edited (`edited`), some left out (`dropped`), and
// some new ones (`added`), packed with its own fingerprint (`fingerprint`).
export interface PackageRelease {
  edited?: Record<string, string>
  dropped?: readonly string[]
  added?: Record<string, string>
  fingerprint?: string
}

export function fakePackage(packageName: string, release: PackageRelease = {}): BundledPackage {
  const shippedPayload = PAYLOADS[packageName]
  if (shippedPayload === undefined) throw new Error(`unexpected package ${packageName}`)
  const shippedPaths = shippedPayload.filter((payloadPath) => !release.dropped?.includes(payloadPath))
  const payloadPaths = [...shippedPaths, ...Object.keys(release.added ?? {})]

  return {
    name: packageName,
    version: '0.0.0',
    trust: 'unknown',
    payloadPaths,
    payloadBytes: (payloadPath: string) => Buffer.from(release.edited?.[payloadPath] ?? release.added?.[payloadPath] ?? packagedContent(packageName, payloadPath)),
    manifestBytes: () => Buffer.from(packagedManifest(packageName, release.fingerprint)),
  }
}
