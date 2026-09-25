// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

// getAppPath() resolved to the app repo root so the client's jinni path points at the real jinni dir
// regardless of the test runner's cwd (the client reads paths.json at module load).
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

import type { AdapterDefinition, EnrollContext, EnrollStep, SshSession } from '@adapter-sdk'
import { getAdapter } from '@adapter-sdk'

import { KLIPPER_LINUX_ADAPTER_IDS } from './klipper-linux'

const PATHS_JSON = JSON.parse(readFileSync(new URL('../jinni/paths.json', import.meta.url), 'utf-8'))
const VERSION_JSON = JSON.parse(readFileSync(new URL('../jinni/version.json', import.meta.url), 'utf-8'))

// The only four things a person reads. Everything else about the two registrations has to be the
// same thing, not merely the same-looking thing, which is what the drift test below checks.
const FIELDS_THE_TWO_IDS_MAY_DIFFER_IN = ['id', 'title', 'vendor', 'description']

function registered(id: string): AdapterDefinition {
  const adapter = getAdapter(id)
  expect(adapter, `${id} must be registered`).toBeTruthy()

  return adapter!
}

function stepIds(steps: EnrollStep[]): string[] {
  return steps.map((step) => step.id)
}

// Read off the registered object rather than listed by hand, so a field added to AdapterDefinition
// is compared the day it is added instead of the day somebody remembers this test.
function sharedFields(definition: AdapterDefinition): (keyof AdapterDefinition)[] {
  return (Object.keys(definition) as (keyof AdapterDefinition)[])
    .filter((field) => !FIELDS_THE_TWO_IDS_MAY_DIFFER_IN.includes(field))
}

// The picker offers exactly the adapters a build registered, so a name the build does not carry can
// never be picked. Both of these names are promised by the picker and by guessAdapter.
describe('the two ids one klipper-linux client registers', () => {
  it('registers a Voron 2.4 and a generic Klipper printer', () => {
    expect(KLIPPER_LINUX_ADAPTER_IDS).toEqual(['voron-24', 'klipper-generic'])
    expect(registered('voron-24').title).toBe('Voron 2.4')
    expect(registered('voron-24').vendor).toBe('Voron Design')
    expect(registered('klipper-generic').title).toBe('Klipper: generic')
    expect(registered('klipper-generic').vendor).toBe('Any maker')
  })

  // The vendor column is shown to the user as the printer's manufacturer, so it names whoever built
  // the printer, never us; and each id says for itself which printers it is the right pick for.
  it('describes each id in its own words, because the two are picked by different people', () => {
    expect(registered('voron-24').description).toBe(
      "Stock Klipper adapter for a Voron 2.4 running MainsailOS, Fluidd or any KIAUH install on a Raspberry Pi class board. Connects over SSH as the printer's own user and installs Bespok3d under that user's home, using sudo only for the system services it registers.",
    )
    expect(registered('klipper-generic').description).toBe(
      "Stock Klipper adapter for any Klipper printer running MainsailOS, Fluidd or a KIAUH install on a 64 bit Linux host with systemd: a Raspberry Pi class board, a CB1, or an x86 mini PC. Connects over SSH as the printer's own user and installs Bespok3d under that user's home, using sudo only for the system services it registers.",
    )
  })

  it('enrolls both through the identical steps, so the two can never drift apart', () => {
    const voron = registered('voron-24')
    const generic = registered('klipper-generic')
    // Both directions: a field one registration carries and the other lacks is a drift too, and the
    // loop below only walks the fields the first one has.
    expect(new Set(Object.keys(generic))).toEqual(new Set(Object.keys(voron)))
    expect(new Set(sharedFields(voron))).toEqual(new Set([
      'version', 'jinniVersion', 'jinniPackage', 'restartSeconds', 'defaults', 'envVars',
      'enrollSteps', 'opSteps', 'lifecycle', 'readDaemonLog', 'diagnoseDaemon', 'workspaceRoot',
      'verifyEnrolled',
    ]))
    // The enrol list is rebuilt per id because the layout step carries the id, so its steps are
    // compared by name; every other field has to be the very same value both ids were given.
    expect(stepIds(voron.enrollSteps)).toEqual(stepIds(generic.enrollSteps))
    sharedFields(voron)
      .filter((field) => field !== 'enrollSteps')
      .forEach((field) => {
        expect(voron[field], `${field} must be one shared value, not a second copy`).toBe(generic[field])
      })
  })
})

// The id the printer was enrolled under is written into its layout file, and the jinni reports
// itself as that adapter from then on. The generic id has to survive that trip as written: it is the
// id a plugin's `requires.capabilities` and a variant's `when: {adapter: ...}` are matched against.
describe('the discover-layout step of the generic id', () => {
  const HOME = '/home/notapi'
  const CTX = { credentials: { user: 'notapi', password: 'obviously-fake-password', port: 22 } } as EnrollContext
  const DISCOVERED = {
    PRINTER_CFG: '/srv/klipper-data/config/printer.cfg',
    MOONRAKER_CFG: '/srv/klipper-data/config/moonraker.conf',
    KLIPPER_SRC: '/opt/klipper/klippy',
  }

  function recordingSession(): { written: Record<string, string>, ssh: SshSession } {
    const written: Record<string, string> = {}

    return {
      written,
      ssh: {
        host: '10.0.0.9',
        exec: async (command: string) => (command.includes('echo "$HOME"') ? `${HOME}\n` : JSON.stringify(DISCOVERED)),
        putContent: async (path: string, content: string) => { written[path] = content },
      } as unknown as SshSession,
    }
  }

  it('writes klipper-generic into the layout, so the jinni reports itself as that adapter', async () => {
    const session = recordingSession()
    const discoverLayout = registered('klipper-generic').enrollSteps.find((step) => step.id === 'discover-layout')
    expect(discoverLayout, 'the generic id must carry a discover-layout step').toBeTruthy()

    await discoverLayout!.run(session.ssh, CTX)

    expect(JSON.parse(session.written[`${HOME}/bespok3d/etc/layout.json`]).adapter).toBe('klipper-generic')
  })
})

// The app's ops look these ids up by name, so a rename here silently drops a step out of an operation
// the user is watching run.
describe('the enrolment recipe', () => {
  it('runs in the order that leaves the printer working at every point it could stop', () => {
    expect(stepIds(registered('voron-24').enrollSteps)).toEqual([
      'preflight',
      'create-workspace',
      'deploy-daemon',
      'discover-layout',
      'klipper-includes',
      'install-services',
      'generate-daemon-cert',
      'enroll-daemon-key',
      'start-daemon',
      'verify',
    ])
  })

  it('keeps the jinni update reachable outside the enrol sequence', () => {
    expect(stepIds(registered('voron-24').opSteps ?? [])).toEqual(['deploy-jinni'])
  })
})

describe('the lifecycle the app builds its printer ops from', () => {
  const lifecycle = registered('voron-24').lifecycle

  it('takes bespok3d out of the boot sequence to deactivate it', () => {
    expect(stepIds(lifecycle.deactivate)).toEqual(['disable-services'])
  })

  it('puts the marker, the includes, the services and the daemon back to reactivate it', () => {
    expect(stepIds(lifecycle.reactivate)).toEqual([
      'remove-marker',
      'restore-includes',
      'enable-services',
      'start-daemon',
    ])
  })

  it('reuses the start-daemon step from enrolment rather than a second copy of it', () => {
    const enrolStart = registered('voron-24').enrollSteps.find((step) => step.id === 'start-daemon')
    expect(lifecycle.reactivate[3]).toBe(enrolStart)
  })

  it('unregisters the services before it removes the files they point at', () => {
    expect(stepIds(lifecycle.remove)).toEqual(['disable-services', 'remove-system-files', 'remove-workspace'])
  })

  it('asks for the power cycle and leaves the waiting to the app', () => {
    expect(stepIds(lifecycle.reboot)).toEqual(['power-cycle'])
  })
})

describe('the values the adapter reports about itself', () => {
  function valueOf(name: string): string | undefined {
    return registered('voron-24').envVars.find((envVar) => envVar.name === name)?.value
  }

  it('sources path values from the shared paths.json, never a second hardcoded copy', () => {
    expect(valueOf('BESPOK3D')).toBe(PATHS_JSON.BESPOK3D)
    expect(valueOf('KLIPPER_SRC')).toBe(PATHS_JSON.KLIPPER_SRC)
    expect(valueOf('MOONRAKER_COMPONENTS')).toBe(PATHS_JSON.MOONRAKER_COMPONENTS)
    expect(valueOf('RUNTIME_USER')).toBe(PATHS_JSON.RUNTIME_USER)
  })

  // The account name is the printer owner's to choose, so the paths are shown as the templates they
  // are rather than as a /home/pi the app cannot promise.
  it('shows the paths as templates, because the home directory follows the login name', () => {
    expect(valueOf('BESPOK3D')).toContain('$HOME')
    expect(valueOf('PRINTER_CFG')).toContain('$HOME')
  })

  it('sources the jinni version from the shared version.json, never a second hardcoded copy', () => {
    expect(registered('voron-24').jinniVersion).toBe(VERSION_JSON.jinni_version)
    expect(registered('voron-24').jinniPackage).toBe('bespok3d-jinni-klipper-linux')
  })
})

// The app writes one file into the workspace itself (the access list, on a reset) over SFTP, which
// expands nothing, so the root it asks for has to be the real directory and not the $HOME template.
describe('workspaceRoot', () => {
  it('resolves the login home read off the session, never the template', async () => {
    const ssh = { exec: async () => '/home/notapi\n' } as unknown as SshSession

    expect(await registered('voron-24').workspaceRoot(ssh)).toBe('/home/notapi/bespok3d')
  })
})
