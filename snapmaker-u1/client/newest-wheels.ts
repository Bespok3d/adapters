// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Which of the wheels on the printer are the newest of their project. pip refuses two versions of one
// project in one run, and a venv holds one, so only the newest of each is ever installed.
import { posix } from 'path'

import { projectName, projectVersion } from './wheel-names'

// The wheel format writes a version in its normalized PEP 440 form, so only that form is matched, and a
// local version (+cpu) is refused: PyPI, where the daemon's wheels come from, takes none.
const PEP440_PUBLIC_VERSION = /^(?:(\d+)!)?(\d+(?:\.\d+)*)(?:(a|b|rc)(\d+))?(?:\.post(\d+))?(?:\.dev(\d+))?$/
const PRE_RELEASE_PHASES = ['a', 'b', 'rc']
// The phase of a release that is no pre-release, after every pre-release phase.
const FINAL_PHASE = PRE_RELEASE_PHASES.length
// A development release of a final release comes before its pre-releases.
const DEV_OF_FINAL_PHASE = -1
const NO_POST_RELEASE = -1
const NO_DEV_RELEASE = Infinity

interface OrderedVersion {
  epoch: number
  release: number[]
  prePostDevKey: number[]
}

function preReleaseKey(phase: string | undefined, phaseNumber: string | undefined, post: string | undefined, dev: string | undefined): number[] {
  if (phase !== undefined) return [PRE_RELEASE_PHASES.indexOf(phase), Number(phaseNumber)]
  if (post === undefined && dev !== undefined) return [DEV_OF_FINAL_PHASE, 0]

  return [FINAL_PHASE, 0]
}

function orderedVersion(version: string): OrderedVersion {
  const versionParts = PEP440_PUBLIC_VERSION.exec(version)
  if (versionParts === null) throw new Error(`Cannot order the wheel version "${version}" against another of its project`)
  const [, epoch, release, phase, phaseNumber, post, dev] = versionParts
  const postKey = post === undefined ? NO_POST_RELEASE : Number(post)
  const devKey = dev === undefined ? NO_DEV_RELEASE : Number(dev)

  return { epoch: Number(epoch ?? 0), release: release.split('.').map(Number), prePostDevKey: [...preReleaseKey(phase, phaseNumber, post, dev), postKey, devKey] }
}

// A release compares as if padded with zeros, so 1.0 and 1.0.0 are one version.
function comparisonKey(version: OrderedVersion, releaseLength: number): number[] {
  const releasePadding = Array<number>(releaseLength - version.release.length).fill(0)

  return [version.epoch, ...version.release, ...releasePadding, ...version.prePostDevKey]
}

export function compareWheelVersions(leftVersion: string, rightVersion: string): number {
  const left = orderedVersion(leftVersion)
  const right = orderedVersion(rightVersion)
  const releaseLength = Math.max(left.release.length, right.release.length)
  const leftKey = comparisonKey(left, releaseLength)
  const rightKey = comparisonKey(right, releaseLength)
  const firstDifference = leftKey.findIndex((keyPart, keyIndex) => keyPart !== rightKey[keyIndex])

  return firstDifference === -1 ? 0 : Math.sign(leftKey[firstDifference] - rightKey[firstDifference])
}

function wheelProject(wheelPath: string): string {
  return projectName(posix.basename(wheelPath))
}

function newerWheel(keptWheel: string, candidateWheel: string): string {
  const candidateIsNewer = compareWheelVersions(projectVersion(posix.basename(candidateWheel)), projectVersion(posix.basename(keptWheel))) > 0

  return candidateIsNewer ? candidateWheel : keptWheel
}

// A project with a single wheel keeps it unread, so only two versions of one project need ordering.
export function newestWheelPerProject(wheelPaths: readonly string[]): string[] {
  const projects = [...new Set(wheelPaths.map(wheelProject))]

  return projects.map((project) => wheelPaths.filter((wheelPath) => wheelProject(wheelPath) === project).reduce(newerWheel))
}
