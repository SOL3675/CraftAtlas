# CraftAtlas

Use Node.js 24 and pnpm 11.19.0 with `pnpm-lock.yaml`. `packages/` is a source layout in one npm package, not a pnpm workspace. Java collectors are independent Gradle roots under `mods/`.

- Read `docs/development.md`, `docs/usage.md`, and `docs/contracts.md` before changing the harness integration or data model.
- CraftFoundry owns the harness. This project consumes the versioned `craft-foundry` tarball through explicit package exports; do not edit installed node_modules or copy the harness source into this checkout.
- Run `pnpm check`, `pnpm test`, and `pnpm build`. Integration changes also need `pnpm exec mch doctor --json`, target inspect/build, and the affected Suite. Offline contracts do not prove real game behavior.
- Keep machine paths, Java homes, EULA acceptance, backend installation, caches, and run evidence in ignored local state. Preserve existing user edits and historical validation records.
- Update bundled Skills using `pnpm exec mch skills install --destination .agents/skills --json`; preserve user-edited Skills.
- Keep this Git history independent when later registering it as a CraftFoundry submodule. Do not create guessed remotes, copy this checkout into a second editable tree, or change authentication.
