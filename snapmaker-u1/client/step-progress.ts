// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a phase of a step sits on that step's own progress bar.

// A step made of several phases in a row hands each phase the slice of the bar it owns, so the bar
// only ever moves forward as the phases run.
export interface ProgressSpan {
  from: number
  to: number
}

// A phase's own 0..1 progress, placed on the slice of the step it owns. No slice means the phase is
// the whole step, so its progress is the step's.
export function spanFraction(span: ProgressSpan | undefined, phaseFraction: number): number {
  if (!span) return phaseFraction

  return span.from + (span.to - span.from) * phaseFraction
}
