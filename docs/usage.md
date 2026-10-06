# Usage

Start with [development setup](development.md), including the Foundry bootstrap before frozen install. Commands run from the repository root. Saved data requires Node 24; Java collectors additionally need Java 21 for 1.21.1 or Java 17 for 1.20.1.

## Saved snapshots and local UI

```console
pnpm atlas validate --snapshot fixtures/before.json --json
pnpm atlas import --snapshot fixtures/before.json --db .harness/atlas.sqlite --json
pnpm atlas inspect minecraft:dirt --db .harness/atlas.sqlite --json
pnpm atlas sources minecraft:diamond --db .harness/atlas.sqlite --limit 10 --offset 0 --json
pnpm atlas uses minecraft:dirt --db .harness/atlas.sqlite --json
pnpm atlas coverage --db .harness/atlas.sqlite --json
pnpm atlas explain minecraft:diamond --snapshot fixtures/before.json --scenario fixtures/scenario.json --depth 3 --json
pnpm atlas audit --snapshot fixtures/before.json --expectations fixtures/expectations.json --json
pnpm atlas diff --before fixtures/before.json --after fixtures/after.json --json
pnpm atlas serve --snapshot fixtures/after.json --before fixtures/before.json --scenario fixtures/scenario.json --expectations fixtures/expectations.json
```

The audit example intentionally finds missing requirements: expectations.json targets the real-game fixture rather than this small snapshot. Audit exit 0 means successful querying, not satisfied expectations; inspect all diagnostics.

Inputs are a snapshot JSON/completed capture directory, normalized `--model`, or SQLite `--db`. Import rebuilds the destination DB. `--snapshot-id` selects an ID inside a DB. Repeat `--definitions` to apply definition packs; they require snapshot metadata to confirm target versions.

UI defaults to http://127.0.0.1:4317; `--port` changes the port, and `--host` only allows loopback. Stop with Ctrl+C. The UI is read-only. Search and expand resources/processes to inspect quantities, OR choices, equipment, costs, provenance, and unknowns. Mod filters affect display; use scenario forbiddenProcesses/allowedTypes and restart to change analysis. Without a scenario there is no reachability analysis; without `--before` there is no comparison.

The graph starts at 100% for readable labels even with many nodes. Use the labeled zoom buttons (5–400%), drag inside the diagram to pan, or Ctrl/Command + wheel to zoom around the pointer. Ordinary wheel scrolling still scrolls the page. Reset restores 100% at the top of the graph; Fit shows all nodes and follows viewport resizing. With the diagram focused, arrow keys pan, +/− zoom, 0/Home reset, and F fits. Nodes still open with a click or Enter/Space; dragging does not select them. Selecting another resource or changing depth/direction starts a fresh view.

`pnpm build` also permits `node dist/packages/cli/src/main.js` instead of the source CLI.

## Fixed collectors

[NeoForge pack lock](../fixtures/pack.lock.json) pins Minecraft 1.21.1 / NeoForge 21.1.252, JEI 19.22.1.316, CraftTweaker 21.0.38, and Mekanism 10.7.14.79 (runtime Mod version 10.7.14). Java 21 and Gradle Wrapper 9.2.1 are required. Use the [Fabric guide](fabric.md) for its independent target.

```console
node scripts/fetch-pack.ts
```

Downloads go to `.harness/pack/` and must match SHA-256 before use. Gradle verifies runtime dependency hashes and exports explicit distribution/dependency sides.

In the server console (or with a leading slash in game), operator level 2 can run:

```text
craftatlas status
craftatlas dump baseline
reload
craftatlas dump changed
```

Wait for loading/reload completion and both `CRAFTATLAS COMPLETE` and `craftatlas/<label>/completion.json`. Use a new label; existing captures are not overwritten. With ready JEI in an integrated world, `/craftatlas-client dump integrated` adds viewer data. Dedicated-server remote viewer capture is unsupported. Stale session/generation viewer data is rejected; use server-only capture or a fresh integrated session when viewer readiness does not match.

Server dumps on all four configured targets also write `datapack.json`, independently of JEI/EMI. It preserves active Mod-embedded and world datapack recipe JSON, original text/hashes, the effective resource and visible override stack. Inspect it with:

```console
pnpm atlas datapack --snapshot craftatlas/baseline --limit 30 --json
pnpm atlas datapack example:recipe/press.json --snapshot craftatlas/baseline --json
pnpm atlas inspect example:press --snapshot craftatlas/baseline --json
```

For a Mod with a separate server JSON directory, add `-Dcraftatlas.resourceDirectories=machines,example/acquisition` to the game JVM arguments before startup. Directories are paths **below** `data/<namespace>/`; the standard recipe directory is always included: `recipes` for 1.20.1 and `recipe` for 1.21.1. This opt-in capture does not interpret custom recipe APIs. Only `.json` resources in these directories are dumped. Selected/loaded pack IDs and disabled pack IDs are recorded, but disabled-pack contents and client assets are excluded.

Use the effective JSON and runtime entry to author a version-scoped `--definitions` pack following [definition contracts](contracts.md). An unknown serializer stays opaque. A recipe resource absent from RecipeManager remains unconfirmed, even with vanilla-looking fields; inspect conditions, the custom loader/API and machine behavior before declaring reviewed inputs, outputs or `execution: "executable"`. A custom-directory resource has no assumed recipe ID convention: use an explicit definition addition after reviewing its behavior. Source JSON and raw capture coverage survive overlays. Older dumps have no raw dataset; `atlas datapack` reports `captured: false`.

## Harness setup and game validation

For contributor setup, fixture deployment, and release checks, see [development](development.md#harness-setup-and-game-validation).

## Forge and Fabric 1.20.1

Forge 47.3.0 and Fabric Loader 0.16.14 / API 0.92.7+1.20.1 use Java 17 for the game. Optional viewers are JEI 15.20.0.106 and EMI 1.1.24+1.20.1+fabric. TechReborn and Mekanism adapters remain scoped to the pinned 1.21.1 packs. Use the [capture commands](#fixed-collectors) after installing the matching collector; [development setup](development.md#forge-and-fabric-1201-validation) covers building and testing these distributions.

Minecraft 1.20.1 serializers expose `fromJson`, `toNetwork` and `fromNetwork`, with no universal runtime JSON codec. Captures retain network base64/SHA-256 under each recipe's `serialization`; reviewed exact vanilla implementations additionally expose crafting, cooking, stonecutting and smithing-transform fields. Other implementations stay opaque with unsupported `recipeSerialization` coverage. Source JSON remains independent and cannot repair missing runtime semantics. NBT is retained with unknown matching/mutation behavior; JEI/EMI fluid units remain mB/droplets respectively; Forge 1.20.1 JEI fluid capture remains unverified at runtime. Forge global modifiers use a fixed 47.3.0 internal map boundary to retain applied IDs/order; arbitrary hooks remain unknown. Finite observation commands are implemented on both 1.20.1 loaders; dedicated and integrated game validation has completed for the reviewed implementation. The `observation/commands` coverage row describes registration of the four bounded commands; `observation/finite samples` remains partial, including when no sample has been requested.

## World observations

The following observation commands are implemented on the configured 1.21.1 collectors and Forge/Fabric 1.20.1.

```text
craftatlas observe loot dungeon minecraft:chests/simple_dungeon 10
craftatlas observe block stone minecraft:stone minecraft:diamond_pickaxe 5
craftatlas observe entity zombie minecraft:zombie 10
craftatlas observe world chunk 0 0 31
craftatlas dump after-observations
```

Block/entity sampling evaluates loot contexts rather than actual destruction/death events and does not give player items. World observation can generate chunks: radius is 0–1, height span at most 64, and loot trials 1–1000. Each observation stores context, trials, manifests, and completion under craftatlas/observations. The command source supplies the position, dimension and optional player; console observations have no player. Tool arguments retain 1.20.1 NBT, for example `minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]}`. Missing table parameters and nonliving entity types fail explicitly. The collector refuses busy/reloading/stopped sessions, invalid labels and overwrites; failed observations do not attach to snapshots. Reload invalidates attachment to the prior generation. These finite samples do not prove absence, sustainable supply, or survival progression.

## Selected-route materials and costs

```console
pnpm atlas cost --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json --limit 30 --json
pnpm atlas serve --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json
```

Cost requires a scenario and request selecting routes, output indexes, OR inputs, and target units/quantity. Review UI-generated choices; they are not optimal-route guarantees. Fictional progression/equipment fixtures test semantics only. See [contracts](contracts.md) for setup/recurring costs, catalysts/durability/returns, unknown totals, probability assumptions, and result completeness. Use [performance procedures](performance.md) for measurement.

### Validate the 1.20.1 observation port

Contributor checks are in [development](development.md#validate-the-1201-observation-port).
