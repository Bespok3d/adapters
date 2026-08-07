// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import type { SshSession, EnrollContext } from '@adapter-sdk'

import { BESPOK3D, DAEMON_BASE } from './paths'

const WHEELS_DIR = 'wheels'
const PGPY_WHEEL_NAME = /^pgpy-.+\.whl$/i
const WHEEL_NAME = /\.whl$/i
const VENV = `${BESPOK3D}/venv`
const RUNTIME_PACKAGES = 'fastapi "uvicorn[standard]" python-multipart'

// The wheel is found by what it is, never by a literal name: it ships as 'pgpy-...' while the project
// spells itself 'PGPy', and a case-insensitive macOS or Windows filesystem hides a mismatch that Linux
// fails on for every enrollment. Matching the pattern also survives a version bump of the wheel.
export function pgpyWheelName(src: string): string {
  const wheelsDir = join(src, WHEELS_DIR)
  const wheel = readdirSync(wheelsDir).find((entry) => PGPY_WHEEL_NAME.test(entry))

  if (!wheel) throw new Error(`No pgpy wheel in ${wheelsDir}`)

  return wheel
}

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

// Every wheel the daemon ships. The venv installs from these with the package index switched off,
// so the printer needs no internet connection of its own.
export function wheelhouseNames(src: string): string[] {
  const wheelsDir = join(src, WHEELS_DIR)
  const wheels = readdirSync(wheelsDir).filter((entry) => WHEEL_NAME.test(entry))

  if (wheels.length === 0) throw new Error(`No wheels in ${wheelsDir}`)

  return wheels
}

async function uploadWheelhouse(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  const wheels = wheelhouseNames(src)

  async function uploadFromIndex(index: number): Promise<void> {
    if (index >= wheels.length) return

    const wheel = wheels[index]

    ctx.onProgress?.(`Uploading daemon packages… ${index + 1}/${wheels.length}`)
    await ssh.putBytes(`${DAEMON_BASE}/${WHEELS_DIR}/${wheel}`, readFileSync(join(src, WHEELS_DIR, wheel)))

    return uploadFromIndex(index + 1)
  }

  return uploadFromIndex(0)
}

export async function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const exists = (await ssh.exec(`test -x ${VENV}/bin/python3 && echo yes || echo no`)).trim()
  if (exists !== 'yes') {
    ctx.onProgress?.('Creating Python virtual environment…')
    await ssh.exec(`python3 -m venv ${VENV}`)
  }
}

export async function installVenvDeps(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  const hasRuntime = (await ssh.exec(
    `${VENV}/bin/python3 -c "import fastapi, uvicorn, multipart" 2>/dev/null && echo ok || echo missing`
  )).trim()
  const hasPgpy = (await ssh.exec(
    `${VENV}/bin/python3 -c "import pgpy" 2>/dev/null && echo ok || echo missing`
  )).trim()

  if (hasRuntime === 'ok' && hasPgpy === 'ok') return

  await uploadWheelhouse(ssh, ctx, src)

  if (hasRuntime !== 'ok') {
    ctx.onProgress?.('Installing daemon packages into venv; this may take a minute…')
    await ssh.exec(
      `${VENV}/bin/pip install --no-index --find-links ${DAEMON_BASE}/${WHEELS_DIR} ${RUNTIME_PACKAGES}`
    )
  }

  if (hasPgpy !== 'ok') {
    await ssh.exec(`${VENV}/bin/pip install --no-deps ${DAEMON_BASE}/${WHEELS_DIR}/${pgpyWheelName(src)}`)
  }
}
