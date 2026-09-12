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

import type { AdapterDefinition, EnrollStep } from '@adapter-sdk'
import { getAdapter } from '@adapter-sdk'

import { KLIPPER_LINUX_ADAPTER_IDS } from './klipper-linux'

const PATHS_JSON = JSON.parse(readFileSync(new URL('../jinni/paths.json', import.meta.url), 'utf-8'))
const VERSION_JSON = JSON.parse(readFileSync(new URL('../jinni/version.json', import.meta.url), 'utf-8'))

function registered(id: string): AdapterDefinition {
  const adapter = getAdapter(id)
  expect(adapter, `${id} must be registered`).toBeTruthy()

  return adapter!
}

function stepIds(steps: EnrollStep[]): string[] {
  return steps.map((step) => step.id)
}

// The picker offers exactly the adapters a build registered, so a name the build does not carry can
// never be picked. Both of these names are promised by the picker and by guessAdapter.
describe('the two ids one klipper-linux client registers', () => {
  it('registers a Voron 2.4 and a generic Klipper printer', () => {
    expect(KLIPPER_LINUX_ADAPTER_IDS).toEqual(['voron-24', 'klipper-generic'])
    expect(registered('voron-24').title).toBe('Voron 2.4')
    expect(registered('voron-24').vendor).toBe('Voron Design')
    expect(registered('klipper-generic').title).toBe('Klipper: generic')
    expect(registered('klipper-generic').vendor).toBe('Bespok3d')
  })

  it('enrolls both through the identical steps, so the two can never drift apart', () => {
    const voron = registered('voron-24')
    const generic = registered('klipper-generic')
    expect(stepIds(voron.enrollSteps)).toEqual(stepIds(generic.enrollSteps))
    expect(stepIds(voron.opSteps ?? [])).toEqual(stepIds(generic.opSteps ?? []))
    expect(voron.envVars).toBe(generic.envVars)
    expect(voron.lifecycle).toBe(generic.lifecycle)
    expect(voron.defaults).toEqual(generic.defaults)
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
