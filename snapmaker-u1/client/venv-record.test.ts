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
import type { InstalledDistribution, RecordCheck } from './venv-record'

const SITE_PACKAGES = '/venv.example/lib/python3.11/site-packages'
const PAYLOAD_FINGERPRINT = 'a'.repeat(64)
const REBUILT_FINGERPRINT = 'b'.repeat(64)

function installed(state: InstalledDistribution['state'], distInfoName: string, recordFingerprint: string | null = PAYLOAD_FINGERPRINT): InstalledDistribution {
  return { state, recordFingerprint, distInfoPath: `${SITE_PACKAGES}/${distInfoName}` }
}

// Every wheel named reads as the payload's own unless a fingerprint, or null for none, is given for it.
function checkOf(wheelPaths: readonly string[], venvPackages: InstalledDistribution[], wheelFingerprints: Record<string, string | null> = {}): RecordCheck {
  return { installed: venvPackages, wheelFingerprints: new Map([...wheelPaths.map((wheelPath): [string, string | null] => [wheelPath, PAYLOAD_FINGERPRINT]), ...Object.entries(wheelFingerprints)]) }
}

describe('parseRecordCheck', () => {
  it('reads one line per package, then one per wheel, a "-" standing for no fingerprint', () => {
    const checkOutput = [
      `installed\tintact\t${PAYLOAD_FINGERPRINT}\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info`,
      `installed\tunrecorded\t-\t${SITE_PACKAGES}/uvicorn-0.32.0.dist-info`,
      `wheel\t${REBUILT_FINGERPRINT}\t/wheels.example/fastapi-0.115.0-py3-none-any.whl`,
      'wheel\t-\t/wheels.example/uvicorn-0.32.0-py3-none-any.whl',
    ].join('\n')

    expect(parseRecordCheck(checkOutput)).toEqual({
      installed: [installed('intact', 'fastapi-0.115.0.dist-info'), installed('unrecorded', 'uvicorn-0.32.0.dist-info', null)],
      wheelFingerprints: new Map([['/wheels.example/fastapi-0.115.0-py3-none-any.whl', REBUILT_FINGERPRINT], ['/wheels.example/uvicorn-0.32.0-py3-none-any.whl', null]]),
    })
  })

  it('reads an empty venv as no packages', () => {
    expect(parseRecordCheck('\n')).toEqual({ installed: [], wheelFingerprints: new Map() })
  })

  it('refuses a line it cannot read rather than guess the state of a package', () => {
    expect(() => parseRecordCheck(`installed\twhole\t-\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info\n`)).toThrow('Unreadable venv package check line')
    expect(() => parseRecordCheck(`installed\tintact\tnot-a-digest\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info\n`)).toThrow('Unreadable venv package check line')
    expect(() => parseRecordCheck(`intact\t${SITE_PACKAGES}/fastapi-0.115.0.dist-info\n`)).toThrow('Unreadable venv package check line')
  })
})

describe('venvRepair', () => {
  it('leaves alone every wheel whose package is intact and came from it, matching names the way pip does', () => {
    const wheelPaths = ['wheels/PyYAML-6.0.3-cp311-cp311-manylinux_2_17_aarch64.whl', 'wheels/zope.interface-7.0-py3-none-any.whl', 'wheels/python_multipart-0.0.33-py3-none-any.whl']
    const venvPackages = [installed('intact', 'pyyaml-6.0.3.dist-info'), installed('intact', 'zope_interface-7.0.dist-info'), installed('intact', 'python_multipart-0.0.33.dist-info')]

    expect(venvRepair(wheelPaths, checkOf(wheelPaths, venvPackages))).toEqual({ wheelPaths: [], unrecordedDistInfos: [] })
  })

  it('reinstalls a wheel whose package is damaged, missing, or another version', () => {
    const wheelPaths = ['wheels/fastapi-0.115.0-py3-none-any.whl', 'wheels/uvicorn-0.32.0-py3-none-any.whl', 'wheels/starlette-0.38.0-py3-none-any.whl', 'wheels/click-8.1.7-py3-none-any.whl']
    const venvPackages = [installed('damaged', 'fastapi-0.115.0.dist-info'), installed('intact', 'starlette-0.37.0.dist-info'), installed('intact', 'click-8.1.7.dist-info')]

    expect(venvRepair(wheelPaths, checkOf(wheelPaths, venvPackages))).toEqual({ wheelPaths: wheelPaths.slice(0, 3), unrecordedDistInfos: [] })
  })

  it('reinstalls a wheel rebuilt at the version the venv holds, and one it cannot read', () => {
    const wheelPaths = ['wheels/fastapi-0.115.0-py3-none-any.whl', 'wheels/uvicorn-0.32.0-py3-none-any.whl', 'wheels/click-8.1.7-py3-none-any.whl']
    const venvPackages = [installed('intact', 'fastapi-0.115.0.dist-info'), installed('intact', 'uvicorn-0.32.0.dist-info'), installed('intact', 'click-8.1.7.dist-info')]
    const wheelFingerprints = { [wheelPaths[0]]: REBUILT_FINGERPRINT, [wheelPaths[1]]: null }

    expect(venvRepair(wheelPaths, checkOf(wheelPaths, venvPackages, wheelFingerprints))).toEqual({ wheelPaths: wheelPaths.slice(0, 2), unrecordedDistInfos: [] })
  })

  it('names the dist-info dir of a package whose RECORD is gone, so it can be cleared first', () => {
    const wheelPaths = ['wheels/fastapi-0.115.0-py3-none-any.whl']
    const venvPackages = [installed('unrecorded', 'fastapi-0.115.0.dist-info', null)]

    expect(venvRepair(wheelPaths, checkOf(wheelPaths, venvPackages))).toEqual({
      wheelPaths,
      unrecordedDistInfos: [`${SITE_PACKAGES}/fastapi-0.115.0.dist-info`],
    })
  })

  it('names a dist-info dir without a RECORD at another version too, as pip uninstalls that one first', () => {
    const wheelPaths = ['wheels/fastapi-0.115.0-py3-none-any.whl']
    const venvPackages = [installed('unrecorded', 'fastapi-0.114.0.dist-info', null), installed('unrecorded', 'uvicorn-0.32.0.dist-info', null)]

    expect(venvRepair(wheelPaths, checkOf(wheelPaths, venvPackages))).toEqual({
      wheelPaths,
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

function scratchDir(): string {
  const createdDir = mkdtempSync(join(tmpdir(), 'b3d-venv-record-'))
  venvDirs.push(createdDir)

  return createdDir
}

function createdVenv(venvOptions: readonly string[]): { venvDir: string, sitePackages: string } {
  const venvDir = scratchDir()
  execFileSync('python3', ['-m', 'venv', ...venvOptions, venvDir], { stdio: 'pipe' })
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
    const { venvDir, sitePackages } = createdVenv(['--without-pip'])
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

    const checkOutput = execFileSync('sh', ['-c', recordCheckCommand(venvDir, [])]).toString()

    const stateByDistInfo = parseRecordCheck(checkOutput).installed.map((distribution) => [distribution.distInfoPath.split('/').at(-1), distribution.state])
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

const DEMO_SCRIPT = '#!python\nprint("demo tool")\n'

// The bytecode tag of the python every test venv is made from, so the cached .pyc the wheel ships is the
// one pip compiles over, whatever python runs the test.
const VENV_BYTECODE_TAG = execFileSync('python3', ['-I', '-c', 'import sys; print(sys.implementation.cache_tag)']).toString().trim()

// A wheel laid out as the binary distribution format has it: a module and the bytecode its build cached,
// a module and a script sent through the .data dir, and a dist-info dir whose RECORD lists every file.
function demoWheelFiles(moduleSource: string, extraModule: string | null): Record<string, string> {
  const payloadFiles: Record<string, string> = {
    'demo/__init__.py': moduleSource,
    [`demo/__pycache__/__init__.${VENV_BYTECODE_TAG}.pyc`]: 'shipped bytecode',
    'demo-1.0.data/scripts/demo-tool': DEMO_SCRIPT,
    'demo-1.0.dist-info/METADATA': 'Metadata-Version: 2.1\nName: demo\nVersion: 1.0\n',
    'demo-1.0.dist-info/WHEEL': 'Wheel-Version: 1.0\nGenerator: bespok3d-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
    'demo-1.0.dist-info/entry_points.txt': '[console_scripts]\ndemo-run = demo:main\n',
    ...(extraModule === null ? {} : { 'demo-1.0.data/purelib/demo_extra.py': extraModule }),
  }
  const recordRows = Object.entries(payloadFiles).map(([wheelPath, fileContent]) => `${wheelPath},${recordHash(fileContent)},${Buffer.byteLength(fileContent)}`)

  return { ...payloadFiles, 'demo-1.0.dist-info/RECORD': `${[...recordRows, 'demo-1.0.dist-info/RECORD,,'].join('\n')}\n` }
}

function builtWheel(payloadFiles: Record<string, string>): string {
  const stagingDir = scratchDir()
  Object.entries(payloadFiles).forEach(([wheelPath, fileContent]) => writeInstalledFile(stagingDir, wheelPath, fileContent))
  const wheelPath = join(scratchDir(), 'demo-1.0-py3-none-any.whl')
  execFileSync('python3', ['-m', 'zipfile', '-c', wheelPath, 'demo', 'demo-1.0.data', 'demo-1.0.dist-info'], { cwd: stagingDir, stdio: 'pipe' })

  return wheelPath
}

function pipInstallFromFile(venvDir: string, pipOptions: readonly string[], wheelPath: string): void {
  execFileSync(join(venvDir, 'bin/python3'), ['-m', 'pip', '--isolated', '--disable-pip-version-check', 'install', '--no-index', '--no-deps', ...pipOptions, wheelPath], { stdio: 'pipe' })
}

function venvCheck(venvDir: string, wheelPaths: readonly string[]): RecordCheck {
  return parseRecordCheck(execFileSync('sh', ['-c', recordCheckCommand(venvDir, wheelPaths)]).toString())
}

function demoFingerprint(check: RecordCheck): string | null | undefined {
  return check.installed.find((distribution) => distribution.distInfoPath.endsWith('/demo-1.0.dist-info'))?.recordFingerprint
}

const REAL_PIP_TIMEOUT_MS = 120_000

// The real pip installs a real wheel, so the check is proven against the RECORD pip itself writes.
describe('recordCheckCommand against what pip installed', () => {
  afterEach(() => {
    venvDirs.splice(0).forEach((venvDir) => rmSync(venvDir, { recursive: true, force: true }))
  })

  it('tells the wheel a package came from apart from one rebuilt at the same version', () => {
    const { venvDir } = createdVenv([])
    const payloadWheel = builtWheel(demoWheelFiles('module source', 'extra module'))
    const editedWheel = builtWheel(demoWheelFiles('module source, edited', 'extra module'))
    const shrunkWheel = builtWheel(demoWheelFiles('module source', null))
    const missingWheel = join(scratchDir(), 'demo-1.0-py3-none-any.whl')
    const unreadableWheel = join(scratchDir(), 'demo-1.0-py3-none-any.whl')
    writeFileSync(unreadableWheel, 'not a zip archive')
    pipInstallFromFile(venvDir, [], payloadWheel)

    const check = venvCheck(venvDir, [payloadWheel, editedWheel, shrunkWheel, missingWheel, unreadableWheel])

    expect(check.installed.find((distribution) => distribution.distInfoPath.endsWith('/demo-1.0.dist-info'))?.state).toBe('intact')
    expect(demoFingerprint(check)).toBe(check.wheelFingerprints.get(payloadWheel))
    expect(new Set([payloadWheel, editedWheel, shrunkWheel].map((wheelPath) => check.wheelFingerprints.get(wheelPath))).size).toBe(3)
    expect([missingWheel, unreadableWheel].map((wheelPath) => check.wheelFingerprints.get(wheelPath))).toEqual([null, null])
    expect(venvRepair([payloadWheel], check).wheelPaths).toEqual([])
    expect(venvRepair([editedWheel], check).wheelPaths).toEqual([editedWheel])
    expect(venvRepair([shrunkWheel], check).wheelPaths).toEqual([shrunkWheel])
  }, REAL_PIP_TIMEOUT_MS)

  it('finds the rebuilt wheel in place once pip has installed it', () => {
    const { venvDir } = createdVenv([])
    const payloadWheel = builtWheel(demoWheelFiles('module source', 'extra module'))
    const editedWheel = builtWheel(demoWheelFiles('module source, edited', 'extra module'))
    pipInstallFromFile(venvDir, [], payloadWheel)
    pipInstallFromFile(venvDir, ['--force-reinstall'], editedWheel)

    const check = venvCheck(venvDir, [payloadWheel, editedWheel])

    expect(demoFingerprint(check)).toBe(check.wheelFingerprints.get(editedWheel))
    expect(venvRepair([editedWheel], check).wheelPaths).toEqual([])
    expect(venvRepair([payloadWheel], check).wheelPaths).toEqual([payloadWheel])
  }, REAL_PIP_TIMEOUT_MS)
})
