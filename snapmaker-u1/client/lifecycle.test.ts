// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { fileURLToPath } from 'node:url'

import { describe, it, expect, vi } from 'vitest'

// getAppPath() resolved to the app repo root so the client's adapterJinniPath() points at the real
// jinni dir regardless of the test runner's cwd (the client reads paths.json at module load).
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

import type { EnrollStep, SshSession } from '@adapter-sdk'
import { bespok3dRemovalCommand, diagnoseDaemon, LIFECYCLE, readDaemonLog } from './lifecycle'

function stepIds(steps: EnrollStep[]): string[] {
  return steps.map((step) => step.id)
}

// A fake SSH session that records the command instead of running it, so a test reads the exact text
// the printer would be sent.
function recordingSsh(recorded: string[]): SshSession {
  function exec(cmd: string): Promise<string> {
    recorded.push(cmd)

    return Promise.resolve('')
  }

  return { exec } as unknown as SshSession
}

describe('bespok3dRemovalCommand', () => {
  const command = bespok3dRemovalCommand()

  it('recreates the dhcpcd state dir after removing its dangling symlink (or no DHCP on reboot)', () => {
    expect(command).toContain('rm -f /var/db/dhcpcd ; mkdir -p /var/db/dhcpcd')
  })

  it('re-locks the overlay by removing /oem/.debug for a truly-mint state on the next boot', () => {
    expect(command).toContain('rm -f /oem/.debug')
  })

  it('still removes the workspace and the boot hook', () => {
    expect(command).toContain('rm -rf /userdata/bespok3d')
    expect(command).toContain("sed -i '/S99bespok3d/d' /etc/init.d/S90lmd")
  })
})

// The app composes each printer op from the daemon-side work it owns plus this list, so the ids are
// the contract: a rename here silently drops a step out of an op the user is watching run.
describe('the lifecycle lists the app builds its printer ops from', () => {
  it('takes bespok3d out of the boot sequence to deactivate it', () => {
    expect(stepIds(LIFECYCLE.deactivate)).toEqual(['remove-boot-hook'])
  })

  it('puts the marker, the includes, the boot hook and the daemon back to reactivate it', () => {
    expect(stepIds(LIFECYCLE.reactivate)).toEqual([
      'remove-marker',
      'restore-includes',
      'restore-boot-hook',
      'start-daemon',
    ])
  })

  it('reuses the start-daemon step from enrollment, so the two can never drift apart', () => {
    expect(LIFECYCLE.reactivate[3].label).toBe('Starting the daemon')
  })

  it('removes every file and system change in one step', () => {
    expect(stepIds(LIFECYCLE.remove)).toEqual(['remove-files'])
  })

  it('asks for the power cycle and leaves the waiting to the app', () => {
    expect(stepIds(LIFECYCLE.reboot)).toEqual(['power-cycle'])
  })
})

describe('what the app reads back off a printer whose daemon did not come up', () => {
  it('tails the daemon log from the workspace, and says nothing when there is no log yet', async () => {
    const recorded: string[] = []
    await readDaemonLog(recordingSsh(recorded))

    expect(recorded[0]).toBe('tail -200 /userdata/bespok3d/var/log/daemon.log 2>/dev/null || true')
  })

  it('names the four states a U1 daemon fails in', async () => {
    const recorded: string[] = []
    await diagnoseDaemon(recordingSsh(recorded))

    expect(recorded[0]).toContain('stale-demon-dir')
    expect(recorded[0]).toContain('missing-daemon.py')
    expect(recorded[0]).toContain('wrong-autostart-path')
    expect(recorded[0]).toContain('port-4269-occupied')
  })
})
