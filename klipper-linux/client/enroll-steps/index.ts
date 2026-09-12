// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import type { EnrollStep } from '@adapter-sdk'

import { uploadAdapterJinni } from '../jinni-deploy'
import { stepDiscoverLayout } from '../layout'
import { stepPreflight } from '../preflight'
import { stepInstallServices } from '../systemd'

import { stepEnrollDaemonKey, stepGenerateDaemonCert } from './app-link'
import { stepDeployDaemon } from './daemon-install'
import { stepStartDaemon, stepVerify } from './final-checks'
import { stepKlipperIncludes } from './includes'
import { stepCreateWorkspace } from './workspace'

// The enrolment recipe: the ordered list of what turns a Klipper printer into a Bespok3d printer, with
// the plain-language description of each step the app shows while it runs. The steps themselves live
// in the sibling files, one per topic; this file is only the running order.
//
// Every step is idempotent: enrolling the same printer twice leaves it exactly as enrolling it once
// did. That is what makes "run it again" a real answer when a step fails halfway.

const PREFLIGHT: EnrollStep = {
  id: 'preflight',
  label: 'Checking the printer',
  detail:
    'Confirms the printer is a 64-bit Linux host with systemd, Klipper, Moonraker and Python 3.11 or newer, that it is not mid-print, and that this account can use sudo, before making any changes.',
  run: (ssh, ctx) => stepPreflight(ssh, ctx),
}

const CREATE_WORKSPACE: EnrollStep = {
  id: 'create-workspace',
  label: 'Creating the bespok3d workspace',
  detail:
    'Creates the bespok3d directory tree in the login account home directory, owned by that account, so nothing Bespok3d writes from here on needs administrator rights.',
  run: (ssh) => stepCreateWorkspace(ssh),
}

const DEPLOY_DAEMON: EnrollStep = {
  id: 'deploy-daemon',
  label: 'Deploying the bespok3d daemon',
  detail:
    'Uploads the daemon and the device adapter, then gives the daemon its own Python environment with its packages. Klipper, Moonraker and the system Python are never touched.',
  run: (ssh, ctx) => stepDeployDaemon(ssh, ctx),
}

const KLIPPER_INCLUDES: EnrollStep = {
  id: 'klipper-includes',
  label: 'Connecting Klipper and Moonraker to the plugin system',
  detail:
    'Adds one include line to the printer Klipper config and one to the Moonraker config, above the block Klipper rewrites, so plugins can contribute settings. Both are idempotent.',
  run: (ssh) => stepKlipperIncludes(ssh),
}

const INSTALL_SERVICES: EnrollStep = {
  id: 'install-services',
  label: 'Registering the bespok3d services',
  detail:
    'Installs the two system services that start Bespok3d and its plugins at boot, plus a closed list of exactly the commands it may later run as administrator. The list is checked for syntax before it is installed.',
  run: (ssh, ctx) => stepInstallServices(ssh, ctx),
}

const GENERATE_DAEMON_CERT: EnrollStep = {
  id: 'generate-daemon-cert',
  label: 'Generating daemon TLS certificate',
  detail:
    'Has the printer create its own certificate and keep the private half. The app pins the public half in your printer record, so from here on it can tell this printer from any other.',
  run: (ssh, ctx) => stepGenerateDaemonCert(ssh, ctx),
}

const ENROLL_DAEMON_KEY: EnrollStep = {
  id: 'enroll-daemon-key',
  label: 'Enrolling access credentials',
  detail:
    'Writes your token and public key into the printer access list. Only devices holding this token can reach the daemon.',
  run: (ssh, ctx) => stepEnrollDaemonKey(ssh, ctx),
}

// Exported because switching Bespok3d back on starts the daemon the way enrolment does, and it is the
// SAME step object rather than a second copy of the command, so the two can never drift apart.
export const START_DAEMON: EnrollStep = {
  id: 'start-daemon',
  label: 'Starting the daemon',
  detail:
    'Starts the bespok3d service and the plugin service, then waits for the printer to report the daemon running. Shows the daemon log if it does not come up.',
  run: (ssh) => stepStartDaemon(ssh),
}

const VERIFY: EnrollStep = {
  id: 'verify',
  label: 'Verifying the installation',
  detail:
    'Checks that the workspace, the boot services and the running daemon are all in place, then removes the administrator password from the printer.',
  run: (ssh) => stepVerify(ssh),
}

// The one step that differs between this adapter's two registered ids: the id it was enrolled under is
// written into the printer layout file, and the jinni reports itself under it from then on.
function discoverLayout(adapterId: string): EnrollStep {
  return {
    id: 'discover-layout',
    label: 'Finding Klipper and Moonraker',
    detail:
      'Reads where Klipper, Moonraker, their configs and their logs actually live on this printer, out of the printer own service files, and records it for the daemon.',
    run: (ssh, ctx) => stepDiscoverLayout(ssh, ctx, adapterId),
  }
}

export function enrollSteps(adapterId: string): EnrollStep[] {
  return [
    PREFLIGHT,
    CREATE_WORKSPACE,
    DEPLOY_DAEMON,
    discoverLayout(adapterId),
    KLIPPER_INCLUDES,
    INSTALL_SERVICES,
    GENERATE_DAEMON_CERT,
    ENROLL_DAEMON_KEY,
    START_DAEMON,
    VERIFY,
  ]
}

// Maintenance steps run by ops (not part of the enrol sequence). deploy-jinni re-uploads only the
// device-side adapter (jinni), a subset of deploy-daemon, for the standalone jinni update.
export const OP_STEPS: EnrollStep[] = [
  {
    id: 'deploy-jinni',
    label: 'Updating the adapter jinni',
    detail:
      'Re-uploads the device-side adapter (jinni) next to the daemon. The daemon source, certificate and plugins are left untouched.',
    run: (ssh, ctx) => uploadAdapterJinni(ssh, ctx),
  },
]
