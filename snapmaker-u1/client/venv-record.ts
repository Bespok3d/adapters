// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether the packages in the daemon's venv still hold the files pip wrote, judged on the printer
// against each package's RECORD, and which payload wheels that leaves to install again.
import { posix } from 'path'

import { shellQuote } from '@adapter-sdk'

const DISTRIBUTION_STATES = ['intact', 'damaged', 'unrecorded'] as const
export type DistributionState = typeof DISTRIBUTION_STATES[number]

export interface InstalledDistribution {
  state: DistributionState
  distInfoPath: string
}

export interface VenvRepair {
  // The payload wheels whose package is missing or broken, to install again.
  wheelPaths: string[]
  // The dist-info dirs whose RECORD is gone or unreadable: pip refuses to uninstall them, so they go first.
  unrecordedDistInfos: string[]
}

// Rows under __pycache__ are skipped: pip compiles every installed .py there, overwriting any cached .pyc
// the wheel shipped, so a shipped row's hash is stale on a whole package and pip's own rows carry none.
// A RECORD left with no digest at all judges nothing, so it counts as unreadable.
const RECORD_CHECK_SCRIPT = `
import base64, csv, glob, hashlib, os, sysconfig

def file_holds(site_dir, record_row):
    if "__pycache__" in record_row[0].split("/"):
        return True
    try:
        algorithm, recorded_digest = record_row[1].split("=", 1)
        with open(os.path.join(site_dir, record_row[0]), "rb") as installed_file:
            installed_digest = hashlib.new(algorithm, installed_file.read()).digest()
    except (OSError, ValueError, TypeError):
        return False
    return base64.urlsafe_b64encode(installed_digest).rstrip(b"=").decode() == recorded_digest.rstrip("=")

def dist_state(site_dir, dist_info):
    try:
        with open(os.path.join(dist_info, "RECORD"), newline="", encoding="utf-8") as record_file:
            digested_rows = [record_row for record_row in csv.reader(record_file) if len(record_row) > 1 and record_row[1]]
    except (OSError, UnicodeDecodeError, csv.Error):
        return "unrecorded"
    if not digested_rows:
        return "unrecorded"
    return "intact" if all(file_holds(site_dir, record_row) for record_row in digested_rows) else "damaged"

site_dirs = sorted({os.path.realpath(sysconfig.get_path(scheme_key)) for scheme_key in ("purelib", "platlib")})
for site_dir in site_dirs:
    for dist_info in sorted(glob.glob(os.path.join(site_dir, "*.dist-info"))):
        print(dist_state(site_dir, dist_info), dist_info, sep="\\t")
`

// The venv's own python walks the venv's own site-packages; -I keeps the environment and the working
// directory out of what it imports.
export function recordCheckCommand(venvDir: string): string {
  return `${shellQuote(`${venvDir}/bin/python3`)} -I -c ${shellQuote(RECORD_CHECK_SCRIPT)}`
}

function isDistributionState(state: string): state is DistributionState {
  return (DISTRIBUTION_STATES as readonly string[]).includes(state)
}

function installedDistributionOf(checkLine: string): InstalledDistribution {
  const [state, ...distInfoPathParts] = checkLine.split('\t')
  const distInfoPath = distInfoPathParts.join('\t')
  if (!isDistributionState(state) || distInfoPath === '') throw new Error(`Unreadable venv package check line: ${checkLine}`)

  return { state, distInfoPath }
}

export function parseRecordCheck(checkOutput: string): InstalledDistribution[] {
  return checkOutput.split('\n').filter((checkLine) => checkLine.trim() !== '').map(installedDistributionOf)
}

// PEP 503 names match case-insensitively, any run of "-", "_" or "." being one separator. A wheel file and
// the dist-info dir it installs both start with "<name>-<version>", and neither part holds a "-".
function projectName(nameVersionStem: string): string {
  return nameVersionStem.split('-')[0].toLowerCase().replace(/[-_.]+/g, '_')
}

function distributionKey(nameVersionStem: string): string {
  const version = nameVersionStem.split('-')[1] ?? ''

  return `${projectName(nameVersionStem)}-${version.toLowerCase()}`
}

function distInfoStem(distribution: InstalledDistribution): string {
  return posix.basename(distribution.distInfoPath, '.dist-info')
}

function wheelIsWhole(wheelPath: string, installed: readonly InstalledDistribution[]): boolean {
  const wheelKey = distributionKey(posix.basename(wheelPath))
  const wheelDistributions = installed.filter((distribution) => distributionKey(distInfoStem(distribution)) === wheelKey)

  return wheelDistributions.length > 0 && wheelDistributions.every((distribution) => distribution.state === 'intact')
}

// pip uninstalls whichever version of a project is installed before it installs the wheel, so a dist-info
// without a RECORD blocks a wheel of any version of the same project.
function unrecordedOfProjects(brokenWheels: readonly string[], installed: readonly InstalledDistribution[]): string[] {
  const brokenProjects = new Set(brokenWheels.map((wheelPath) => projectName(posix.basename(wheelPath))))

  return installed
    .filter((distribution) => distribution.state === 'unrecorded' && brokenProjects.has(projectName(distInfoStem(distribution))))
    .map((distribution) => distribution.distInfoPath)
}

export function venvRepair(wheelPaths: readonly string[], installed: readonly InstalledDistribution[]): VenvRepair {
  const brokenWheels = wheelPaths.filter((wheelPath) => !wheelIsWhole(wheelPath, installed))

  return { wheelPaths: brokenWheels, unrecordedDistInfos: unrecordedOfProjects(brokenWheels, installed) }
}
