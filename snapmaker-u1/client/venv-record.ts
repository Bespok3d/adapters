// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether the packages in the daemon's venv still hold the files pip wrote, judged on the printer
// against each package's RECORD, whether each was installed from the payload wheel of its name, whether
// the venv's own pip is whole, and which payload wheels that leaves to install again.
import { posix } from 'path'

import { shellQuote } from '@adapter-sdk'

import { RECORD_CHECK_SCRIPT } from './record-check-script'
import { shellArguments } from './shell-arguments'
import { distributionKey, projectName } from './wheel-names'

const DISTRIBUTION_STATES = ['intact', 'damaged', 'unrecorded'] as const
export type DistributionState = typeof DISTRIBUTION_STATES[number]

export interface InstalledDistribution {
  state: DistributionState
  // Which wheel the package was installed from; null when its RECORD is gone or unreadable.
  recordFingerprint: string | null
  distInfoPath: string
}

export interface RecordCheck {
  installed: InstalledDistribution[]
  // The fingerprint of each wheel's own RECORD, by the wheel's path; null when the wheel cannot be read.
  wheelFingerprints: ReadonlyMap<string, string | null>
}

const CHECK_LINE_KINDS = ['installed', 'wheel'] as const
type CheckLineKind = typeof CHECK_LINE_KINDS[number]

const PIP_PROJECT = 'pip'
const NO_FINGERPRINT = '-'
const RECORD_FINGERPRINT = /^([0-9a-f]{64}|-)$/

export interface VenvRepair {
  // The payload wheels whose package is missing, broken, or installed from other bytes, to install again.
  wheelPaths: string[]
  // The dist-info dirs whose RECORD is gone or unreadable: pip refuses to uninstall them, so they go first.
  unrecordedDistInfos: string[]
}

// The venv's own python walks the venv's own site-packages and reads the RECORD inside each wheel named;
// -I keeps the environment and the working directory out of what it imports.
export function recordCheckCommand(venvDir: string, remoteWheelPaths: readonly string[]): string {
  return `${shellQuote(`${venvDir}/bin/python3`)} -I -c ${shellQuote(RECORD_CHECK_SCRIPT)} ${shellArguments(remoteWheelPaths)}`
}

function isDistributionState(state: string): state is DistributionState {
  return (DISTRIBUTION_STATES as readonly string[]).includes(state)
}

function unreadableLine(checkLine: string): Error {
  return new Error(`Unreadable venv package check line: ${checkLine}`)
}

function fingerprintOf(fingerprintField: string, checkLine: string): string | null {
  if (!RECORD_FINGERPRINT.test(fingerprintField)) throw unreadableLine(checkLine)

  return fingerprintField === NO_FINGERPRINT ? null : fingerprintField
}

function installedDistributionOf(checkLine: string): InstalledDistribution {
  const [, state, fingerprintField, ...distInfoPathParts] = checkLine.split('\t')
  const distInfoPath = distInfoPathParts.join('\t')
  if (!isDistributionState(state) || distInfoPath === '') throw unreadableLine(checkLine)

  return { state, recordFingerprint: fingerprintOf(fingerprintField, checkLine), distInfoPath }
}

function wheelFingerprintOf(checkLine: string): [string, string | null] {
  const [, fingerprintField, ...wheelPathParts] = checkLine.split('\t')
  const wheelPath = wheelPathParts.join('\t')
  if (wheelPath === '') throw unreadableLine(checkLine)

  return [wheelPath, fingerprintOf(fingerprintField, checkLine)]
}

function lineKindOf(checkLine: string): string {
  return checkLine.split('\t')[0]
}

function checkLinesOfKind(checkLines: readonly string[], lineKind: CheckLineKind): string[] {
  return checkLines.filter((checkLine) => lineKindOf(checkLine) === lineKind)
}

export function parseRecordCheck(checkOutput: string): RecordCheck {
  const checkLines = checkOutput.split('\n').filter((checkLine) => checkLine.trim() !== '')
  const unknownLine = checkLines.find((checkLine) => !(CHECK_LINE_KINDS as readonly string[]).includes(lineKindOf(checkLine)))
  if (unknownLine !== undefined) throw unreadableLine(unknownLine)

  return {
    installed: checkLinesOfKind(checkLines, 'installed').map(installedDistributionOf),
    wheelFingerprints: new Map(checkLinesOfKind(checkLines, 'wheel').map(wheelFingerprintOf)),
  }
}

function distInfoStem(distribution: InstalledDistribution): string {
  return posix.basename(distribution.distInfoPath, '.dist-info')
}

// A package counts as installed from this wheel only when its RECORD matches the wheel's own: a wheel
// rebuilt at the same version carries other files under the same name.
function wheelIsWhole(wheelPath: string, check: RecordCheck): boolean {
  const wheelFingerprint = check.wheelFingerprints.get(wheelPath) ?? null
  const wheelKey = distributionKey(posix.basename(wheelPath))
  const wheelDistributions = check.installed.filter((distribution) => distributionKey(distInfoStem(distribution)) === wheelKey)

  return wheelFingerprint !== null && wheelDistributions.length > 0 &&
    wheelDistributions.every((distribution) => distribution.state === 'intact' && distribution.recordFingerprint === wheelFingerprint)
}

// pip uninstalls whichever version of a project is installed before it installs the wheel, so a dist-info
// without a RECORD blocks a wheel of any version of the same project.
function unrecordedOfProjects(brokenWheels: readonly string[], installed: readonly InstalledDistribution[]): string[] {
  const brokenProjects = new Set(brokenWheels.map((wheelPath) => projectName(posix.basename(wheelPath))))

  return installed
    .filter((distribution) => distribution.state === 'unrecorded' && brokenProjects.has(projectName(distInfoStem(distribution))))
    .map((distribution) => distribution.distInfoPath)
}

// pip installs every other package, so a pip that still starts with a file lost or changed cannot be
// trusted with them. A venv with no record of pip at all is no better.
export function pipIsWhole(check: RecordCheck): boolean {
  const pipDistributions = check.installed.filter((distribution) => projectName(distInfoStem(distribution)) === PIP_PROJECT)

  return pipDistributions.length > 0 && pipDistributions.every((distribution) => distribution.state === 'intact')
}

export function venvRepair(wheelPaths: readonly string[], check: RecordCheck): VenvRepair {
  const brokenWheels = wheelPaths.filter((wheelPath) => !wheelIsWhole(wheelPath, check))

  return { wheelPaths: brokenWheels, unrecordedDistInfos: unrecordedOfProjects(brokenWheels, check.installed) }
}
