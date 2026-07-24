import { readFileSync } from 'fs'
import { join } from 'path'

import { shellQuote } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { daemonFiles, daemonModuleDirs, jinniFiles, uploadDaemonFile } from './deploy'
import { DAEMON_BASE, adapterJinniPath, klipperJinniPath } from './paths'

// Deploying the jinni onto the printer has two halves since the ADR-0037 split: the SHARED klipper
// jinni runtime (the `jinni` package) and this DEVICE adapter's jinni (`bespok3d_jinni`). The daemon
// spawns `python -m jinni` and the device jinni imports `from jinni import ...`, so both co-locate
// next to the daemon under DAEMON_BASE. Enrollment and the standalone jinni-update op both run this.

// The shared klipper jinni runtime, pure python, discovered like the daemon and placed at
// DAEMON_BASE/jinni so `import jinni` and `python -m jinni` resolve on the printer.
async function uploadKlipperJinni(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const src = klipperJinniPath()
  const files = daemonFiles(src)
  const dirs = [
    `${DAEMON_BASE}/jinni`,
    ...daemonModuleDirs(files).map((dir) => `${DAEMON_BASE}/jinni/${dir}`),
  ]
  await ssh.exec(`mkdir -p ${dirs.map(shellQuote).join(' ')}`)

  async function uploadFromIndex(index: number): Promise<void> {
    if (index >= files.length) return
    ctx.onProgress?.(`Uploading jinni runtime… ${index + 1}/${files.length}`)
    await ssh.putContent(`${DAEMON_BASE}/jinni/${files[index]}`, readFileSync(join(src, files[index]), 'utf-8'))

    return uploadFromIndex(index + 1)
  }

  await uploadFromIndex(0)
}

export async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await uploadKlipperJinni(ssh, ctx)
  const jinniSrc = adapterJinniPath()
  const files = jinniFiles(jinniSrc)
  const jinniDirs = daemonModuleDirs(files).map((dir) => `${DAEMON_BASE}/${dir}`)
  if (jinniDirs.length > 0) await ssh.exec(`mkdir -p ${jinniDirs.map(shellQuote).join(' ')}`)

  async function uploadFromIndex(index: number): Promise<void> {
    if (index >= files.length) return
    ctx.onProgress?.(`Uploading adapter jinni… ${index + 1}/${files.length}`)
    await uploadDaemonFile(ssh, jinniSrc, files[index])

    return uploadFromIndex(index + 1)
  }

  await uploadFromIndex(0)
}
