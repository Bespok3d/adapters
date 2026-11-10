// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The project and the version a wheel file or a dist-info dir names. Both start with "<name>-<version>",
// and neither part holds a "-".

// PEP 503 names match case-insensitively, any run of "-", "_" or "." being one separator.
export function projectName(nameVersionStem: string): string {
  return nameVersionStem.split('-')[0].toLowerCase().replace(/[-_.]+/g, '_')
}

export function projectVersion(nameVersionStem: string): string {
  return (nameVersionStem.split('-')[1] ?? '').toLowerCase()
}

export function distributionKey(nameVersionStem: string): string {
  return `${projectName(nameVersionStem)}-${projectVersion(nameVersionStem)}`
}
