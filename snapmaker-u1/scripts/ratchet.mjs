// Size ratchet: makes a god file a failing, visible check, so a concern-mixing file like the old
// 794-line snapmaker-u1.ts cannot re-form unnoticed. Reads adapter-baseline.json and enforces:
//   1. No NEW source file over its per-extension ceiling unless it is an allowlisted exception.
//   2. Equal-or-tighten on each allowlisted file: growth FAILs; a shrink FAILs asking you to lower
//      the baseline (the ratchet click, so an improvement is banked as a reviewed edit).
// The ceiling is a SIGNAL, not the law: when it fires, split the file by concern, or (last resort,
// for one genuinely cohesive concern) allowlist it with a note. Exit 0 only when clean.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADAPTER_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const baseline = JSON.parse(readFileSync(join(ADAPTER_ROOT, 'adapter-baseline.json'), 'utf8'))
const { tsCeiling, pyCeiling, allowlist } = baseline

const SOURCE_DIRS = ['client', 'jinni']
const EXCLUDED_DIRS = new Set(['tests', '__pycache__', '.pytest_cache', 'node_modules', '.venv'])
const EXCLUDED_FILES = new Set(['icon.ts'])

const failures = []
const tighten = []

function lineCount(text) {
  return (text.endsWith('\n') ? text.slice(0, -1) : text).split('\n').length
}

function isSource(name) {
  if (EXCLUDED_FILES.has(name) || name.endsWith('.test.ts')) return false
  return extname(name) === '.ts' || extname(name) === '.py'
}

function sourceFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (EXCLUDED_DIRS.has(entry.name)) return []
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(full)
    return isSource(entry.name) ? [full] : []
  })
}

const ceilingFor = (rel) => (rel.endsWith('.py') ? pyCeiling : tsCeiling)

const observed = {}
for (const dir of SOURCE_DIRS) {
  const base = join(ADAPTER_ROOT, dir)
  if (!existsSync(base)) continue
  for (const file of sourceFiles(base)) {
    observed[relative(ADAPTER_ROOT, file)] = lineCount(readFileSync(file, 'utf8'))
  }
}

for (const [rel, lines] of Object.entries(observed)) {
  if (lines > ceilingFor(rel) && !(rel in allowlist)) {
    failures.push(`NEW over-ceiling: ${rel} (${lines} > ${ceilingFor(rel)}) - split it by concern, or allowlist with sign-off`)
  }
}

for (const [rel, base] of Object.entries(allowlist)) {
  const current = observed[rel]
  if (current === undefined) {
    failures.push(`allowlisted file missing or no longer a source file: ${rel} (update adapter-baseline.json)`)
  } else if (current > base) {
    failures.push(`GROWTH ${rel}: ${current} > baseline ${base} lines - split it, do not grow it`)
  } else if (current < base) {
    tighten.push(`${rel}: lower baseline ${base} -> ${current}`)
  }
}

if (failures.length === 0 && tighten.length === 0) {
  console.log(`ratchet ok - ${Object.keys(observed).length} source files, ${Object.keys(allowlist).length} allowlisted`)
  process.exit(0)
}
if (tighten.length) {
  console.error(`Ratchet: ${tighten.length} improvement(s) not banked - lower these in adapter-baseline.json:`)
  for (const message of tighten) console.error(`  - ${message}`)
}
if (failures.length) {
  console.error(`Ratchet: ${failures.length} failure(s):`)
  for (const message of failures) console.error(`  - ${message}`)
}
process.exit(1)
