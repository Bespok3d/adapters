// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { shellArguments } from './shell-arguments'
import { parseRecordCheck, recordCheckCommand, venvRepair } from './venv-record'

import { BESPOK3D, DAEMON_BASE } from './paths'

const VENV = `${BESPOK3D}/venv`
const PIP_INSTALL_FROM_FILES = `${VENV}/bin/pip install --no-index --no-deps`
const RUNS_AS_VENV = 'import sys; sys.exit(sys.prefix == sys.base_prefix)'
const VENV_PYTHON_PROBE = `${VENV}/bin/python3 -I -c ${shellQuote(RUNS_AS_VENV)} 2>/dev/null && echo yes || echo no`

// The daemon must never pip into the system, Klipper, or Moonraker interpreters. A prior enroll may
// have leaked daemon deps into the overlay's system site-packages; strip them so only the venv carries
// them. pgpy stays in this list although the daemon no longer ships it: an enroll from an older app
// left a copy behind, and this is what removes it.
export async function cleanSystemPython(ssh: SshSession): Promise<void> {
  const pkgs = [
    'fastapi', 'uvicorn', 'pydantic', 'pydantic_core', 'uvloop', 'httptools',
    'websockets', 'watchfiles', 'multipart', 'dotenv', 'pgpy', 'annotated_types',
    'starlette', 'click', 'typing_inspection', 'annotated_doc',
  ].join(' ')
  await ssh.exec(
    `cd /oem/overlay/upper/usr/lib/python3.11/site-packages 2>/dev/null &&` +
    ` for p in ${pkgs}; do rm -rf "$p" "$p"-*.dist-info 2>/dev/null; done;` +
    ` rm -f typing_extensions.py typing_extensions.pyc; rm -rf __pycache__ 2>/dev/null; true`
  )
}

// The venv counts only when its own python runs, and runs as the venv: a venv that lost pyvenv.cfg runs as
// the system python, and pip would install the daemon packages there. A broken venv is made again from
// nothing, as python3 -m venv keeps a python link it finds even when that link points nowhere.
export async function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const venvPythonWorks = (await ssh.exec(VENV_PYTHON_PROBE)).trim() === 'yes'
  if (venvPythonWorks) return
  ctx.onProgress?.('Creating Python virtual environment…')
  await ssh.exec(`rm -rf ${VENV} && python3 -m venv ${VENV}`)
}

// The daemon's dependencies come out of the daemon's own package, as wheel FILES already sitting on the
// printer: --no-index keeps pip off the network, --no-deps stops it resolving anything, and naming the
// files rather than the packages leaves its resolver nothing to backtrack over. So a printer that answers
// on port 22 and nothing else installs exactly like one with a way out to the internet.
// The venv is judged by its files on every run, with no memory of an earlier one, so a run cut short is
// finished by the next: each payload wheel whose package is missing, has lost or changed a file, or was
// installed from other bytes is installed again, and no other. --force-reinstall, because plain pip skips
// a version that is already there, whole or not.
export async function syncVenvDeps(ssh: SshSession, ctx: EnrollContext, wheelPaths: readonly string[]): Promise<void> {
  if (wheelPaths.length === 0) return
  const remoteWheelPaths = wheelPaths.map((wheelPath) => `${DAEMON_BASE}/${wheelPath}`)
  const venvCheck = parseRecordCheck(await ssh.exec(recordCheckCommand(VENV, remoteWheelPaths)))
  const repair = venvRepair(remoteWheelPaths, venvCheck)
  if (repair.wheelPaths.length === 0) return
  ctx.onProgress?.('Installing daemon packages into venv; this may take a minute…')
  if (repair.unrecordedDistInfos.length > 0) await ssh.exec(`rm -rf ${shellArguments(repair.unrecordedDistInfos)}`)
  await ssh.exec(`${PIP_INSTALL_FROM_FILES} --force-reinstall ${shellArguments(repair.wheelPaths)}`)
}
