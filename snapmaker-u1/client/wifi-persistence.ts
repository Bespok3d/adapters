// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
// Keeping the printer's Wi-Fi across reboots and firmware updates. The firmware reads its saved
// networks from /etc, which sits in the overlay a firmware update wipes, so the networks are kept in
// /userdata and /etc points there. The command checks its own result: a version that always
// reported success left printers whose Wi-Fi the next update could lose, with nothing to show it.

export const WIFI_LIVE_CONFIG = '/etc/wpa_supplicant.conf'
export const WIFI_PERSISTENT_CONFIG = '/userdata/cfg/wpa_config.conf'
// Where a saved network can be found, most current first: the config the screen last connected with,
// the one the firmware starts Wi-Fi from at boot, and the screen's own saved copy.
export const WIFI_CREDENTIAL_SOURCES = [
  '/tmp/wpa_supplicant.conf',
  WIFI_LIVE_CONFIG,
  '/oem/printer_data/gui/wpa_supplicant.conf',
]

const NO_SAVED_NETWORK = 'No saved Wi-Fi network was found on the printer, so its Wi-Fi cannot be kept across reboots.'
const NETWORK_NOT_SAVED = 'The printer could not save its Wi-Fi network to its storage, so its Wi-Fi cannot be kept across reboots.'
const LINK_NOT_KEPT = 'The printer did not keep the link to its saved Wi-Fi, so a reboot could lose its Wi-Fi.'

function failWith(message: string): string {
  return `{ echo '${message}' >&2; exit 1; }`
}

// A source that already is the persistent file (a printer enrolled before) holds what is wanted, and
// copying a file onto itself is an error for cp, so the search stops there. A failed copy stops the
// step: going on would keep an older network saved by an earlier enrollment.
function copyFirstSavedNetwork(persistentPath: string, credentialSources: string[]): string {
  return (
    `for source in ${credentialSources.join(' ')}; do` +
    ` grep -q 'network=' "$source" 2>/dev/null || continue;` +
    ` [ "$source" -ef ${persistentPath} ] && break;` +
    ` cp -p "$source" ${persistentPath} 2>/dev/null || ${failWith(NETWORK_NOT_SAVED)};` +
    ` break;` +
    ` done`
  )
}

export function wifiPersistenceCommand(livePath: string, persistentPath: string, credentialSources: string[]): string {
  var persistentDir = persistentPath.slice(0, persistentPath.lastIndexOf('/'))

  return [
    `mkdir -p ${persistentDir}`,
    copyFirstSavedNetwork(persistentPath, credentialSources),
    `grep -q 'network=' ${persistentPath} 2>/dev/null || ${failWith(NO_SAVED_NETWORK)}`,
    `ln -sf ${persistentPath} ${livePath}`,
    `[ "$(readlink ${livePath})" = ${persistentPath} ] || ${failWith(LINK_NOT_KEPT)}`,
  ].join('; ')
}
