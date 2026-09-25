// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerAdapter } from '@adapter-sdk'
import type { AdapterDefaults, AdapterDefinition, SshSession } from '@adapter-sdk'

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

// How Bespok3d gets onto the host. It is word for word the same promise under either name, because
// the enrolment is the same code, so it is written once and read into both descriptions.
const CONNECTION_SENTENCE =
  "Connects over SSH as the printer's own user and installs Bespok3d under that user's home, using sudo only for the system services it registers."

// The vendor is shown to the user as the printer's manufacturer, next to the title. A generic
// Klipper box has no one manufacturer, and naming ourselves there would answer a question nobody
// asked: "Any maker" is the honest answer to "who made this printer".
export const ADAPTER_TITLES: Record<string, { title: string, vendor: string, description: string }> = {
  'voron-24': {
    title: 'Voron 2.4',
    vendor: 'Voron Design',
    description: `Stock Klipper adapter for a Voron 2.4 running MainsailOS, Fluidd or any KIAUH install on a Raspberry Pi class board. ${CONNECTION_SENTENCE}`,
  },
  'klipper-generic': {
    title: 'Klipper: generic',
    vendor: 'Any maker',
    description: `Stock Klipper adapter for any Klipper printer running MainsailOS, Fluidd or a KIAUH install on a 64 bit Linux host with systemd: a Raspberry Pi class board, a CB1, or an x86 mini PC. ${CONNECTION_SENTENCE}`,
  },
}

// What the enrolment screen offers before the user has typed anything. One object, shared by both
// registrations, so the two ids offer the identical starting point by construction.
const SSH_DEFAULTS: AdapterDefaults = {
  sshUser: 'pi',
  sshPort: 22,
  sshPasswordHint: 'raspberry',
  runtimeUser: 'pi',
}

// The tree hangs off the login account's home, so the root is only known once logged in. Declared
// once rather than per registration, so both ids resolve it through the same function.
async function workspaceRoot(ssh: SshSession): Promise<string> {
  return bespok3dRoot(await remoteHome(ssh))
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
    defaults: SSH_DEFAULTS,
    envVars: ENV_VARS,
    enrollSteps: enrollSteps(id),
    opSteps: OP_STEPS,
    lifecycle: LIFECYCLE,
    readDaemonLog,
    diagnoseDaemon,
    workspaceRoot,
    verifyEnrolled,
  }
}

KLIPPER_LINUX_ADAPTER_IDS.forEach((id) => registerAdapter(adapterDefinition(id)))
