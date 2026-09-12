// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { openSystemPackage, shellQuote } from '@adapter-sdk'
import type { BundledPackage, EnrollContext, SshSession } from '@adapter-sdk'

import { ADAPTER_JINNI_PACKAGE } from './packages'
import { bespok3dRoot, venvDir } from './paths'
import { asRoot } from './privilege'
import { remoteHome, runtimeUser } from './remote'

// Registering Bespok3d with the printer's init system, and the sudoers drop-in that is the only root
// it keeps afterwards.
//
// Every file here is rendered from a template that ships in the signed jinni package, never from the
// checkout the app was built from, so what a printer runs at boot is what was signed. The templates
// carry the login user, the workspace root and the daemon's interpreter as sentinels, because none of
// those is knowable until the app has logged in to this particular printer.
//
// The sudoers file is validated with `visudo -cf` BEFORE it is installed: a sudoers file that does
// not parse takes sudo down for every user on the box, which on a printer is unrecoverable without
// physically pulling the card.

export interface TemplateValues {
  USER: string
  BESPOK3D: string
  VENV: string
}

interface ServiceDeploy {
  ssh: SshSession
  ctx: EnrollContext
  home: string
  jinni: BundledPackage
  values: TemplateValues
}

const UNIT_DIR = '/etc/systemd/system'
const UNITS = ['bespok3d.service', 'bespok3d-plugins.service']
const SERVICES = 'bespok3d bespok3d-plugins'
const SUDOERS_SOURCE = 'bespok3d.sudoers'
const SUDOERS_TARGET = '/etc/sudoers.d/bespok3d'
// The two shell scripts that keep the app's daemon operations speaking the same init.d dialect they
// speak on every other adapter, with systemd underneath instead of busybox init.
const BOOT_SCRIPTS = [
  { source: 'bespok3d-plugins.sh', target: 'etc/init.d/bespok3d-plugins' },
  { source: 's10bespok3d-daemon.sh', target: 'etc/init.d/autostart/s10bespok3d-daemon' },
]

export function renderTemplate(text: string, values: TemplateValues): string {
  return Object.entries(values).reduce(
    (rendered, [sentinel, value]) => rendered.split(`__${sentinel}__`).join(value),
    text
  )
}

function stagingDir(home: string): string {
  return `${bespok3dRoot(home)}/etc/systemd`
}

// Rendered as the login user, into the workspace, and only then moved into place with root. Nothing
// is ever piped through `sudo tee`, so a dropped connection cannot leave a half written unit behind.
async function stageRendered(deploy: ServiceDeploy, name: string): Promise<string> {
  const staged = `${stagingDir(deploy.home)}/${name}`
  const template = deploy.jinni.payloadBytes(name).toString('utf-8')
  await deploy.ssh.putContent(staged, renderTemplate(template, deploy.values))

  return staged
}

async function installSudoers(deploy: ServiceDeploy): Promise<void> {
  const staged = await stageRendered(deploy, SUDOERS_SOURCE)
  await deploy.ssh.exec(`chmod 600 ${shellQuote(staged)}`)
  await asRoot(deploy.ssh, deploy.ctx, `visudo -cf ${shellQuote(staged)}`)
  await asRoot(deploy.ssh, deploy.ctx, `install -m 440 -o root -g root ${shellQuote(staged)} ${SUDOERS_TARGET}`)
}

async function installUnits(deploy: ServiceDeploy, index = 0): Promise<void> {
  if (index >= UNITS.length) return
  const staged = await stageRendered(deploy, UNITS[index])
  await asRoot(deploy.ssh, deploy.ctx, `install -m 644 -o root -g root ${shellQuote(staged)} ${UNIT_DIR}/${UNITS[index]}`)

  return installUnits(deploy, index + 1)
}

async function installBootScripts(deploy: ServiceDeploy, index = 0): Promise<void> {
  if (index >= BOOT_SCRIPTS.length) return
  const target = `${bespok3dRoot(deploy.home)}/${BOOT_SCRIPTS[index].target}`
  await deploy.ssh.putBytes(target, deploy.jinni.payloadBytes(BOOT_SCRIPTS[index].source))
  await deploy.ssh.exec(`chmod 755 ${shellQuote(target)}`)

  return installBootScripts(deploy, index + 1)
}

export async function stepInstallServices(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  const home = await remoteHome(ssh)
  const deploy: ServiceDeploy = {
    ssh,
    ctx,
    home,
    jinni: await openSystemPackage(ADAPTER_JINNI_PACKAGE),
    values: { USER: runtimeUser(ctx), BESPOK3D: bespok3dRoot(home), VENV: venvDir(home) },
  }
  await ssh.exec(`mkdir -p ${shellQuote(stagingDir(home))} ${shellQuote(`${bespok3dRoot(home)}/etc/init.d/autostart`)}`)
  await installBootScripts(deploy)
  await installSudoers(deploy)
  await installUnits(deploy)
  await asRoot(ssh, ctx, 'systemctl daemon-reload')
  await asRoot(ssh, ctx, `systemctl enable ${SERVICES}`)
}

// Out of the boot sequence, and back into it. `--now` stops what is running as it goes, so switching
// Bespok3d off does not leave a daemon behind that only a reboot would clear.
export function setServicesEnabled(ssh: SshSession, ctx: EnrollContext, enabled: boolean): Promise<string> {
  if (enabled) return asRoot(ssh, ctx, `systemctl enable ${SERVICES}`)

  return asRoot(ssh, ctx, 'systemctl disable --now bespok3d-plugins bespok3d')
}

export async function removeUnits(ssh: SshSession, ctx: EnrollContext): Promise<void> {
  await asRoot(ssh, ctx, `rm -f ${UNITS.map((unit) => `${UNIT_DIR}/${unit}`).join(' ')}`)
  await asRoot(ssh, ctx, 'systemctl daemon-reload')
}

// Last of everything root does on this printer: after this the account cannot reach systemd again
// without its password, so nothing that needs privilege may follow it.
export function removeSudoers(ssh: SshSession, ctx: EnrollContext): Promise<string> {
  return asRoot(ssh, ctx, `rm -f ${SUDOERS_TARGET}`)
}
