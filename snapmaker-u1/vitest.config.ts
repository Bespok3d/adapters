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
    },
  },
  test: {
    environment: 'node',
    include: ['client/**/*.test.ts'],
  },
}
