// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { posix } from 'path'

import { shellQuote } from '@adapter-sdk'
import type { EnrollContext, SshSession } from '@adapter-sdk'

import { bespok3dRoot, daemonBase, expandHome, PATHS, venvDir } from './paths'
import { remoteHome, runtimeUser } from './remote'

// Where Klipper and Moonraker actually live on THIS printer.
//
// paths.json carries the ordinary MainsailOS layout, and a printer somebody set up with KIAUH,
// renamed the account on, or moved the data directory of does not match it. Rather than guess, the
// enrolment runs the jinni's own discovery on the printer, which reads the answer out of the systemd
// environment files klipper and moonraker are already started from, and stores it. The jinni then
// reads the same file at runtime, so the app and the device agree by construction.

export type PrinterLayout = Record<string, unknown>

const LAYOUT_FILE = 'etc/layout.json'
const LAYOUTS = new WeakMap<SshSession, Promise<PrinterLayout>>()

function layoutFile(home: string): string {
  return `${bespok3dRoot(home)}/${LAYOUT_FILE}`
}

async function fetchLayout(ssh: SshSession, home: string): Promise<PrinterLayout> {
  try {
    const parsed = JSON.parse(await ssh.getContent(layoutFile(home)))

    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    // No file yet (a printer mid-enrolment) or a half written one: the templates alone apply, which
    // is exactly the stock layout. Same answer the jinni gives itself on the device.
    return {}
  }
}

export function readLayout(ssh: SshSession, home: string): Promise<PrinterLayout> {
  const known = LAYOUTS.get(ssh)
  if (known) return known
  const reading = fetchLayout(ssh, home)
  LAYOUTS.set(ssh, reading)

  return reading
}

// One path variable: what discovery found, else the template expanded for this account.
export function layoutPath(layout: PrinterLayout, name: string, home: string): string {
  const discovered = layout[name]
  if (typeof discovered === 'string' && discovered) return discovered

  return expandHome(PATHS[name] ?? '', home)
}

function discoveryCommand(home: string): string {
  return `${shellQuote(`${venvDir(home)}/bin/python3`)} ${shellQuote(`${daemonBase(home)}/layout_discovery.py`)} --home ${shellQuote(home)}`
}

// The CLI exits non-zero with one plain sentence naming what this host is missing, and the SSH
// transport raises that sentence as the error. It is the whole answer a user needs, so it travels up
// untouched rather than wrapped in a guess of ours about what it meant.
async function discovered(ssh: SshSession, home: string): Promise<PrinterLayout> {
  return JSON.parse(await ssh.exec(discoveryCommand(home)))
}

// Where plugins drop their Klipper and Moonraker config. The include line that loads them is RELATIVE
// to the config file carrying it, so these have to sit beside the configs this host actually has, not
// beside the ones the template guessed at. Derived here and written into the layout, so the directory
// the enrolment creates and the one the jinni later names a plugin are the same directory.
function pluginConfigDirs(found: PrinterLayout, home: string): Record<string, string> {
  return {
    BESPOK3D_KLIPPER: `${posix.dirname(layoutPath(found, 'PRINTER_CFG', home))}/bespok3d/klipper`,
    BESPOK3D_MOONRAKER: `${posix.dirname(layoutPath(found, 'MOONRAKER_CFG', home))}/bespok3d/moonraker`,
  }
}

// The discover-layout step: ask the printer, add what only the app knows (which of this adapter's two
// ids enrolled it, the account, the home directory), and write the file the jinni reads.
export async function stepDiscoverLayout(ssh: SshSession, ctx: EnrollContext, adapterId: string): Promise<void> {
  const home = await remoteHome(ssh)
  const found = await discovered(ssh, home)
  const layout = {
    ...found,
    ...pluginConfigDirs(found, home),
    adapter: adapterId,
    runtime_user: runtimeUser(ctx),
    home,
  }
  await ssh.putContent(layoutFile(home), `${JSON.stringify(layout, null, 2)}\n`)
  LAYOUTS.set(ssh, Promise.resolve(layout))
}
