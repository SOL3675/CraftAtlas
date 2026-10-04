# Usage

Start with [development setup](development.md), including the Foundry bootstrap before frozen install. Commands run from the repository root. Saved data requires Node 24; Java collectors additionally need Java 21.

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

Release includes NeoForge atlas-server/client/offline/world and Fabric atlas-fabric-server/client/offline. Missing client prerequisites cannot be replaced by server-only success. Runs preserve raw captures, snapshots, artifacts, diagnostics, diffs, and logs under `.harness/runs/<run-id>/`.

`atlas-negative` is an intentional failure outside required release suites; run it explicitly and expect failed recipe/tag requirements. The normal server suite's failure-fixture case instead passes when it successfully detects the injected violation.

## World observations

```text
craftatlas observe loot probe atlas:probe 10
craftatlas observe block stone minecraft:stone minecraft:diamond_pickaxe 5
craftatlas observe entity zombie minecraft:zombie 10
craftatlas observe world chunk 0 0 31
craftatlas dump after-observations
```

Block/entity sampling evaluates loot contexts rather than actual destruction/death events and does not give player items. World observation can generate chunks: radius is 0–1, height span at most 64, and loot trials 1–1000. Each observation stores context, trials, manifests, and completion under craftatlas/observations. Reload invalidates attachment to the prior generation. These finite samples do not prove absence, sustainable supply, or survival progression.

## Selected-route materials and costs

```console
pnpm atlas cost --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json --limit 30 --json
pnpm atlas serve --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json
```

Cost requires a scenario and request selecting routes, output indexes, OR inputs, and target units/quantity. Review UI-generated choices; they are not optimal-route guarantees. Fictional progression/equipment fixtures test semantics only. See [contracts](contracts.md) for setup/recurring costs, catalysts/durability/returns, unknown totals, probability assumptions, and result completeness. Use [performance procedures](performance.md) for measurement.
