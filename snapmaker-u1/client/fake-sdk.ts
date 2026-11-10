// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// The SDK surface the client's modules reach for in tests, for a test's `@adapter-sdk` mock to spread
// and add to: the real loader drags electron's window machinery in behind it.

// The SDK's own quoting, character for character, so the commands a test reads are the ones a printer gets.
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}

export function devSourcePath(): undefined {
  return undefined
}

export function unverifiedBundledPayload(): never {
  throw new Error('the checkout copy is what this test reads')
}
