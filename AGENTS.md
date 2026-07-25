# AGENTS.md

This repo's contributor rules for AI assistants live in [CLAUDE.md](CLAUDE.md). They are tool-agnostic:
read that file and follow it, whatever assistant you are.

Short version: an adapter teaches Bespok3d to speak to one printer. The daemon orchestrates and owns the
filesystem and protocol; a jinni actuates and owns device knowledge, so keep a device fact in
the jinni, never in the daemon. The TypeScript client reaches the app only through `@adapter-sdk`. Each
adapter self-gates: `cd` into the one you changed and run `bash scripts/check.sh` (init the `lib_bespok3d`
submodule first), fix a real failure rather than mute it, and keep every identifier meaningful, nesting
shallow, and em-dashes out.
