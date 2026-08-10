// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { registerAdapter } from '@adapter-sdk'

import { ENV_VARS } from './env-vars'
import { ENROLL_STEPS, OP_STEPS } from './enroll-steps'
import { SNAPMAKER_U1_ICON } from './icon'
import { verifyEnrolled } from './overlay'
import { ADAPTER_JINNI_PACKAGE } from './packages'
import { JINNI_VERSION } from './version'

// The adapter's public surface, consumed by the app's main process (patchS90lmd) and the adapter
// tests, re-exported from the concern modules so importers keep a single entry point.
export { patchNginx, patchS90lmd } from './stock-patches'
export { bespok3dIncludeCommand, KLIPPER_INCLUDE, MOONRAKER_INCLUDE } from './klipper-includes'
export { isPrinting } from './print-state'
export { writeLayerActive, verifyEnrolled } from './overlay'

registerAdapter({
  id: 'snapmaker-u1',
  title: 'Snapmaker U1',
  vendor: 'Snapmaker',
  version: '1.1.0',
  jinniVersion: JINNI_VERSION,
  jinniPackage: ADAPTER_JINNI_PACKAGE,
  description:
    'Stock firmware adapter for the Snapmaker U1. Connects via SSH as root and installs bespok3d on top of the OEM system without modifying firmware.',
  icon: SNAPMAKER_U1_ICON,
  defaults: {
    sshUser: 'root',
    sshPort: 22,
    sshPasswordHint: 'snapmaker',
    runtimeUser: 'lava',
  },
  envVars: ENV_VARS,
  enrollSteps: ENROLL_STEPS,
  opSteps: OP_STEPS,
  verifyEnrolled,
})
