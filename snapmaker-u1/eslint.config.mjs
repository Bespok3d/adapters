// The adapter's client is TypeScript that plugs into the app, so it lints by the SAME rules as the
// app (no let, no for loops, function declarations, max-depth, etc.). Re-export the app's flat config
// rather than duplicate it; its plugin imports resolve from the app's node_modules. Running eslint
// from the adapter root makes this the discovered config and the adapter root the base path.
export { default } from '../../Bespok3d/src/application/eslint.config.mjs'
