// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage } from '@adapter-sdk'
import type { SshSession, EnrollContext } from '@adapter-sdk'

import { DAEMON_PACKAGE } from '../packages'
import { BESPOK3D, PRINTER_DATA } from '../paths'
import { patchNginx, patchS90lmd } from '../stock-patches'
import { bespok3dIncludeCommand, KLIPPER_INCLUDE, MOONRAKER_INCLUDE } from '../klipper-includes'

// Where bespok3d meets the stock Snapmaker system: its boot sequence, its web server and its Klipper
// and Moonraker configs. Every edit here is minimal and additive, so a printer keeps working exactly
// as it did before, and every one is idempotent, so a re-enroll never doubles it up.

export async function stepDeployS99(ssh: SshSession): Promise<void> {
  const signedPackage = await openSystemPackage(DAEMON_PACKAGE)
  await ssh.putBytes('/etc/init.d/S99bespok3d', signedPackage.payloadBytes('S99bespok3d'))
  await ssh.exec('chmod 755 /etc/init.d/S99bespok3d')
}

export async function stepPatchS90lmd(ssh: SshSession): Promise<void> {
  const content = await ssh.getContent('/etc/init.d/S90lmd')
  const patched = patchS90lmd(content)
  if (patched === content) return
  await ssh.putContent('/etc/init.d/S90lmd', patched)
}

export async function stepStableNetwork(ssh: SshSession): Promise<void> {
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

export async function stepPatchNginx(ssh: SshSession): Promise<void> {
  const content = await ssh.getContent('/etc/nginx/sites-enabled/fluidd')
  const patched = patchNginx(content)
  if (patched === content) return
  await ssh.putContent('/etc/nginx/sites-enabled/fluidd', patched)
}

export async function stepKlipperIncludes(ssh: SshSession, ctx: EnrollContext): Promise<void> {
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
  await ssh.exec(bespok3dIncludeCommand(`${PRINTER_DATA}/config/printer.cfg`, KLIPPER_INCLUDE))
  await ssh.exec(bespok3dIncludeCommand(`${PRINTER_DATA}/config/moonraker.conf`, MOONRAKER_INCLUDE))
}
