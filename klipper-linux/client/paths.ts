// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { jinniPayloadFile } from './jinni-payload'

function loadAdapterPaths(): Record<string, string> {
  return JSON.parse(jinniPayloadFile('paths.json'))
}

// The path variables live in ONE place: paths.json in the jinni dir. The device-side jinni reads it
// at runtime and the client reads the same file here at enrolment, so the two halves can never drift.
//
// Unlike the U1's, every path here is a TEMPLATE: this printer's Bespok3d tree lives in the login
// user's home, and that user is whoever owns the printer rather than a name the adapter can know.
// So nothing below is a usable path until a home directory has been read off the printer, which is
// why the roots are functions of `home` and not constants.
export const PATHS: Record<string, string> = loadAdapterPaths()

// The shell's own $HOME, quoted, for the handful of reads that run as a single command and would
// otherwise pay a round trip to learn a directory the remote shell already knows.
export const SHELL_HOME = '"$HOME"'

export function expandHome(template: string, home: string): string {
  return template.split('$HOME').join(home)
}

export function bespok3dRoot(home: string): string {
  return expandHome(PATHS.BESPOK3D, home)
}

// The daemon and both jinni halves co-locate here: the daemon spawns `python -m jinni` and the device
// jinni imports `from jinni import ...`, so the packages sit side by side under one root.
export function daemonBase(home: string): string {
  return `${bespok3dRoot(home)}/var/lib/daemon`
}

// The daemon's own interpreter. Klipper and Moonraker each have a virtualenv of their own on this
// host and the daemon never borrows one: a dependency it installs must not be able to reach either.
export function venvDir(home: string): string {
  return `${bespok3dRoot(home)}/venv`
}

// On-printer bespok3d layout version. Baseline for future system migrations that handle breaking
// changes to how bespok3d arranges things on a printer.
export const BESPOK3D_SYSTEM_VERSION = '0.0.1'

export function systemVersionFile(home: string): string {
  return `${bespok3dRoot(home)}/etc/version`
}
