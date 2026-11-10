// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, it, expect, vi, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

// The SDK's shell quoting and nothing else: the real loader drags electron in behind it.
vi.mock('@adapter-sdk', async () => await import('./fake-sdk'))

import { parseRecordCheck, recordCheckCommand, venvRepair } from './venv-record'
import type { InstalledDistribution } from './venv-record'

const SITE_PACKAGES = '/venv.example/lib/python3.11/site-packages'

function installed(state: InstalledDistribution['state'], distInfoName: string): InstalledDistribution {
  return { state, distInfoPath: `${SITE_PACKAGES}/${distInfoName}` }
}

describe('parseRecordCheck', () => {
  it('reads one package per line, its state then its dist-info dir', () => {
    const checkOutput = `intact\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info\nunrecorded\t${SITE_PACKAGES}/uvicorn-0.32.0.dist-info\n`

    expect(parseRecordCheck(checkOutput)).toEqual([installed('intact', 'fastapi-0.115.0.dist-info'), installed('unrecorded', 'uvicorn-0.32.0.dist-info')])
  })

  it('reads an empty venv as no packages', () => {
    expect(parseRecordCheck('\n')).toEqual([])
  })

  it('refuses a line it cannot read rather than guess the state of a package', () => {
    expect(() => parseRecordCheck(`whole\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info\n`)).toThrow('Unreadable venv package check line')
  })
})

describe('venvRepair', () => {
  it('leaves alone every wheel whose package is intact, matching names the way pip does', () => {
    const wheelPaths = ['wheels/PyYAML-6.0.3-cp311-cp311-manylinux_2_17_aarch64.whl', 'wheels/zope.interface-7.0-py3-none-any.whl', 'wheels/python_multipart-0.0.33-py3-none-any.whl']
    const venvPackages = [installed('intact', 'pyyaml-6.0.3.dist-info'), installed('intact', 'zope_interface-7.0.dist-info'), installed('intact', 'python_multipart-0.0.33.dist-info')]

    expect(venvRepair(wheelPaths, venvPackages)).toEqual({ wheelPaths: [], unrecordedDistInfos: [] })
  })

  it('reinstalls a wheel whose package is damaged, missing, or another version', () => {
    const wheelPaths = ['wheels/fastapi-0.115.0-py3-none-any.whl', 'wheels/uvicorn-0.32.0-py3-none-any.whl', 'wheels/starlette-0.38.0-py3-none-any.whl', 'wheels/click-8.1.7-py3-none-any.whl']
    const venvPackages = [installed('damaged', 'fastapi-0.115.0.dist-info'), installed('intact', 'starlette-0.37.0.dist-info'), installed('intact', 'click-8.1.7.dist-info')]

    expect(venvRepair(wheelPaths, venvPackages)).toEqual({ wheelPaths: wheelPaths.slice(0, 3), unrecordedDistInfos: [] })
  })

  it('names the dist-info dir of a package whose RECORD is gone, so it can be cleared first', () => {
    const venvPackages = [installed('unrecorded', 'fastapi-0.115.0.dist-info')]

    expect(venvRepair(['wheels/fastapi-0.115.0-py3-none-any.whl'], venvPackages)).toEqual({
      wheelPaths: ['wheels/fastapi-0.115.0-py3-none-any.whl'],
      unrecordedDistInfos: [`${SITE_PACKAGES}/fastapi-0.115.0.dist-info`],
    })
  })

  it('names a dist-info dir without a RECORD at another version too, as pip uninstalls that one first', () => {
    const venvPackages = [installed('unrecorded', 'fastapi-0.114.0.dist-info'), installed('unrecorded', 'uvicorn-0.32.0.dist-info')]

    expect(venvRepair(['wheels/fastapi-0.115.0-py3-none-any.whl'], venvPackages)).toEqual({
      wheelPaths: ['wheels/fastapi-0.115.0-py3-none-any.whl'],
      unrecordedDistInfos: [`${SITE_PACKAGES}/fastapi-0.114.0.dist-info`],
    })
  })
})

const venvDirs: string[] = []

function recordHash(fileContent: string): string {
  return `sha256=${createHash('sha256').update(fileContent).digest('base64url')}`
}

function writeInstalledFile(sitePackages: string, recordPath: string, fileContent: string | Buffer): void {
  mkdirSync(dirname(join(sitePackages, recordPath)), { recursive: true })
  writeFileSync(join(sitePackages, recordPath), fileContent)
}

function emptyVenv(): { venvDir: string, sitePackages: string } {
  const venvDir = mkdtempSync(join(tmpdir(), 'b3d-venv-record-'))
  venvDirs.push(venvDir)
  execFileSync('python3', ['-m', 'venv', '--without-pip', venvDir], { stdio: 'pipe' })
  const sitePackages = execFileSync(join(venvDir, 'bin/python3'), ['-I', '-c', 'import sysconfig; print(sysconfig.get_path("purelib"))']).toString().trim()

  return { venvDir, sitePackages }
}

// Every package holds a module, a script outside site-packages, a row pip writes with no hash, a cached
// .pyc the wheel shipped and pip compiled over, whose recorded hash is stale, and a sourceless .pyc.
function installPackage(sitePackages: string, nameVersion: string, installedModule: string): void {
  const recordRows = [
    `${nameVersion}/__init__.py,${recordHash('module source')},13`,
    `../../../bin/${nameVersion},${recordHash('script')},6`,
    `${nameVersion}/__pycache__/__init__.cpython-311.pyc,,`,
    `${nameVersion}/__pycache__/shipped.cpython-311.pyc,${recordHash('shipped bytecode')},16`,
    `${nameVersion}/sourceless.pyc,${recordHash('sourceless bytecode')},19`,
    `${nameVersion}.dist-info/RECORD,,`,
  ]
  writeInstalledFile(sitePackages, `${nameVersion}/__init__.py`, installedModule)
  writeInstalledFile(sitePackages, `../../../bin/${nameVersion}`, 'script')
  writeInstalledFile(sitePackages, `${nameVersion}/__pycache__/shipped.cpython-311.pyc`, 'recompiled bytecode')
  writeInstalledFile(sitePackages, `${nameVersion}/sourceless.pyc`, 'sourceless bytecode')
  writeInstalledFile(sitePackages, `${nameVersion}.dist-info/RECORD`, `${recordRows.join('\n')}\n`)
}

// A package of one module, whose only RECORD row carries the digest field given.
function installOneRowPackage(sitePackages: string, nameVersion: string, digestField: string): void {
  writeInstalledFile(sitePackages, `${nameVersion}/__init__.py`, 'module source')
  writeInstalledFile(sitePackages, `${nameVersion}.dist-info/RECORD`, `${nameVersion}/__init__.py,${digestField},13\n`)
}

// The check script runs for real, under a venv's own python, over packages laid out the way pip lays them.
describe('recordCheckCommand on a real venv', () => {
  afterEach(() => {
    venvDirs.splice(0).forEach((venvDir) => rmSync(venvDir, { recursive: true, force: true }))
  })

  it('finds each package whole, damaged, or without a readable RECORD', () => {
    const { venvDir, sitePackages } = emptyVenv()
    installPackage(sitePackages, 'whole-1.0', 'module source')
    installPackage(sitePackages, 'edited-1.0', 'module source, edited')
    installPackage(sitePackages, 'lost-1.0', 'module source')
    rmSync(join(sitePackages, 'lost-1.0/__init__.py'))
    installPackage(sitePackages, 'bytecode-1.0', 'module source')
    writeFileSync(join(sitePackages, 'bytecode-1.0/sourceless.pyc'), 'truncated')
    mkdirSync(join(sitePackages, 'norecord-1.0.dist-info'))
    writeInstalledFile(sitePackages, 'garbled-1.0.dist-info/RECORD', Buffer.from([0xff, 0xfe, 0x2c]))
    writeInstalledFile(sitePackages, 'blank-1.0.dist-info/RECORD', '\n,,\nblank-1.0.dist-info/RECORD,,\n')
    installOneRowPackage(sitePackages, 'undigested-1.0', 'nodigest')
    installOneRowPackage(sitePackages, 'unknownhash-1.0', 'md9=AAAA')
    installOneRowPackage(sitePackages, 'shakehash-1.0', 'shake_128=AAAA')

    const checkOutput = execFileSync('sh', ['-c', recordCheckCommand(venvDir)]).toString()

    const stateByDistInfo = parseRecordCheck(checkOutput).map((distribution) => [distribution.distInfoPath.split('/').at(-1), distribution.state])
    expect(stateByDistInfo).toEqual([
      ['blank-1.0.dist-info', 'unrecorded'],
      ['bytecode-1.0.dist-info', 'damaged'],
      ['edited-1.0.dist-info', 'damaged'],
      ['garbled-1.0.dist-info', 'unrecorded'],
      ['lost-1.0.dist-info', 'damaged'],
      ['norecord-1.0.dist-info', 'unrecorded'],
      ['shakehash-1.0.dist-info', 'damaged'],
      ['undigested-1.0.dist-info', 'damaged'],
      ['unknownhash-1.0.dist-info', 'damaged'],
      ['whole-1.0.dist-info', 'intact'],
    ])
  })
})
