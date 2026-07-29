// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'fs'
import { join } from 'path'

import type { SshSession, EnrollContext } from '@adapter-sdk'

import { BESPOK3D, DAEMON_BASE } from './paths'

const PGPY_WHEEL = 'wheels/PGPy-0.6.0-py3-none-any.whl'
const VENV = `${BESPOK3D}/venv`

// The daemon must never pip into the system, Klipper, or Moonraker interpreters. A prior enroll may
// have leaked daemon deps into the overlay's system site-packages; strip them so only the venv carries
// them.
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

export async function installVenvDeps(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  const hasPkgs = (await ssh.exec(
    `${VENV}/bin/python3 -c "import fastapi, uvicorn, multipart" 2>/dev/null && echo ok || echo missing`
  )).trim()
  if (hasPkgs !== 'ok') {
    ctx.onProgress?.('Installing daemon packages into venv; this may take a minute…')
    await ssh.exec(`${VENV}/bin/pip install fastapi "uvicorn[standard]" python-multipart`)
  }
  const hasPgpy = (await ssh.exec(
    `${VENV}/bin/python3 -c "import pgpy" 2>/dev/null && echo ok || echo missing`
  )).trim()
  if (hasPgpy !== 'ok') {
    ctx.onProgress?.('Uploading pgpy wheel…')
    await ssh.putBytes(`${DAEMON_BASE}/${PGPY_WHEEL}`, readFileSync(join(src, PGPY_WHEEL)))
    await ssh.exec(`${VENV}/bin/pip install --no-deps ${DAEMON_BASE}/${PGPY_WHEEL}`)
  }
}
