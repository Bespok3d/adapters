// RULE ZERO guard: fail if any authored adapter file contains an em-dash or en-dash. No linter
// enforces this, so this guard walks the adapter (client TS + jinni Python + scripts) and exits
// non-zero on any offender. The dash codepoints are written as escapes so the guard never trips on
// itself. Mirrors the daemon's em_dash_guard.py, which is daemon-rooted and does not scan .ts.
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADAPTER_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const EM_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)
const SCANNED = new Set(['.ts', '.py', '.sh', '.mjs', '.json', '.md'])
const EXCLUDED_DIRS = new Set([
  'node_modules', '.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.git',
])

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDED_DIRS.has(entry.name)) return []
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return SCANNED.has(extname(entry.name)) ? [full] : []
  })
}

const offenders = sourceFiles(ADAPTER_ROOT).filter((file) => {
  const text = readFileSync(file, 'utf8')
  return text.includes(EM_DASH) || text.includes(EN_DASH)
})

if (offenders.length > 0) {
  console.error('Banned em-dash / en-dash found in:')
  for (const file of offenders) console.error(`  ${file}`)
  process.exit(1)
}
