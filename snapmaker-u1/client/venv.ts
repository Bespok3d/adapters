// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { sha256Of } from './payload-hashes'
import type { HashesByPath } from './payload-hashes'

import { BESPOK3D, DAEMON_BASE } from './paths'

const VENV = `${BESPOK3D}/venv`

// What the last successful pip run installed: one digest over the wheels' paths and hashes.
const WHEEL_MARKER = `${VENV}/.bespok3d-wheels`

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

// A venv made afresh holds no packages, so the marker of an earlier pip run goes with the old one.
export async function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const exists = (await ssh.exec(`test -x ${VENV}/bin/python3 && echo yes || echo no`)).trim()
  if (exists !== 'yes') {
    ctx.onProgress?.('Creating Python virtual environment…')
    await ssh.exec(`python3 -m venv ${VENV} && rm -f ${WHEEL_MARKER}`)
  }
}

// The daemon's dependencies come out of the daemon's own package, as wheel FILES already sitting on the
// printer: --no-index keeps pip off the network, --no-deps stops it resolving anything, and naming the
// files rather than the packages leaves its resolver nothing to backtrack over. So a printer that answers
// on port 22 and nothing else installs exactly like one with a way out to the internet.
// Every wheel the payload declares is installed every time, never a subset an import probe guessed at: a
// printer enrolled by an older app is missing whatever the newer daemon added, and a probe cannot see it.
export async function installVenvDeps(ssh: SshSession, ctx: EnrollContext, wheelPaths: readonly string[]): Promise<void> {
  if (wheelPaths.length === 0) return
  ctx.onProgress?.('Installing daemon packages into venv; this may take a minute…')
  const wheelFiles = wheelPaths.map((wheelPath) => shellQuote(`${DAEMON_BASE}/${wheelPath}`)).join(' ')

  await ssh.exec(`${VENV}/bin/pip install --no-index --no-deps ${wheelFiles}`)
}

function wheelSetDigest(wheelHashes: HashesByPath): string {
  const wheelLines = [...wheelHashes].map(([wheelPath, wheelHash]) => `${wheelPath} ${wheelHash}\n`).sort()

  return sha256Of(Buffer.from(wheelLines.join('')))
}

async function venvHasWheels(ssh: SshSession, wheelDigest: string): Promise<boolean> {
  const installedDigest = await ssh.exec(`cat ${WHEEL_MARKER} 2>/dev/null; true`)

  return installedDigest.trim() === wheelDigest
}

// pip runs only when the venv does not already hold these exact wheels, whichever way the files were
// sent. The marker is written only after pip succeeds, so a pip run cut short is run again next time.
export async function syncVenvDeps(ssh: SshSession, ctx: EnrollContext, wheelHashes: HashesByPath): Promise<void> {
  const wheelDigest = wheelSetDigest(wheelHashes)
  if (await venvHasWheels(ssh, wheelDigest)) return
  await installVenvDeps(ssh, ctx, [...wheelHashes.keys()])
  await ssh.exec(`printf %s ${wheelDigest} > ${WHEEL_MARKER}`)
}
