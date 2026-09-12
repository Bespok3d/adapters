// SPDX-FileCopyrightText: Copyright (C) 2026 unlucio and the Bespok3d contributors
// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve } from 'path'

// This repo carries no node_modules of its own: the client's tests run on the app's node toolchain,
// invoked from the adapter gate. So this config imports nothing from vitest (it would not resolve
// from here) and exports the plain object vitest accepts. `@adapter-sdk` is the app's adapter loader,
// the one interface the client is written against, so it resolves into the app repo the same way
// eslint.config.mjs re-exports the app's lint rules.
const APP_REPO = resolve(__dirname, '../../Bespok3d-desktop')

export default {
  resolve: {
    alias: {
      '@adapter-sdk': resolve(APP_REPO, 'src/main/adapter-loader/index.ts'),
      // App files pulled in through the SDK import the shared contract package. The app resolves it in
      // its own vite config, which is not read here, so it is pinned to the same source.
      '@bespok3d/contract': resolve(APP_REPO, '../lib_bespok3d/ts/contract/index.ts'),
      // This repo carries no node_modules, so a client file and an app file resolve bare 'electron'
      // to two different ids and a test's electron mock reaches only one of them. Pinned here, both
      // sides resolve to the same module and one mock covers the whole graph.
      electron: resolve(APP_REPO, 'node_modules/electron'),
    },
  },
  test: {
    environment: 'node',
    include: ['client/**/*.test.ts'],
    // @electron-toolkit/utils reaches for electron's window machinery at import time. Left external it
    // loads natively, outside the module graph, so a test's electron mock never reaches it and the
    // import fails before a single test runs.
    server: { deps: { inline: ['@electron-toolkit/utils'] } },
  },
}
