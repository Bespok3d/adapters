// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { shellQuote } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { BESPOK3D, DAEMON_BASE } from './paths'

const VENV = `${BESPOK3D}/venv`

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

export async function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const exists = (await ssh.exec(`test -x ${VENV}/bin/python3 && echo yes || echo no`)).trim()
  if (exists !== 'yes') {
    ctx.onProgress?.('Creating Python virtual environment…')
    await ssh.exec(`python3 -m venv ${VENV}`)
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
