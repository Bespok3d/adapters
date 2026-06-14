import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { lookup } from 'dns/promises'

import { app } from 'electron'

import { connect, registerAdapter, shellQuote, devSourcePath } from '@adapter-sdk'
import type { SshSession, EnrollContext, EnrollStep } from '@adapter-sdk'

import { SNAPMAKER_U1_ICON } from './icon'

export function patchNginx(content: string): string {
  const marker = 'bespok3d/etc/nginx/locations'
  if (content.includes(marker)) return content

  const includeLine = '    include /userdata/bespok3d/etc/nginx/locations/*.conf;\n'
  const stripped = content.trimEnd()
  if (!stripped.endsWith('}')) {
    throw new Error('Unexpected nginx config format: file does not end with "}"')
  }
  return stripped.slice(0, -1) + includeLine + '}\n'
}

export function patchS90lmd(content: string): string {
  const marker = 'S99bespok3d'
  if (content.includes(marker)) return content

  const lines = content.split('\n')
  if (!lines[0]?.startsWith('#!')) {
    throw new Error('Unexpected S90lmd format: file does not start with a shebang')
  }
  const hookLine = '[ -x /etc/init.d/S99bespok3d ] && exec /etc/init.d/S99bespok3d "$@"'
  lines.splice(1, 0, hookLine)
  return lines.join('\n')
}

// The U1 path variables live in ONE place: paths.json in the jinni dir. The device-side jinni reads
// it at runtime and the client reads the same file here at enrollment, so the two halves can never
// drift. Derived sub-paths (etc/daemon, run, var/lib) build off the single-sourced BESPOK3D root.
const PATHS: Record<string, string> = loadAdapterPaths()
const BESPOK3D = PATHS.BESPOK3D
const PRINTER_DATA = PATHS.PRINTER_DATA
const DAEMON_BASE = `${BESPOK3D}/var/lib/daemon`

// On-printer bespok3d layout version. Baseline for future system migrations
// that handle breaking changes to how bespok3d arranges things on a printer.
// Lives at $BESPOK3D/etc/version and survives OTA (the /userdata tree persists).
const BESPOK3D_SYSTEM_VERSION = '0.0.1'
const SYSTEM_VERSION_FILE = `${BESPOK3D}/etc/version`
const MOONRAKER_PORT = 7125

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

function jinniFiles(srcBase: string, prefix = ''): string[] {
  return readdirSync(srcBase, { withFileTypes: true }).flatMap((entry) =>
    collectJinniEntry(srcBase, prefix, entry),
  )
}

function daemonSrcPath(): string {
  const devOverride = devSourcePath('daemon')
  if (devOverride) return devOverride
  return app.isPackaged
    ? join(process.resourcesPath, 'daemon')
    : join(app.getAppPath(), '..', '..', '..', 'daemon')
}

// This adapter's jinni (its daemon-side half) is shipped with the adapter and installed next to the
// generic daemon, which loads it as the top-level `bespok3d_jinni` module.
function adapterJinniPath(): string {
  const devOverride = devSourcePath(join('adapters', 'snapmaker-u1', 'jinni'))
  if (devOverride) return devOverride
  return app.isPackaged
    ? join(process.resourcesPath, 'adapters', 'snapmaker-u1', 'jinni')
    : join(app.getAppPath(), '..', '..', '..', 'adapters', 'snapmaker-u1', 'jinni')
}

function loadAdapterPaths(): Record<string, string> {
  return JSON.parse(readFileSync(join(adapterJinniPath(), 'paths.json'), 'utf-8'))
}

async function uploadDaemonFile(ssh: SshSession, srcBase: string, file: string): Promise<void> {
  const content = readFileSync(join(srcBase, file), 'utf-8')
  await ssh.putContent(`${DAEMON_BASE}/${file}`, content)
}

// The overlayfs write layer is "active" while /oem/.debug exists; without it, writes to /oem and /etc
// are lost on the next reboot. A firmware OTA removes it, so its absence is how we tell a printer that
// was updated (needs full recovery) from one whose daemon merely glitched (a repair suffices). This is
// the single source for the flag: both enroll (below) and the repair backstop read it through here.
const OVERLAY_DEBUG_FLAG = '/oem/.debug'

export async function writeLayerActive(ssh: SshSession): Promise<boolean> {
  const out = await ssh.exec(`test -f ${OVERLAY_DEBUG_FLAG} && echo yes || echo no`)
  return out.trim() === 'yes'
}

async function stepUnlockOverlay(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  ctx.overlayWasActive = await writeLayerActive(ssh)
  await ssh.exec(
    `cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf 2>/dev/null || true` +
      ` && touch ${OVERLAY_DEBUG_FLAG}`
  )
}

const POLL_INTERVAL_MS = 3_000
const WIFI_HINT_MS = 42_000
const GIVE_UP_MS = 300_000

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function tryMdnsLookup(hostname: string): Promise<string | null> {
  try {
    const { address } = await lookup(`${hostname}.local`)
    return address
  } catch {
    return null
  }
}

async function tryConnect(ctx: EnrollContext): Promise<boolean> {
  try {
    const session = await connect({
      host: ctx.ip,
      port: ctx.credentials.port,
      user: ctx.credentials.user,
      password: ctx.credentials.password,
    })
    session.close()
    return true
  } catch {
    return false
  }
}

async function pollReconnect(
  ctx: EnrollContext,
  hostname: string,
  start = Date.now(),
  hintSent = false
): Promise<void> {
  if (Date.now() - start >= GIVE_UP_MS)
    throw new Error('Printer did not reconnect; check WiFi and retry from this step')
  await sleep(POLL_INTERVAL_MS)
  if (await tryConnect(ctx)) return
  const elapsed = Date.now() - start
  if (!hintSent && elapsed >= WIFI_HINT_MS) {
    ctx.onProgress?.('⚠ Printer not back yet; toggle WiFi off and on again on your printer, then wait')
    const newIp = await tryMdnsLookup(hostname)
    if (newIp && newIp !== ctx.ip) {
      ctx.onProgress?.(`Printer reconnected at new IP ${newIp}; updating`)
      ctx.ip = newIp
      return
    }
    return pollReconnect(ctx, hostname, start, true)
  }
  return pollReconnect(ctx, hostname, start, hintSent)
}

async function stepRebootAndReconnect(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  if (ctx.overlayWasActive) {
    ctx.onProgress?.('Overlay already active; skipping reboot')
    return
  }
  const hostname = (await ssh.exec('hostname')).trim()
  try {
    await ssh.exec('reboot')
  } catch {
    /* connection dies on reboot; expected */
  }
  ctx.onProgress?.('Waiting for printer to reboot...')
  await pollReconnect(ctx, hostname)
}

async function stepFixWifiPersistence(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `mkdir -p /userdata/cfg` +
      ` && { { grep -q 'network=' /tmp/wpa_supplicant.conf 2>/dev/null` +
      `         && cp -p /tmp/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; }` +
      `       || { grep -q 'network=' /etc/wpa_supplicant.conf 2>/dev/null` +
      `             && cp -p /etc/wpa_supplicant.conf /userdata/cfg/wpa_config.conf; }` +
      `       || true; }` +
      ` && grep -q 'network=' /userdata/cfg/wpa_config.conf 2>/dev/null` +
      ` && ln -sf /userdata/cfg/wpa_config.conf /etc/wpa_supplicant.conf` +
      ` || true`
  )
}

async function stepCreateWorkspace(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await ssh.exec(
    `
    mkdir -p ${BESPOK3D}/bin \
              ${BESPOK3D}/sbin \
              ${BESPOK3D}/etc/daemon \
              ${BESPOK3D}/etc/init.d/autostart \
              ${BESPOK3D}/etc/nginx/locations \
              ${BESPOK3D}/home \
              ${BESPOK3D}/root \
              ${BESPOK3D}/run \
              ${BESPOK3D}/usr/local/plugins \
              ${BESPOK3D}/var/db \
              ${BESPOK3D}/var/lib \
              ${BESPOK3D}/var/log &&
    ([ -f ${SYSTEM_VERSION_FILE} ] || printf '%s\n' '${BESPOK3D_SYSTEM_VERSION}' > ${SYSTEM_VERSION_FILE}) &&
    chmod +t ${BESPOK3D}/run &&
    chown -R ${ctx.runtimeUser}:${ctx.runtimeUser} ${BESPOK3D} &&
    chmod -R 755 ${BESPOK3D}
  `.trim()
  )
}

async function stepDeployS99(ssh: SshSession): Promise<void> {
  const content = readFileSync(join(daemonSrcPath(), 'S99bespok3d'), 'utf-8')
  await ssh.putContent('/etc/init.d/S99bespok3d', content)
  await ssh.exec('chmod 755 /etc/init.d/S99bespok3d')
}

async function stepPatchS90lmd(ssh: SshSession): Promise<void> {
  const content = await ssh.getContent('/etc/init.d/S90lmd')
  const patched = patchS90lmd(content)
  if (patched === content) return
  await ssh.putContent('/etc/init.d/S90lmd', patched)
}

async function stepStableNetwork(ssh: SshSession): Promise<void> {
  await ssh.exec(`rm -rf /oem/dhcpcd`)
  await ssh.exec(
    `
    if [ ! -L /var/db/dhcpcd ]; then
      mkdir -p ${BESPOK3D}/var/db/dhcpcd
      [ -d /var/db/dhcpcd ] && cp -a /var/db/dhcpcd/. ${BESPOK3D}/var/db/dhcpcd/ 2>/dev/null || true
      rm -rf /var/db/dhcpcd
      ln -sf ${BESPOK3D}/var/db/dhcpcd /var/db/dhcpcd
    fi
  `.trim()
  )
  await ssh.exec(
    `
    MAC=$(cat /sys/class/net/wlan0/address 2>/dev/null)
    if [ -n "$MAC" ]; then
      mkdir -p /etc/udev/rules.d
      printf 'SUBSYSTEM=="net", ACTION=="add", KERNEL=="wlan0", RUN+="/sbin/ip link set wlan0 address %s"\\n' "$MAC" \
        > /etc/udev/rules.d/70-wlan0-mac.rules
    fi
  `.trim()
  )
}

async function stepPatchNginx(ssh: SshSession): Promise<void> {
  const content = await ssh.getContent('/etc/nginx/sites-enabled/fluidd')
  const patched = patchNginx(content)
  if (patched === content) return
  await ssh.putContent('/etc/nginx/sites-enabled/fluidd', patched)
}

async function stepKlipperIncludes(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await ssh.exec(
    `
    mkdir -p ${PRINTER_DATA}/config/bespok3d/klipper \
              ${PRINTER_DATA}/config/bespok3d/moonraker \
              ${PRINTER_DATA}/config/bespok3d/data &&
    touch ${PRINTER_DATA}/config/bespok3d/klipper/main.cfg \
          ${PRINTER_DATA}/config/bespok3d/moonraker/main.cfg &&
    chown -R ${ctx.runtimeUser}:${ctx.runtimeUser} ${PRINTER_DATA}/config/bespok3d &&
    chmod -R 755 ${PRINTER_DATA}/config/bespok3d
  `.trim()
  )
  await ssh.exec(
    `grep -q 'bespok3d/klipper' ${PRINTER_DATA}/config/printer.cfg 2>/dev/null || python3 -c "
content = open('${PRINTER_DATA}/config/printer.cfg').read()
marker = '#*# <---------------------- SAVE_CONFIG'
line = '\\n[include bespok3d/klipper/*.cfg]\\n'
idx = content.find(marker)
open('${PRINTER_DATA}/config/printer.cfg', 'w').write(content[:idx]+line+content[idx:] if idx>=0 else content+line)
"`
  )
  await ssh.exec(
    `grep -q 'bespok3d/moonraker' ${PRINTER_DATA}/config/moonraker.conf 2>/dev/null || python3 -c "
content = open('${PRINTER_DATA}/config/moonraker.conf').read()
marker = '#*# <---------------------- SAVE_CONFIG'
line = '\\n[include bespok3d/moonraker/*.cfg]\\n'
idx = content.find(marker)
open('${PRINTER_DATA}/config/moonraker.conf', 'w').write(content[:idx]+line+content[idx:] if idx>=0 else content+line)
"`
  )
}

const PGPY_WHEEL = 'wheels/PGPy-0.6.0-py3-none-any.whl'
const VENV = `${BESPOK3D}/venv`

async function cleanSystemPython(ssh: SshSession): Promise<void> {
  const pkgs = [
    'fastapi', 'uvicorn', 'pydantic', 'pydantic_core', 'uvloop', 'httptools',
    'websockets', 'watchfiles', 'multipart', 'dotenv', 'pgpy', 'annotated_types',
    'starlette', 'click', 'typing_inspection', 'annotated_doc',
  ].join(' ')
  await ssh.exec(
    `cd /oem/overlay/upper/usr/lib/python3.11/site-packages 2>/dev/null &&` +
    ` for p in ${pkgs}; do rm -rf "$p" "$p"-*.dist-info 2>/dev/null; done;` +
    ` rm -f typing_extensions.py typing_extensions.pyc; rm -rf __pycache__ 2>/dev/null; true`
  )
}

async function ensureVenv(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const exists = (await ssh.exec(`test -x ${VENV}/bin/python3 && echo yes || echo no`)).trim()
  if (exists !== 'yes') {
    ctx.onProgress?.('Creating Python virtual environment…')
    await ssh.exec(`python3 -m venv ${VENV}`)
  }
}

async function installVenvDeps(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  const hasPkgs = (await ssh.exec(
    `${VENV}/bin/python3 -c "import fastapi, uvicorn, multipart" 2>/dev/null && echo ok || echo missing`
  )).trim()
  if (hasPkgs !== 'ok') {
    ctx.onProgress?.('Installing daemon packages into venv; this may take a minute…')
    await ssh.exec(`${VENV}/bin/pip install fastapi "uvicorn[standard]" python-multipart`)
  }
  const hasPgpy = (await ssh.exec(
    `${VENV}/bin/python3 -c "import pgpy" 2>/dev/null && echo ok || echo missing`
  )).trim()
  if (hasPgpy !== 'ok') {
    ctx.onProgress?.('Uploading pgpy wheel…')
    await ssh.putBytes(`${DAEMON_BASE}/${PGPY_WHEEL}`, readFileSync(join(src, PGPY_WHEEL)))
    await ssh.exec(`${VENV}/bin/pip install --no-deps ${DAEMON_BASE}/${PGPY_WHEEL}`)
  }
}

function daemonModuleDirs(files: string[]): string[] {
  const dirs = new Set(files.map(dirname).filter((dir) => dir !== '.'))
  return [...dirs]
}

async function uploadAdapterJinni(ssh: SshSession, ctx: EnrollContext): Promise<void> {
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

async function stepDeployDaemon(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const src = daemonSrcPath()
  const files = daemonFiles(src)
  ctx.onProgress?.('Creating directories…')
  const moduleDirs = daemonModuleDirs(files).map((dir) => `${DAEMON_BASE}/${dir}`)
  await ssh.exec(
    `rm -rf ${BESPOK3D}/var/lib/demon ${DAEMON_BASE}` +
      ` && mkdir -p ${DAEMON_BASE}/wheels ${moduleDirs.join(' ')}`
  )
  const total = files.length

  async function uploadFromIndex(index: number): Promise<void> {
    if (index >= total) return
    ctx.onProgress?.(`Uploading source files… ${index + 1}/${total}`)
    await uploadDaemonFile(ssh, src, files[index])
    return uploadFromIndex(index + 1)
  }

  await uploadFromIndex(0)
  await uploadAdapterJinni(ssh, ctx)
  await deployAutostartScript(ssh, ctx, src)
  await cleanSystemPython(ssh)
  await ensureVenv(ssh, ctx)
  await installVenvDeps(ssh, ctx, src)
}

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  ctx.onProgress?.('Installing autostart script…')
  const startupScript = readFileSync(join(src, 's10bespok3d-daemon'), 'utf-8')
  await ssh.putContent(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`, startupScript)
  await ssh.exec(`chmod 755 ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`)
}

async function stepGenerateDaemonCert(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const certExists = await ssh.exec(
    `test -f ${BESPOK3D}/etc/daemon/server.crt && echo yes || echo no`
  )
  if (certExists.trim() === 'yes') {
    ctx.daemonCert = await ssh.getContent(`${BESPOK3D}/etc/daemon/server.crt`)
    return
  }
  await ssh.exec(
    `openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -keyout ${BESPOK3D}/etc/daemon/server.key -out ${BESPOK3D}/etc/daemon/server.crt -sha256 -days 3650 -nodes -subj '/CN=bespok3d-daemon' 2>&1`
  )
  ctx.daemonCert = await ssh.getContent(`${BESPOK3D}/etc/daemon/server.crt`)
}

interface Acl {
  keys: string[]
  roles: Record<string, string>
  labels: Record<string, string>
  tokens: string[]
  token_identity: Record<string, string>
}

const EMPTY_ACL: Acl = { keys: [], roles: {}, labels: {}, tokens: [], token_identity: {} }

async function readAcl(ssh: SshSession): Promise<Acl> {
  const present = await ssh.exec(`test -f ${BESPOK3D}/auth/acl.json && echo yes || echo no`)
  if (present.trim() !== 'yes') return { ...EMPTY_ACL }
  try {
    return { ...EMPTY_ACL, ...JSON.parse(await ssh.getContent(`${BESPOK3D}/auth/acl.json`)) }
  } catch {
    return { ...EMPTY_ACL }
  }
}

function grantedAcl(existing: Acl, identity: string, token: string, role: string, label: string): Acl {
  return {
    keys: existing.keys.includes(identity) ? existing.keys : [...existing.keys, identity],
    roles: { ...existing.roles, [identity]: role },
    labels: { ...existing.labels, [identity]: label },
    tokens: token && !existing.tokens.includes(token) ? [...existing.tokens, token] : existing.tokens,
    token_identity: token ? { ...existing.token_identity, [token]: identity } : existing.token_identity,
  }
}

// Read-modify-write so re-enrolling this computer (or a multi-client ACL) is never clobbered: the
// enroller is admin only when it is the first key in. A second computer never runs this; it uses the
// access-request flow.
async function stepEnrollDaemonKey(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await ssh.exec(`mkdir -p ${BESPOK3D}/auth`)
  const existing = await readAcl(ssh)
  const identity = ctx.clientFingerprint || ctx.clientId || ''
  const token = ctx.daemonToken || ''
  const role = existing.keys.length === 0 ? 'admin' : 'user'
  const next = identity
    ? grantedAcl(existing, identity, token, role, ctx.clientLabel || '')
    : { ...existing, tokens: token && !existing.tokens.includes(token) ? [...existing.tokens, token] : existing.tokens }
  await ssh.putContent(`${BESPOK3D}/auth/acl.json`, JSON.stringify(next, null, 2))
  if (ctx.clientPublicKey) {
    await ssh.putContent(`${BESPOK3D}/auth/trusted_keys.asc`, ctx.clientPublicKey)
  }
}

async function stepStartDaemon(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `[ -f ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon ]` +
      ` && ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon stop 2>/dev/null || true`
  )
  await ssh.exec(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon start`)
  await ssh.exec(
    `sleep 5 && pid=$(cat ${BESPOK3D}/run/bespok3d-daemon.pid 2>/dev/null) && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null || { cat ${BESPOK3D}/var/log/daemon.log >&2; exit 1; }`
  )
}

async function stepVerify(ssh: SshSession): Promise<void> {
  await ssh.exec(
    `test -d ${BESPOK3D} && test -f /etc/init.d/S99bespok3d` +
    ` && pid=$(cat ${BESPOK3D}/run/bespok3d-daemon.pid 2>/dev/null)` +
    ` && [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null` +
    ` || { cat ${BESPOK3D}/var/log/daemon.log >&2; exit 1; }`
  )
}

export function isPrinting(printStatsJson: string): boolean {
  try {
    const state = JSON.parse(printStatsJson)?.result?.status?.print_stats?.state
    return state === 'printing' || state === 'paused'
  } catch {
    return false
  }
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<string | null> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), timeoutMs)
  try {
    const response = await fetch(url, { signal: abort.signal })
    return response.ok ? await response.text() : null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

// Ask Moonraker for the live print state over plain HTTP. Tries the direct API port, then the
// nginx-proxied path (a Moonraker bound to localhost is still reachable through the web server).
// Unreachable on both is treated as idle (allow), matching the daemon guard.
async function printerIsPrinting(host: string): Promise<boolean> {
  const direct = await fetchWithTimeout(`http://${host}:${MOONRAKER_PORT}/printer/objects/query?print_stats`, 3000)
  if (direct !== null) return isPrinting(direct)
  const proxied = await fetchWithTimeout(`http://${host}/printer/objects/query?print_stats`, 3000)
  return proxied !== null ? isPrinting(proxied) : false
}

// Refuse before touching the printer, on two grounds. The firmware sniff is an SSH filesystem check
// because firmware identity is this adapter's concern: Bespok3d's U1 adapter targets the stock
// firmware (the Extended firmware ships /usr/local/bin/extended-config.py and conflicts). The
// mid-print check is a normal Moonraker HTTP call, because enrolling restarts services + reboots and
// must not run mid-print.
async function stepPreflight(ssh: SshSession): Promise<void> {
  const firmware = (await ssh.exec('[ -e /usr/local/bin/extended-config.py ] && echo extended || echo stock')).trim()
  if (firmware === 'extended') {
    throw new Error('This printer runs the Extended firmware, which Bespok3d is not compatible with. Please revert to the stock Snapmaker firmware, then enroll.')
  }
  if (await printerIsPrinting(ssh.host)) {
    throw new Error('The printer is printing or paused. Enrolling restarts services and reboots the printer, so wait for the print to finish, then enroll.')
  }
}

const ENROLL_STEPS: EnrollStep[] = [
  {
    id: 'preflight',
    label: 'Checking the printer',
    detail:
      'Confirms the printer runs stock firmware (Bespok3d is not compatible with the Extended firmware) and is not mid-print, before making any changes.',
    run: (ssh) => stepPreflight(ssh),
  },
  {
    id: 'unlock-overlay',
    label: 'Preparing the printer for changes',
    detail:
      'Touches /oem/.debug to enable the overlayfs write layer. Without this flag, writes to /oem and /etc are lost on the next reboot.',
    run: (ssh, ctx) => stepUnlockOverlay(ssh, ctx),
  },
  {
    id: 'fix-wifi-persistence',
    label: 'Persisting WiFi credentials',
    detail:
      'Copies the active wpa_supplicant config to /userdata/cfg/wpa_config.conf and symlinks /etc/wpa_supplicant.conf there. Ensures WiFi reconnects automatically on future reboots without waiting for lmd.',
    run: (ssh) => stepFixWifiPersistence(ssh),
  },
  {
    id: 'reboot-and-reconnect',
    label: 'Rebooting to activate the write layer',
    detail:
      'Reboots the printer so the overlayfs write layer takes effect. Waits up to 5 minutes for reconnection; prompts to check WiFi at 60 seconds if unreachable.',
    run: (ssh, ctx) => stepRebootAndReconnect(ssh, ctx),
  },
  {
    id: 'create-workspace',
    label: 'Creating the bespok3d workspace',
    detail:
      'Creates /userdata/bespok3d/ directory tree (bin, etc/init.d, nginx/locations, plugins, run, var/…). Sets sticky bit on run/ for PID files and chowns everything to the runtime user.',
    run: (ssh, ctx) => stepCreateWorkspace(ssh, ctx),
  },
  {
    id: 'deploy-s99',
    label: 'Installing the startup manager',
    detail:
      'Writes /etc/init.d/S99bespok3d: the bespok3d init.d dispatcher. At boot it iterates /userdata/bespok3d/etc/init.d/autostart/ and starts each plugin in order.',
    run: (ssh) => stepDeployS99(ssh),
  },
  {
    id: 'patch-s90lmd',
    label: 'Wiring bespok3d into the boot sequence',
    detail:
      'Downloads /etc/init.d/S90lmd (the OEM Snapmaker boot script), inserts a one-line hook after the shebang that transfers control to S99bespok3d, then re-uploads. Idempotent; skipped if already patched.',
    run: (ssh) => stepPatchS90lmd(ssh),
  },
  {
    id: 'stable-network',
    label: 'Keeping network settings stable across reboots',
    detail:
      'Moves the DHCP lease database to /userdata/bespok3d/var/db/dhcpcd (survives reboots) and symlinks the original path. Writes a udev rule to pin the wlan0 MAC address so the printer keeps its IP after kernel reassignment.',
    run: (ssh) => stepStableNetwork(ssh),
  },
  {
    id: 'patch-nginx',
    label: 'Setting up the web server for plugins',
    detail:
      'Inserts `include /userdata/bespok3d/etc/nginx/locations/*.conf;` before the closing brace of /etc/nginx/sites-enabled/fluidd. Plugins drop their own nginx location blocks here. Idempotent.',
    run: (ssh) => stepPatchNginx(ssh),
  },
  {
    id: 'klipper-includes',
    label: 'Connecting Klipper and Moonraker to the plugin system',
    detail:
      'Creates /oem/printer_data/config/bespok3d/{klipper,moonraker,data}/ with empty main.cfg placeholders. Appends [include bespok3d/klipper/*.cfg] to printer.cfg and [include bespok3d/moonraker/*.cfg] to moonraker.conf. Both are idempotent.',
    run: (ssh, ctx) => stepKlipperIncludes(ssh, ctx),
  },
  {
    id: 'deploy-daemon',
    label: 'Deploying the bespok3d daemon',
    detail:
      'Uploads the daemon Python source to /userdata/bespok3d/var/lib/daemon/ and installs pgpy in the Moonraker Python environment for package signature verification.',
    run: (ssh, ctx) => stepDeployDaemon(ssh, ctx),
  },
  {
    id: 'generate-daemon-cert',
    label: 'Generating daemon TLS certificate',
    detail:
      'Creates a self-signed EC P-256 certificate and key at /userdata/bespok3d/etc/daemon/. The daemon will serve HTTPS with this cert; it is pinned in your printer record.',
    run: (ssh, ctx) => stepGenerateDaemonCert(ssh, ctx),
  },
  {
    id: 'enroll-daemon-key',
    label: 'Enrolling access credentials',
    detail:
      'Writes your bearer token and GPG public key to the daemon ACL at /userdata/bespok3d/auth/. Only devices holding this token can reach the daemon.',
    run: (ssh, ctx) => stepEnrollDaemonKey(ssh, ctx),
  },
  {
    id: 'start-daemon',
    label: 'Starting the daemon',
    detail:
      'Installs the s10bespok3d-daemon autostart script and launches the daemon. Verifies the process is running before continuing.',
    run: (ssh) => stepStartDaemon(ssh),
  },
  {
    id: 'verify',
    label: 'Verifying the installation',
    detail:
      'Checks that /userdata/bespok3d/ exists, /etc/init.d/S99bespok3d is present, and the daemon PID file was created.',
    run: (ssh) => stepVerify(ssh),
  },
]

// Maintenance steps run by ops (not part of the enroll sequence). deploy-jinni re-uploads only the
// device-side adapter (jinni), a subset of deploy-daemon, for the standalone jinni update.
const OP_STEPS: EnrollStep[] = [
  {
    id: 'deploy-jinni',
    label: 'Updating the adapter jinni',
    detail:
      'Re-uploads the device-side adapter (jinni) files to /userdata/bespok3d/var/lib/daemon/. The daemon source, cert, and plugins are left untouched.',
    run: (ssh, ctx) => uploadAdapterJinni(ssh, ctx),
  },
]

const ENV_VARS = [
  {
    name: 'BESPOK3D',
    value: PATHS.BESPOK3D,
    description: 'Workspace root: all bespok3d files live under here',
  },
  {
    name: 'BESPOK3D_DAEMON',
    value: `${BESPOK3D}/etc/daemon`,
    description: 'Daemon identity store: keypair and TLS cert live here, never leave the printer',
  },
  {
    name: 'BESPOK3D_PLUGINS',
    value: PATHS.BESPOK3D_PLUGINS,
    description: 'Plugin installation directory: one sub-dir per plugin',
  },
  {
    name: 'BESPOK3D_AUTOSTART',
    value: `${BESPOK3D}/etc/init.d/autostart`,
    description: 'Drop init scripts here to have them auto-started at boot by S99bespok3d',
  },
  {
    name: 'BESPOK3D_NGINX',
    value: `${BESPOK3D}/etc/nginx/locations`,
    description: 'Drop *.conf files here to expose plugin endpoints through the printer nginx',
  },
  {
    name: 'BESPOK3D_LOG',
    value: `${BESPOK3D}/var/log`,
    description: 'Log directory: survives reboots and OTA updates',
  },
  {
    name: 'BESPOK3D_RUN',
    value: `${BESPOK3D}/run`,
    description: 'PID files directory (sticky bit set): cleaned of stale PIDs on each boot',
  },
  {
    name: 'BESPOK3D_LIB',
    value: `${BESPOK3D}/var/lib`,
    description: 'Persistent plugin data: survives reboots and OTA updates',
  },
  {
    name: 'PRINTER_DATA',
    value: PATHS.PRINTER_DATA,
    description: 'OEM printer data root: contains Klipper and Moonraker configs',
  },
  {
    name: 'PRINTER_CFG',
    value: PATHS.PRINTER_CFG,
    description: 'Main Klipper config: plugins append sections here via start commands',
  },
  {
    name: 'MOONRAKER_CFG',
    value: PATHS.MOONRAKER_CFG,
    description: 'Main Moonraker config: plugins append sections here via start commands',
  },
  {
    name: 'KLIPPER_SRC',
    value: PATHS.KLIPPER_SRC,
    description: 'Klipper source root: instrument targets are named relative to here',
  },
  {
    name: 'KLIPPER_EXTRAS',
    value: PATHS.KLIPPER_EXTRAS,
    description: 'Klipper extras directory: plugins symlink Python modules here',
  },
  {
    name: 'MOONRAKER_COMPONENTS',
    value: PATHS.MOONRAKER_COMPONENTS,
    description: 'Moonraker components directory: plugins symlink Python modules here',
  },
  {
    name: 'BESPOK3D_KLIPPER',
    value: PATHS.BESPOK3D_KLIPPER,
    description: 'Drop *.cfg files here to load Klipper extensions; included via printer.cfg',
  },
  {
    name: 'BESPOK3D_MOONRAKER',
    value: PATHS.BESPOK3D_MOONRAKER,
    description: 'Drop *.cfg files here to extend Moonraker; included via moonraker.conf',
  },
  {
    name: 'RUNTIME_USER',
    value: PATHS.RUNTIME_USER,
    description:
      'OS user that owns and runs all bespok3d services and Klipper; use for chown/chmod',
  },
  {
    name: 'SSH_USER',
    value: 'root',
    description: 'SSH authentication user: only relevant during enrollment and remote ops',
  },
]

// Enrolled-AND-intact: the write layer is active (so writes persist) and our workspace exists. A
// firmware OTA wipes the overlay (.debug gone, init hooks gone) while /userdata/bespok3d survives, so
// this goes false on an updated printer - the signal to recover it rather than just repair the daemon.
export async function verifyEnrolled(ssh: SshSession): Promise<boolean> {
  if (!(await writeLayerActive(ssh))) return false
  try {
    await ssh.exec(`test -d ${BESPOK3D}`)
    return true
  } catch {
    return false
  }
}

registerAdapter({
  id: 'snapmaker-u1',
  title: 'Snapmaker U1',
  vendor: 'Snapmaker',
  version: '1.0.0',
  description:
    'Stock firmware adapter for the Snapmaker U1. Connects via SSH as root and installs bespok3d on top of the OEM system without modifying firmware.',
  icon: SNAPMAKER_U1_ICON,
  defaults: {
    sshUser: 'root',
    sshPort: 22,
    sshPasswordHint: 'snapmaker',
    runtimeUser: 'lava',
  },
  envVars: ENV_VARS,
  enrollSteps: ENROLL_STEPS,
  opSteps: OP_STEPS,
  verifyEnrolled,
})
