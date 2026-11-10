// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'

// Values as one argument list on a shell command line, each quoted on its own.
export function shellArguments(values: readonly string[]): string {
  return values.map(shellQuote).join(' ')
}
