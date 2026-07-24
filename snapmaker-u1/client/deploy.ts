import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'

import type { SshSession } from '@adapter-sdk'

import { DAEMON_BASE } from './paths'

// The daemon is just a file tree deployed over SSH (ADR-0030: daemon-as-plugin, bootstrap is the
// only difference), so its deployable modules are DISCOVERED from the source tree rather than
// hand-listed. Anything that is not a runtime module (tests, the venv, caches, prebuilt wheels) is
// skipped; wheels are deployed by the venv step.
const NON_DEPLOY_DIRS = new Set(['tests', '.venv', '__pycache__', 'wheels', 'scripts', '.github'])

function collectDaemonEntry(
  dir: string,
  prefix: string,
  entry: { name: string; isDirectory(): boolean },
): string[] {
  if (NON_DEPLOY_DIRS.has(entry.name)) return []
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isDirectory()) return daemonFiles(join(dir, entry.name), relativePath)

  return entry.name.endsWith('.py') ? [relativePath] : []
}

export function daemonFiles(srcBase: string, prefix = ''): string[] {
  return readdirSync(srcBase, { withFileTypes: true }).flatMap((entry) =>
    collectDaemonEntry(srcBase, prefix, entry),
  )
}

// The jinni ships every asset it carries (its python module and its shell templates), not just
// python, so it is discovered with no extension filter (tests and caches still skipped).
function collectJinniEntry(
  dir: string,
  prefix: string,
  entry: { name: string; isDirectory(): boolean },
): string[] {
  if (NON_DEPLOY_DIRS.has(entry.name)) return []
  const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
  if (entry.isDirectory()) return jinniFiles(join(dir, entry.name), relativePath)

  return [relativePath]
}

export function jinniFiles(srcBase: string, prefix = ''): string[] {
  return readdirSync(srcBase, { withFileTypes: true }).flatMap((entry) =>
    collectJinniEntry(srcBase, prefix, entry),
  )
}

export function daemonModuleDirs(files: string[]): string[] {
  const dirs = new Set(files.map(dirname).filter((dir) => dir !== '.'))

  return [...dirs]
}

export async function uploadDaemonFile(ssh: SshSession, srcBase: string, file: string): Promise<void> {
  const content = readFileSync(join(srcBase, file), 'utf-8')
  await ssh.putContent(`${DAEMON_BASE}/${file}`, content)
}
