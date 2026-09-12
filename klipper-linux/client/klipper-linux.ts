// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerAdapter } from '@adapter-sdk'
import type { AdapterDefinition } from '@adapter-sdk'

import { enrollSteps, OP_STEPS } from './enroll-steps'
import { diagnoseDaemon, readDaemonLog, verifyEnrolled } from './enrolled'
import { ENV_VARS } from './env-vars'
import { LIFECYCLE } from './lifecycle'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import { bespok3dRoot } from './paths'
import { remoteHome } from './remote'
import { JINNI_VERSION } from './version'

// One adapter, two names. A Voron 2.4 and a printer somebody built themselves out of the same parts
// run the identical software on the identical kind of host, so they enrol through the identical code;
// what differs is only what a person looking for their printer in a list expects to read. Registering
// twice is what lets the picker say "Voron 2.4" to the person who owns one, without a second
// implementation to keep in step with this one.

export const KLIPPER_LINUX_ADAPTER_IDS = ['voron-24', 'klipper-generic']

const COMMON_DESCRIPTION =
  "running MainsailOS, Fluidd or any KIAUH install on a Raspberry Pi class board. Connects over SSH as the printer's own user and installs Bespok3d under that user's home, using sudo only for the system services it registers."

export const ADAPTER_TITLES: Record<string, { title: string, vendor: string, description: string }> = {
  'voron-24': {
    title: 'Voron 2.4',
    vendor: 'Voron Design',
    description: `Stock Klipper adapter for a Voron 2.4 ${COMMON_DESCRIPTION}`,
  },
  'klipper-generic': {
    title: 'Klipper: generic',
    vendor: 'Bespok3d',
    description: `Stock Klipper adapter for any Klipper printer ${COMMON_DESCRIPTION}`,
  },
}

// Everything that is the same for both ids, in one place, so the two registrations cannot drift.
export function adapterDefinition(id: string): AdapterDefinition {
  return {
    id,
    ...ADAPTER_TITLES[id],
    version: '0.1.0',
    jinniVersion: JINNI_VERSION,
    jinniPackage: ADAPTER_JINNI_PACKAGE,
    // A Raspberry Pi class board is answering again about a minute after it is told to restart.
    restartSeconds: 60,
    defaults: {
      sshUser: 'pi',
      sshPort: 22,
      sshPasswordHint: 'raspberry',
      runtimeUser: 'pi',
    },
    envVars: ENV_VARS,
    enrollSteps: enrollSteps(id),
    opSteps: OP_STEPS,
    lifecycle: LIFECYCLE,
    readDaemonLog,
    diagnoseDaemon,
    // The tree hangs off the login account's home, so the root is only known once logged in.
    workspaceRoot: async (ssh) => bespok3dRoot(await remoteHome(ssh)),
    verifyEnrolled,
  }
}

KLIPPER_LINUX_ADAPTER_IDS.forEach((id) => registerAdapter(adapterDefinition(id)))
