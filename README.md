# CraftAtlas

[日本語](README.ja.md)

CraftAtlas saves Minecraft Java recipes, tags, and world data so you can inspect acquisition paths, requirements, material costs, and changes after closing the game. Use its CLI or read-only local Web UI. Missing or uninterpreted data stays unknown.

## Quick start

Use Git, Node.js 24.19.0, npm 11.9.0, and pnpm 11.19.0. Run from the repository root to install and open the bundled sample data; Minecraft and Java are unnecessary for this example.

```console
node scripts/prepare-foundry.mjs
pnpm install --frozen-lockfile --ignore-scripts
pnpm atlas serve --snapshot fixtures/after.json --scenario fixtures/scenario.json --before fixtures/before.json
```

Open [the local UI](http://127.0.0.1:4317), search for `diamond`, and inspect quantities, AND / OR choices, equipment, evidence, and unknown conditions. Stop with Ctrl+C. Mod filters change the display; analysis restrictions come from the scenario. `--before` selects the old snapshot and `--snapshot` the new one for comparison.

The first command obtains the pinned CraftFoundry dependency. If you already have its checkout, add `--source ../CraftFoundry`. See [setup and development](docs/development.md) for restoration, build, and testing instructions.

## CLI and game captures

```console
pnpm atlas validate --snapshot fixtures/before.json --json
pnpm atlas import --snapshot fixtures/before.json --db .harness/demo.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/demo.sqlite --json
pnpm atlas explain minecraft:diamond --snapshot fixtures/before.json --scenario fixtures/scenario.json --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
```

See [usage](docs/usage.md) for commands and collecting your own game data. With the matching collector installed, use `/craftatlas dump <label>` as an operator and wait for capture completion. A completed capture directory can replace a sample JSON path in `--snapshot`. Optional JEI/EMI capture requires an integrated world; remote dedicated-server viewer capture is unsupported.

Server dumps also save active Mod-embedded datapack recipe JSON and override provenance without JEI/EMI. Inspect it with `atlas datapack`; [collection options](docs/usage.md#fixed-collectors) cover custom JSON directories. Raw JSON capture does not prove recipe registration or executability.

Mod-specific acquisition methods can declare inputs, outputs, and conditions in a version-scoped DefinitionPack. See [data contracts](docs/contracts.md) for definition authoring, tag expansion, references, and interpretation limits. Unverified Java hooks remain unknown.

## Supported targets and limits

| Target | Loader / API | Java | Optional viewer |
| --- | --- | --- | --- |
| NeoForge 1.21.1 | 21.1.252 | 21 | JEI 19.22.1.316 |
| Fabric 1.21.1 | 0.16.14 / API 0.116.17+1.21.1 | 21 | EMI 1.1.24+1.21.1+fabric |
| Forge 1.20.1 | 47.3.0 | 17 | JEI 15.20.0.106 |
| Fabric 1.20.1 | 0.16.14 / API 0.92.7+1.20.1 | 17 | EMI 1.1.24+1.20.1+fabric |

Other versions and loader combinations are unsupported. See [1.20.1 usage](docs/usage.md#forge-and-fabric-1201) and the [Fabric guide](docs/fabric.md) for target-specific details.

| Area | Current scope |
| --- | --- |
| Server capture | Dedicated and integrated servers on the four targets; items, fluids, blocks, entities, tags, applied recipes, and environment hashes |
| Basic recipes | Crafting, smelting, and other supported vanilla types; special/dynamic recipes and custom predicates retain raw data and unknown reasons |
| Machine adapters | Mekanism enriching and TechReborn grinder on the pinned 1.21.1 packs; other machine types remain opaque, and supplied power and elapsed time are not established |
| Reachability | Qualitative analysis using scenario inventory, installed equipment, stages, dimensions, and forbidden processes; no proof of a finite-inventory executable schedule |
| Loot / worldgen | Runtime tables, references, basic conditions/functions, applied NeoForge/Forge global loot modifiers, and biome/spawn/feature relationships; arbitrary events, custom code, and generation rates remain unknown |
| Observations | Bounded loot/block/entity/world samples on the listed targets; recorded context and results do not prove absence, rates, or sustainable supply |
| Progression and costs | Declared requirements and selected-route quantities, batches, setup/recurring costs, catalysts, durability, and returns; expectations and trial variance require an explicit IID probability model |

Viewer display is not proof of execution. Forge 1.20.1 JEI fluid capture remains unverified at runtime. Review [data contracts and constraints](docs/contracts.md) when interpreting results, and [performance measurement](docs/performance.md) for measurement procedures and budgets.

## License

Original CraftAtlas code and documentation are licensed under [MIT](LICENSE), copyright (c) 2026 SOL3675. Separate third-party licenses and copyright notices remain applicable: Gradle Wrapper scripts retain Apache-2.0 headers, and their JARs retain `META-INF/LICENSE`. Dependencies, downloaded Mods, and Minecraft retain their own licenses. Builds copy LICENSE into `dist/`; collector binary and source JARs include it as `META-INF/LICENSE`. The npm package is `private: true` and unpublished.
