// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAdapter } from '@adapter-sdk'

// getAppPath() resolved to the app repo root so the client's adapterJinniPath() points at the real
// jinni dir regardless of the test runner's cwd (the client reads paths.json at module load).
vi.mock('electron', () => ({
  app: { isPackaged: false, getAppPath: () => fileURLToPath(new URL('../../../Bespok3d-desktop', import.meta.url)) },
}))

import type { SshSession } from '@adapter-sdk'
import { patchNginx, patchS90lmd, isPrinting, writeLayerActive, verifyEnrolled } from './snapmaker-u1'

// A fake SSH session whose exec is dispatched by command substring. Returning the sentinel
// '__throw__' makes exec reject, the way a non-zero `test` exit does on the real device.
function fakeSsh(reply: (cmd: string) => string): SshSession {
  return {
    exec: (cmd: string) => {
      const out = reply(cmd)

      return out === '__throw__' ? Promise.reject(new Error('non-zero exit')) : Promise.resolve(out)
    },
  } as unknown as SshSession
}

const PATHS_JSON = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../jinni/paths.json'), 'utf-8')
)

const VERSION_JSON = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../jinni/version.json'), 'utf-8')
)

const DAEMON_STARTUP_SCRIPT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../daemon/s10bespok3d-daemon'),
  'utf-8'
)

const SAMPLE_NGINX = ['server {', '    listen 80;', '    location / { }', '}'].join('\n')

const SAMPLE_INIT_SCRIPT = ['#!/bin/sh', '', 'start-stop-daemon -S -b -x /usr/bin/lmd'].join('\n')

describe('writeLayerActive (the /oem/.debug overlay flag)', () => {
  it('is true when /oem/.debug is present', async () => {
    expect(await writeLayerActive(fakeSsh(() => 'yes\n'))).toBe(true)
  })

  it('is false when /oem/.debug is absent (the post-OTA state)', async () => {
    expect(await writeLayerActive(fakeSsh(() => 'no\n'))).toBe(false)
  })
})

describe('verifyEnrolled (set up AND will persist: repair vs recover discriminator)', () => {
  it('is false when the write layer was reset, even though the workspace survives the OTA', async () => {
    expect(await verifyEnrolled(fakeSsh((cmd) => (cmd.includes('.debug') ? 'no' : '')))).toBe(false)
  })

  it('is true when the write layer is intact and the workspace exists (a repairable daemon glitch)', async () => {
    expect(await verifyEnrolled(fakeSsh((cmd) => (cmd.includes('.debug') ? 'yes' : '')))).toBe(true)
  })

  it('is false when the write layer is intact but the workspace is missing', async () => {
    expect(await verifyEnrolled(fakeSsh((cmd) => (cmd.includes('.debug') ? 'yes' : '__throw__')))).toBe(false)
  })
})

describe('patchNginx', () => {
  it('inserts the bespok3d locations include before the closing brace', () => {
    const result = patchNginx(SAMPLE_NGINX)
    expect(result).toContain('include /userdata/bespok3d/etc/nginx/locations/*.conf')
    expect(result.trimEnd()).toMatch(/\}$/)
  })

  it('is idempotent: already-patched content is returned unchanged', () => {
    const patched = patchNginx(SAMPLE_NGINX)
    expect(patchNginx(patched)).toBe(patched)
  })

  it('throws when the config does not end with a closing brace', () => {
    expect(() => patchNginx('server {\n  listen 80;\n')).toThrow('Unexpected nginx config format')
  })
})

describe('patchS90lmd', () => {
  it('inserts the bespok3d hook on the line immediately after the shebang', () => {
    const result = patchS90lmd(SAMPLE_INIT_SCRIPT)
    const lines = result.split('\n')
    expect(lines[0]).toBe('#!/bin/sh')
    expect(lines[1]).toContain('S99bespok3d')
  })

  it('is idempotent: already-patched content is returned unchanged', () => {
    const patched = patchS90lmd(SAMPLE_INIT_SCRIPT)
    expect(patchS90lmd(patched)).toBe(patched)
  })

  it('throws when the script does not begin with a shebang', () => {
    expect(() => patchS90lmd('no shebang here')).toThrow('Unexpected S90lmd format')
  })
})

describe('s10bespok3d-daemon startup script', () => {
  it('points DAEMON_DIR at var/lib/daemon and never the legacy var/lib/demon', () => {
    expect(DAEMON_STARTUP_SCRIPT).toContain('DAEMON_DIR=/userdata/bespok3d/var/lib/daemon')
    expect(DAEMON_STARTUP_SCRIPT).not.toContain('var/lib/demon')
  })

  it('frees port 4269 in the start branch so an orphaned daemon cannot block the bind', () => {
    expect(DAEMON_STARTUP_SCRIPT).toContain('free_port')
    expect(DAEMON_STARTUP_SCRIPT).toMatch(/start\)[\s\S]*free_port/)
  })

  it('defines rotate_log and calls it before nohup in the start branch', () => {
    expect(DAEMON_STARTUP_SCRIPT).toContain('rotate_log()')
    const startBlockMatch = DAEMON_STARTUP_SCRIPT.match(/start\)([\s\S]*?);;/)
    expect(startBlockMatch, 'start) branch must exist').toBeTruthy()
    const startBlock = startBlockMatch![1]
    const rotateIndex = startBlock.indexOf('rotate_log')
    const nohupIndex = startBlock.indexOf('nohup')
    expect(rotateIndex).toBeGreaterThanOrEqual(0)
    expect(nohupIndex).toBeGreaterThanOrEqual(0)
    expect(rotateIndex).toBeLessThan(nohupIndex)
  })

  it('rotates unconditionally on every start so retries do not accumulate tracebacks', () => {
    expect(DAEMON_STARTUP_SCRIPT).not.toContain('LOG_MAX_BYTES')
    expect(DAEMON_STARTUP_SCRIPT).not.toContain('rotate_log_if_too_big')
    const rotateBody = DAEMON_STARTUP_SCRIPT.match(/rotate_log\(\)\s*{([\s\S]*?)}/)
    expect(rotateBody, 'rotate_log body must exist').toBeTruthy()
    expect(rotateBody![1]).not.toMatch(/wc -c|LOG_MAX_BYTES|-le|-gt/)
  })

  it('rotates by renaming to .prev so the verify step shows only this attempt log', () => {
    expect(DAEMON_STARTUP_SCRIPT).toMatch(/mv "\$LOG_FILE" "\$LOG_FILE\.prev"/)
    expect(DAEMON_STARTUP_SCRIPT).not.toMatch(/\$LOG_FILE\.1/)
  })
})

describe('isPrinting (preflight print-state parse)', () => {
  function stats(state: string): string {
    return JSON.stringify({ result: { status: { print_stats: { state } } } })
  }

  it('treats printing and paused as busy', () => {
    expect(isPrinting(stats('printing'))).toBe(true)
    expect(isPrinting(stats('paused'))).toBe(true)
  })

  it('treats standby/complete/error as idle', () => {
    expect(isPrinting(stats('standby'))).toBe(false)
    expect(isPrinting(stats('complete'))).toBe(false)
  })

  it('treats unparseable or empty Moonraker output as idle (allow)', () => {
    expect(isPrinting('')).toBe(false)
    expect(isPrinting('not json')).toBe(false)
  })
})

describe('adapter env vars', () => {
  it('sources path values from the shared paths.json, never a second hardcoded copy', () => {
    const adapter = getAdapter('snapmaker-u1')
    expect(adapter, 'snapmaker-u1 adapter must be registered').toBeTruthy()
    function valueOf(name: string): string | undefined {
      return adapter!.envVars.find((envVar) => envVar.name === name)?.value
    }
    expect(valueOf('KLIPPER_SRC')).toBe(PATHS_JSON.KLIPPER_SRC)
    expect(valueOf('RUNTIME_USER')).toBe(PATHS_JSON.RUNTIME_USER)
    expect(valueOf('BESPOK3D')).toBe(PATHS_JSON.BESPOK3D)
    expect(valueOf('MOONRAKER_COMPONENTS')).toBe(PATHS_JSON.MOONRAKER_COMPONENTS)
  })
})

describe('adapter jinni version', () => {
  it('sources the jinni version from the shared version.json, never a second hardcoded copy', () => {
    expect(getAdapter('snapmaker-u1')?.jinniVersion).toBe(VERSION_JSON.jinni_version)
  })
})
