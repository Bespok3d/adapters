// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'fs'
import { join } from 'path'

import { adapterJinniPath } from './paths'

// The jinni version lives in ONE place: version.json in the jinni dir. The device-side jinni reads it
// at runtime and the client reads the same file here, so the two halves can never drift. The app
// derives its expected version from this (via the adapter SDK), so there is no app-side constant to
// keep in sync.
export const JINNI_VERSION: string = JSON.parse(readFileSync(join(adapterJinniPath(), 'version.json'), 'utf-8')).jinni_version
