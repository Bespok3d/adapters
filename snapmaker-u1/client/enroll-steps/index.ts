import type { EnrollStep } from '@adapter-sdk'

import { uploadAdapterJinni } from '../jinni-deploy'

import { stepEnrollDaemonKey, stepGenerateDaemonCert } from './app-link'
import { stepDeployDaemon } from './daemon-install'
import { stepStartDaemon, stepVerify } from './final-checks'
import { stepPreflight } from './preflight'
import {
  stepDeployS99,
  stepKlipperIncludes,
  stepPatchNginx,
  stepPatchS90lmd,
  stepStableNetwork,
} from './stock-integration'
import { stepCreateWorkspace } from './workspace'
import { stepFixWifiPersistence, stepRebootAndReconnect, stepUnlockOverlay } from './write-layer'

// The enrollment recipe: the ordered list of what turns a stock printer into a bespok3d printer, with
// the plain-language description of each step the app shows while it runs. The steps themselves live
// in the sibling files, one per topic; this file is only the running order.

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
      'Uploads the daemon Python source and the device adapter (jinni) to /userdata/bespok3d/var/lib/daemon/, then provisions the daemon its own isolated Python virtualenv at /userdata/bespok3d/venv with its packages from pre-built wheels. The Moonraker, Klipper, and system Python are never touched.',
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
