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

`pnpm fixture` regenerates small offline fixtures; it is a development operation, not a game capture. `pnpm build` also permits `node dist/packages/cli/src/main.js` instead of the source CLI.

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

Shared targets and tool pins are in [harness.config.json](../harness.config.json) and [harness.lock.json](../harness.lock.json). Create ignored `harness.local.json` with actual absolute homes:

```json
{
  "schemaVersion": 1,
  "java": { "java21": "C:/absolute/path/to/jdk-21" },
  "timeouts": { "build": 900000, "start": 240000, "test": 600000, "stop": 20000 },
  "eulaAccepted": false
}
```

Set consent true only when the user has already accepted Minecraft's EULA. Java home is the installation root containing bin/java. Local `tools` may map lock keys to verified existing files; otherwise locked downloads are used.

```console
pnpm exec mch tools install mc-pilot --project . --json
```

Set local `backends.mc-pilot` to the returned backendRoot. The backend installer uses npm ci internally; keep npm on PATH or select `--npm-command`. It does not edit local configuration. See the installed package's docs/configuration.md and docs/tools.md for the full contract. Optional assetCaches can seed verified objects, not native binaries or personal worlds.

```console
pnpm exec mch targets --json
pnpm exec mch doctor --json
pnpm exec mch inspect --target neoforge-1.21.1 --json
pnpm exec mch build --target neoforge-1.21.1 --json
pnpm exec mch test --target neoforge-1.21.1 --suite atlas-offline --json
pnpm exec mch test --target neoforge-1.21.1 --suite atlas-server --json
pnpm exec mch test --target neoforge-1.21.1 --suite atlas-client --json
pnpm exec mch test --all --profile release --json
```

Release includes NeoForge 1.21.1 atlas-server/client/offline/world, Fabric 1.21.1 atlas-fabric-server/client/offline, and both 1.20.1 targets with atlas-1.20.1-server, their JEI/EMI client suite, and atlas-offline. Missing client prerequisites cannot be replaced by server-only success. Runs preserve raw captures, snapshots, artifacts, diagnostics, diffs, and logs under `.harness/runs/<run-id>/`.

`atlas-negative` is an intentional failure outside required release suites; run it explicitly and expect failed recipe/tag requirements. The normal server suite's failure-fixture case instead passes when it successfully detects the injected violation.

## Forge and Fabric 1.20.1

The independent builds are `mods/collector-forge-1.20.1` (ForgeGradle 6.0.36 / Gradle 8.8) and `mods/collector-fabric-1.20.1` (Loom 1.8.13 / Gradle 8.10). Both use official Mojang mappings and Java 17 for compilation and the game. Fabric/Loom runs Gradle on Java 21; Forge runs Gradle on Java 17, matching Foundry's target roles. The loader/API pins match Foundry's existing 1.20.1 fixtures; the [tool lock](../harness.lock.json) reuses its server installers and mc-pilot helper hashes. These targets consume the reachable immutable Foundry 0.1.5 package recorded in `craft-foundry.source.json`. Foundry's separate repository-only survival runner still supports its documented 1.21.1 targets; this change does not extend that runner.

Add an absolute `java.java17` installation root to ignored `harness.local.json`, alongside `java21` for regression validation. Provide Node 24.19.0, npm 11.9.0, pnpm 11.19.0, Git access to the source pin, network/cache access to the configured Gradle distributions, Forge/Fabric/JEI/EMI Maven repositories and official Minecraft downloads. Clients require the verified mc-pilot 0.15.0 installation and display prerequisites. EULA state must come from the user's existing acceptance. Do not bypass blocked repositories or promote offline checks to a game pass.

After the approved local checkout/transfer on SOL-SUBMARINE, run from Atlas:

```console
node scripts/prepare-foundry.mjs --source ../CraftFoundry
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm exec mch doctor --json
pnpm exec mch inspect --target forge-1.20.1 --json
pnpm exec mch build --target forge-1.20.1 --json
pnpm exec mch test --target forge-1.20.1 --suite atlas-offline --json
pnpm exec mch test --target forge-1.20.1 --suite atlas-1.20.1-server --json
pnpm exec mch test --target forge-1.20.1 --suite atlas-1.20.1-jei --json
pnpm exec mch inspect --target fabric-1.20.1 --json
pnpm exec mch build --target fabric-1.20.1 --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-offline --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-server --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-emi --json
```

There is no separate pack-fetch script for 1.20.1: Gradle resolves the exact API/viewer coordinates and exports actual dependency JAR hashes through `harnessExport`. JEI/EMI artifacts are client-only; Fabric API is deployed on both sides. These distribution hashes are run evidence, not proof of immutable Maven contents across future downloads. The harness also deploys a separate fictional data-only fixture Mod from `fixtures/embedded-1.20.1`, built with loader-specific metadata; it is not part of the collector distribution JAR. The server suite checks its embedded JSON, world overrides, source-only conditions, runtime-only entries, repeat identity, interrupted publication, reload and failed expectations. `craftatlas.testRuntimeFixture=true` is an isolated test JVM opt-in; normal collectors do not add runtime recipes.

Minecraft 1.20.1 serializers expose `fromJson`, `toNetwork` and `fromNetwork`, with no universal runtime JSON codec. Captures retain network base64/SHA-256 under each recipe's `serialization`; reviewed exact vanilla implementations additionally expose crafting, cooking, stonecutting and smithing-transform fields. Other implementations stay opaque with unsupported `recipeSerialization` coverage. Source JSON remains independent and cannot repair missing runtime semantics. NBT is retained with unknown matching/mutation behavior; JEI/EMI fluid units remain mB/droplets respectively. Forge global modifiers use a fixed 47.3.0 internal map boundary to retain applied IDs/order; arbitrary hooks remain unknown. Finite observation commands are implemented on both 1.20.1 loaders; their new real-game validation is required before treating this port as verified. The `observation/commands` coverage row describes registration of the four bounded commands; `observation/finite samples` remains partial, including when no sample has been requested.

For the existing 1.21.1 regression builds, first run `node scripts/fetch-pack.ts` and `node scripts/fetch-fabric-pack.ts`, then inspect/build both existing targets and execute their required suites. Finally run `pnpm exec mch test --all --profile release --json` after all prerequisites are present. Review current Run reports, actual distribution/dependency hashes, expected IDs and raw capture artifacts. Successful TypeScript tests or pure Java parser probes establish neither Minecraft compilation nor runtime behavior.

## World observations

The following observation commands are implemented on the configured 1.21.1 collectors and Forge/Fabric 1.20.1. The 1.20.1 port still requires compilation and the dedicated/integrated game checks below; its offline tests are not game evidence.

```text
craftatlas observe loot probe atlas:probe 10
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

Use the locked Java 17 game/toolchain and existing local EULA/backend configuration; Fabric's Gradle role is Java 21. Inspect and rebuild both distribution artifacts, then execute the required seven-case observation suite for **each** loader:

```console
pnpm exec mch doctor --json
pnpm exec mch inspect --target forge-1.20.1 --json
pnpm exec mch build --target forge-1.20.1 --json
pnpm exec mch test --target forge-1.20.1 --suite atlas-1.20.1-world --json
pnpm exec mch inspect --target fabric-1.20.1 --json
pnpm exec mch build --target fabric-1.20.1 --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-world --json
pnpm exec mch test --all --profile release --json
```

The observation suite uses real normal-generator game worlds and recorded distribution JARs. It requires deterministic and empty table sampling, Forge post-table modifier output, stone/tool and Silk Touch NBT results, unspawned zombie contexts, one/nine chunks with 32/64-block heights, checksummed publication and dump attachment, invalid requests/overwrite refusal, busy refusal, reload invalidation and fresh-generation sampling, and clean shutdown. It preserves observation JSON/manifests/completion, snapshots, SQLite, logs and artifact hashes in the Run. It does not assert random zombie drop quantities or replace missing behavior with simulated results. Both 1.20.1 release target requirements now include this suite; the full matrix has 15 required suites. Inspect all seven case IDs and statuses in each observation suite and the existing server/viewer/offline suites. The existing 1.21.1 Suite requirements are unchanged.

Also check operator permission inheritance and a player-issued block/entity observation in an integrated Forge/JEI and Fabric/EMI world: player UUID/game mode/luck, actual position/dimension, held-tool NBT and player damage context must survive; no entities or items should be granted by sampling. Dedicated-console cases have `player: null` and generic damage, so they do not verify these player-specific fields. New game results must be collected for this commit; results from an earlier PR revision do not validate the port.

The 1.20.1 client suites exercise player-issued normal/Silk Touch block, entity and world samples before a fresh viewer dump. They enable commands only in the newly copied disposable world, record the changed `level.dat` hash, set up a held tool and known luck/position on a stone platform, and compare actual inventory, the platform block and nearby entity identities before/after sampling. The UUID is checked against player-issued vanilla `data get` feedback. Run each client suite again with `CRAFTATLAS_OBSERVATION_PERMISSION=denied` to disable commands in its separate fresh world and require denial of all four command types, unchanged inventory, no new requested zombie or dropped-item entities, and no attached observations. Natural animals can enter or leave the query radius in the denied world; their full before/after records are retained. This environment variable changes local test behavior only; it does not edit shared configuration or personal worlds.
