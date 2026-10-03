# CraftAtlas

[日本語](README.ja.md)

CraftAtlas captures Minecraft Java recipes, tags, and world data for offline inspection, dependency analysis, comparisons, and a local Web UI. Java collector Mods supply runtime data; TypeScript handles normalization, SQLite queries, CLI, and display. Missing or uninterpreted data stays unknown.

## Quick start

Use Git, Node.js 24.19.0, npm 11.9.0, and pnpm 11.19.0. From this repository, with CraftFoundry in a sibling checkout:

```console
node scripts/prepare-foundry.mjs --source ../CraftFoundry
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm atlas serve --snapshot fixtures/after.json --scenario fixtures/scenario.json --before fixtures/before.json
```

Open http://127.0.0.1:4317 and search for `diamond`. Stop with Ctrl+C. Saved fixtures need neither Minecraft nor Java. Omit `--source` to obtain the exact recorded CraftFoundry commit from GitHub. The bootstrap creates an ignored tarball before pnpm runs; plain install cannot restore a missing local package by itself.

See [development](docs/development.md) for clean restoration, updating the unpublished dependency, Windows, CI, and future submodule placement. Both repositories remain independent; no npm registry publication is needed.

## Use and limits

```console
pnpm atlas validate --snapshot fixtures/before.json --json
pnpm atlas import --snapshot fixtures/before.json --db .harness/demo.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/demo.sqlite --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
```

Collectors target Minecraft 1.21.1 / Java 21, NeoForge 21.1.252 and Fabric Loader 0.16.14. See [usage](docs/usage.md), [data contracts and constraints](docs/contracts.md), [Fabric](docs/fabric.md), and [performance measurement](docs/performance.md).

Supported interpretations are deliberately bounded: basic recipes, Mekanism enriching, TechReborn grinder, declared equipment/progression, selected-route costs, and portions of Loot/worldgen. Viewer display is not proof of execution. Finite observations do not prove absence or sustainable supply. Fictional equipment/progression fixtures are contract tests, not verified real-Mod behavior.

`packages/` is one TypeScript package, not a workspace. Java collectors are separate Gradle roots under `mods/`. The harness is consumed only through the packed `craft-foundry` exports. Machine configuration, game files, caches, databases, and generated packages remain ignored.

The project is private and has no project-wide license grant. Public repository visibility alone would not change that; preserve third-party notices and decide licensing separately before release.
