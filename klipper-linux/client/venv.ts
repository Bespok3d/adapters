// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { daemonBase, venvDir } from './paths'
import { failureOf, succeeds } from './remote'

// The daemon's own Python, and getting its dependencies into it on a printer whose Python may not be
// the one the wheels were built for.
//
// The baked wheels are cp311/aarch64, which is MainsailOS 2.x. MainsailOS 3.0.0 is Trixie and Python
// 3.13, where those wheels simply do not apply, and `python3-pip` is not on either image, so the venv
// may come up without a pip of its own. Both are ordinary states of a supported printer rather than
// errors, so each has a way through: the offline install first because it needs no network at all,
// and the printer's own network second when the wheels do not fit. The user is told which happened,
// because "this took two minutes and downloaded 40 MB" deserves a reason.

export interface VenvInstall {
  ssh: SshSession
  ctx: EnrollContext
  home: string
  // Wheel paths inside the daemon payload, already uploaded under the daemon base.
  wheelPaths: readonly string[]
  // Whether the virtualenv came up with a pip inside it. A `--without-pip` venv is still a perfectly
  // good interpreter; it just has to be installed INTO from the outside.
  hasPip: boolean
}

const REQUIREMENTS = 'requirements.txt'
const REASON_LINES = 12

function creationCommands(venv: string): string[] {
  return [
    `python3 -m venv ${shellQuote(venv)}`,
    `virtualenv -p python3 ${shellQuote(venv)}`,
    `python3 -m venv --without-pip ${shellQuote(venv)}`,
  ]
}

async function create(ssh: SshSession, commands: readonly string[], index: number): Promise<void> {
  if (index >= commands.length) {
    throw new Error(
      'A Python environment for the Bespok3d daemon could not be created on this printer. Install the python3-venv package on the printer host, then enroll again.'
    )
  }
  if (await succeeds(ssh, commands[index])) return

  return create(ssh, commands, index + 1)
}

// Returns whether the environment has a pip of its own, which decides how the fallback install is
// spelled later in the same step.
export async function ensureVenv(ssh: SshSession, ctx: EnrollContext, home: string): Promise<boolean> {
  const venv = venvDir(home)
  if (!(await succeeds(ssh, `test -x ${shellQuote(`${venv}/bin/python3`)}`))) {
    ctx.onProgress?.('Creating the Python environment for the daemon…')
    await create(ssh, creationCommands(venv), 0)
  }

  return succeeds(ssh, `test -x ${shellQuote(`${venv}/bin/pip`)}`)
}

// Files, never package names: --no-index keeps pip off the network and --no-deps leaves its resolver
// nothing to backtrack over, so a printer with no route out installs exactly like one with one.
function offlineCommand(install: VenvInstall): string {
  const wheels = install.wheelPaths.map((wheelPath) => shellQuote(`${daemonBase(install.home)}/${wheelPath}`))

  return `${shellQuote(`${venvDir(install.home)}/bin/pip`)} install --no-index --no-deps ${wheels.join(' ')}`
}

function onlineCommand(install: VenvInstall): string {
  const requirements = shellQuote(`${daemonBase(install.home)}/${REQUIREMENTS}`)
  const interpreter = shellQuote(`${venvDir(install.home)}/bin/python3`)
  if (install.hasPip) return `${interpreter} -m pip install -r ${requirements}`

  return `python3 -m pip --python ${interpreter} install -r ${requirements}`
}

function lastLines(text: string): string {
  return text.trim().split('\n').slice(-REASON_LINES).join('\n')
}

async function installOnline(install: VenvInstall): Promise<void> {
  const refused = await failureOf(install.ssh, onlineCommand(install))
  if (!refused) return

  throw new Error(
    `The Bespok3d daemon's Python packages could not be installed on this printer. pip said:\n${lastLines(refused)}`
  )
}

export async function installVenvDeps(install: VenvInstall): Promise<void> {
  if (install.wheelPaths.length === 0) return
  install.ctx.onProgress?.('Installing daemon packages into the environment; this may take a minute…')
  const refused = await failureOf(install.ssh, offlineCommand(install))
  if (!refused) return
  install.ctx.onProgress?.(
    `The packaged wheels do not fit this printer's Python (${lastLines(refused).split('\n').slice(-1)[0]}); fetching the packages instead`
  )
  await installOnline(install)
}
