// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { wifiPersistenceCommand } from './wifi-persistence'

const SAVED_NETWORK = 'ctrl_interface=/var/run/wpa_supplicant\nnetwork={\n\tssid="test-lan"\n}\n'
const OLDER_NETWORK = 'network={\n\tssid="old-lan"\n}\n'
const NO_NETWORK = 'ctrl_interface=/var/run/wpa_supplicant\nupdate_config=1\n'

interface PrinterTree {
  root: string
  livePath: string
  persistentPath: string
  screenConnection: string
  screenCopy: string
}

const createdTrees: string[] = []

function printerTree(): PrinterTree {
  var root = mkdtempSync(join(tmpdir(), 'wifi-persistence-'))
  createdTrees.push(root)
  mkdirSync(join(root, 'etc'))

  return {
    root,
    livePath: join(root, 'etc/wpa_supplicant.conf'),
    persistentPath: join(root, 'userdata/cfg/wpa_config.conf'),
    screenConnection: join(root, 'tmp-wpa_supplicant.conf'),
    screenCopy: join(root, 'gui-wpa_supplicant.conf'),
  }
}

// The command runs in a real shell, so what is checked is what the printer's shell does with it.
function persistWifi(tree: PrinterTree): void {
  var credentialSources = [tree.screenConnection, tree.livePath, tree.screenCopy]
  execFileSync('sh', ['-c', wifiPersistenceCommand(tree.livePath, tree.persistentPath, credentialSources)], { stdio: 'pipe' })
}

function shellError(tree: PrinterTree): string {
  try {
    persistWifi(tree)
  } catch (error) {
    return String((error as { stderr: Buffer }).stderr)
  }

  return 'the command succeeded'
}

afterEach(() => {
  createdTrees.splice(0).forEach((root) => {
    chmodSync(join(root, 'etc'), 0o755)
    rmSync(root, { recursive: true })
  })
})

describe('wifiPersistenceCommand refusing to show done', () => {
  // The bug: the old step ended in `|| true`, so it showed done on a printer it had not fixed.
  it('fails with a plain message when no saved network is found', () => {
    var tree = printerTree()
    writeFileSync(tree.livePath, NO_NETWORK)

    expect(shellError(tree)).toContain('No saved Wi-Fi network was found on the printer')
    expect(lstatSync(tree.livePath).isSymbolicLink()).toBe(false)
  })

  it('fails with a plain message when the link to the saved Wi-Fi is not kept', () => {
    var tree = printerTree()
    writeFileSync(tree.screenConnection, SAVED_NETWORK)
    chmodSync(join(tree.root, 'etc'), 0o555)

    expect(shellError(tree)).toContain('The printer did not keep the link to its saved Wi-Fi')
  })

  it('fails with a plain message instead of keeping an older network when the copy cannot be saved', () => {
    var tree = printerTree()
    mkdirSync(join(tree.root, 'userdata/cfg'), { recursive: true })
    writeFileSync(tree.persistentPath, OLDER_NETWORK)
    chmodSync(tree.persistentPath, 0o444)
    writeFileSync(tree.screenConnection, SAVED_NETWORK)

    expect(shellError(tree)).toContain('The printer could not save its Wi-Fi network to its storage')
  })
})

describe('wifiPersistenceCommand on a printer enrolled for the first time', () => {
  it('keeps the network the screen last connected with and points the live config at it', () => {
    var tree = printerTree()
    writeFileSync(tree.screenConnection, SAVED_NETWORK)
    writeFileSync(tree.livePath, NO_NETWORK)

    persistWifi(tree)

    expect(readFileSync(tree.persistentPath, 'utf-8')).toBe(SAVED_NETWORK)
    expect(readlinkSync(tree.livePath)).toBe(tree.persistentPath)
  })

  it('falls back to the screen saved copy when the live config has no network', () => {
    var tree = printerTree()
    writeFileSync(tree.livePath, NO_NETWORK)
    writeFileSync(tree.screenCopy, SAVED_NETWORK)

    persistWifi(tree)

    expect(readFileSync(tree.persistentPath, 'utf-8')).toBe(SAVED_NETWORK)
    expect(readlinkSync(tree.livePath)).toBe(tree.persistentPath)
  })
})

describe('wifiPersistenceCommand on a printer enrolled before', () => {
  it('runs again on a printer whose live config already points at the kept one, keeping its network', () => {
    var tree = printerTree()
    mkdirSync(join(tree.root, 'userdata/cfg'), { recursive: true })
    writeFileSync(tree.persistentPath, SAVED_NETWORK)
    symlinkSync(tree.persistentPath, tree.livePath)
    writeFileSync(tree.screenCopy, OLDER_NETWORK)

    persistWifi(tree)

    expect(readFileSync(tree.persistentPath, 'utf-8')).toBe(SAVED_NETWORK)
    expect(readlinkSync(tree.livePath)).toBe(tree.persistentPath)
  })

  it('looks past a kept config that lost its network and keeps the screen saved copy', () => {
    var tree = printerTree()
    mkdirSync(join(tree.root, 'userdata/cfg'), { recursive: true })
    writeFileSync(tree.persistentPath, NO_NETWORK)
    symlinkSync(tree.persistentPath, tree.livePath)
    writeFileSync(tree.screenCopy, SAVED_NETWORK)

    persistWifi(tree)

    expect(readFileSync(tree.persistentPath, 'utf-8')).toBe(SAVED_NETWORK)
    expect(readlinkSync(tree.livePath)).toBe(tree.persistentPath)
  })
})
