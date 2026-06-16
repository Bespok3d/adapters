import { readFileSync } from 'fs'
import { join } from 'path'

import type { SshSession, EnrollContext, EnrollStep } from '@adapter-sdk'

import { readAcl, grantedAcl } from './acl'
import { daemonFiles, daemonModuleDirs, uploadDaemonFile } from './deploy'
import { uploadAdapterJinni } from './jinni-deploy'
import { OVERLAY_DEBUG_FLAG, writeLayerActive } from './overlay'
import {
  BESPOK3D,
  BESPOK3D_SYSTEM_VERSION,
  DAEMON_BASE,
  PRINTER_DATA,
  SYSTEM_VERSION_FILE,
  daemonSrcPath,
} from './paths'
import { printerIsPrinting } from './print-state'
import { pollReconnect } from './reconnect'
import { patchNginx, patchS90lmd } from './stock-patches'
import { cleanSystemPython, ensureVenv, installVenvDeps } from './venv'

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

async function stepUnlockOverlay(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  ctx.overlayWasActive = await writeLayerActive(ssh)
  await ssh.exec(
    `cp /oem/printer_data/gui/wpa_supplicant.conf /etc/wpa_supplicant.conf 2>/dev/null || true` +
      ` && touch ${OVERLAY_DEBUG_FLAG}`
  )
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

async function deployAutostartScript(ssh: SshSession, ctx: EnrollContext, src: string): Promise<void> {
  ctx.onProgress?.('Installing autostart script…')
  const startupScript = readFileSync(join(src, 's10bespok3d-daemon'), 'utf-8')
  await ssh.putContent(`${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`, startupScript)
  await ssh.exec(`chmod 755 ${BESPOK3D}/etc/init.d/autostart/s10bespok3d-daemon`)
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

export const ENROLL_STEPS: EnrollStep[] = [
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
export const OP_STEPS: EnrollStep[] = [
  {
    id: 'deploy-jinni',
    label: 'Updating the adapter jinni',
    detail:
      'Re-uploads the device-side adapter (jinni) files to /userdata/bespok3d/var/lib/daemon/. The daemon source, cert, and plugins are left untouched.',
    run: (ssh, ctx) => uploadAdapterJinni(ssh, ctx),
  },
]
