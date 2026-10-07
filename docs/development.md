# Development

Use Git, Node.js 24.19.0, npm 11.9.0 (Foundry package generation), and pnpm 11.19.0. `packages/` contains one TypeScript project; the collector directories are independent Gradle roots. Use `pnpm-lock.yaml` here and `package-lock.json` in CraftFoundry. Bootstrap caches remain in ignored project state. In restricted cloud environments, configure package-manager home/cache environment variables to writable locations in the environment, rather than committing machine-specific paths.

## Restore the unpublished harness

Run from Atlas in PowerShell, cmd, or a POSIX shell:

```console
node scripts/prepare-foundry.mjs --source ../CraftFoundry
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm build
pnpm exec mch --help
pnpm exec mch targets --json
pnpm exec mch skills install --destination .agents/skills --json
```

The checked-in `craft-foundry.source.json` records the verified repository URL, a full immutable commit, package version, and build-tool versions. The script selects an npm JS entry point matching the pin, including an upgraded global prefix when PATH still exposes an older bundled npm, then fetches that commit into a fresh isolated Git checkout, runs Foundry's `npm ci --ignore-scripts` and build, then packages it to `.harness/vendor/craft-foundry.tgz`. Atlas's manifest references that stable local path; its lockfile verifies the exact packed bytes. Tarballs, node_modules, and build output are never committed.

`--source` must name the checkout's Git root, with Windows short-name and casing aliases accepted; a subdirectory is rejected. It uses Git objects from that checkout, not its dirty files or current branch. The required commit must exist there. The script never changes that checkout, initializes its submodules, or installs Atlas while building Foundry. Existing package bytes are replaced only after a successful build; concurrent bootstraps are rejected. A stale bootstrap lock requires confirming its owner has stopped before removing it.

For a fresh machine without the Foundry checkout:

```console
node scripts/prepare-foundry.mjs
pnpm install --frozen-lockfile --ignore-scripts
```

The recorded Foundry origin is public and can be fetched anonymously; no custom token or Actions secret is required. For an independently configured private source pin, Git read access must already be configured, or use an existing `--source` checkout. The pinned commit must be reachable there; local commits work only with `--source` until pushed. Registry access is still needed for locked third-party dependencies, but the `craft-foundry` package is not fetched from npm. Git checkout uses LF, package generation uses umask `022`, and npm packaging uses fixed tool versions to stabilize tarball integrity across OSes and cloud permission defaults. The caller's shell umask is unchanged. Do not repair an integrity failure by bypassing lock checks; inspect the source pin and tool versions.

Future placement at `CraftFoundry/projects/craft-atlas` uses `--source ../..`. Explicit paths also support differently named Windows checkouts. There is no automatic parent detection, root npm workspace, recursive clone, install lifecycle hook, or parent-child install cycle. Submodules are not required or created by this workflow.

## Update the dependency deliberately

1. Commit and validate Foundry changes on its development branch. For package/API changes, update its version and npm lock consistently; source-only development pins can distinguish commits even at the same package version.
2. Set the full commit and matching package version in `craft-foundry.source.json`. Do not use `dev`, `main`, `HEAD`, or a movable tag as the pin. Make that commit available at the recorded origin before expecting remote-only restoration. If an initial squash merge changes commit identity, pin the reachable merged commit afterward; squash does not erase dev/PR history.
3. Run `node scripts/prepare-foundry.mjs --source <checkout>` and `pnpm update craft-foundry --lockfile-only --ignore-scripts` to refresh the file dependency's integrity. Then run a clean `pnpm install --frozen-lockfile --ignore-scripts`, check, test, and build. Review the lockfile diff; do not bypass integrity checks.
4. Restore/update Skills with the installer above, which preserves user edits, and review `.agents/skills/.mch-skills.json`. Re-run the affected harness suites using the [validation procedures below](#harness-setup-and-game-validation). Commit the source pin, dependency/lock changes, and Skills provenance together, with the reason for the update. Do not commit archives or generated Skills.

The six imports are `core/config`, `core/cache`, `core/tools`, `core/types`, `adapters/runtime/server`, and `adapters/runtime/mc-pilot`, under `craft-foundry/`. Source and compiled adapters resolve these same exports; do not edit installed node_modules or copy harness source.

## Mod acquisition definitions

When adding a serializer, machine, trade or code-controlled item source, first inspect the target capture and `packages/core/src/normalize.ts`. Add or update a version-scoped DefinitionPack only for reviewed semantics; do not represent a material-consuming process as a starting inventory seed. Existing append/replace/disable/addition behavior and conflicts remain explicit. Use [definition contracts](contracts.md) for interpretation patches, references, tag expansion and coverage.

Run `pnpm check`, `pnpm test`, and `pnpm build` after authoring changes. `tests/definition-authoring.test.ts` exercises both 1.21.1 loaders, while `tests/targets-1.20.1.test.ts` exercises Forge/Fabric 1.20.1, conditional custom serializer mapping, missing inputs, missing references, conflicts and incomplete captures. Add/update an equivalent positive route and missing-prerequisite regression for each new mechanism. Keep dynamic hooks unknown when their actual conditions cannot be verified.

`tests/datapack.test.ts` covers raw-resource overlays, unknown serializers, malformed data, manifests/SQLite/CLI and definition interaction. To exercise the shared Java capture/parser against an embedded archive plus overrides without Minecraft, run `node scripts/check-collector-datapack.ts --gson <existing-gson.jar>` with Java/JDK 21 on PATH. A JRE can instead use `--ecj <existing-ecj.jar>` (ECJ 3.38.0 tested). The script downloads nothing and simulates the ResourceManager boundary; it does not prove a loader's integration. Run it additionally with `--minecraft 1.20.1 --loader forge` and `--minecraft 1.20.1 --loader fabric` to compile the shared parser/publication code for Java 17 and exercise plural recipe directories, malformed/unreadable resources and override stacks. `--ecj` can run these compilation probes on a Java 21 JRE; this does not compile Minecraft or loader APIs. Target inspect/build and actual game captures remain necessary for that boundary. `scripts/check-collector-canonical.ts <target> --gson <existing-gson.jar> --ecj <existing-ecj.jar>` also selects the target's Java release for cross-language canonical JSON/hash checks; without explicit Gson it reads that target's actual exported manifest.

For the Foundry development workflow, use its [survival suite](https://github.com/SOL3675/CraftFoundry/blob/dev/docs/survival.md). For an Atlas revision that is not selected by a reviewed Foundry gitlink, run from the Foundry checkout:

```console
npm run test:atlas:definitions -- --atlas-source ../CraftAtlas
node scripts/atlas-survival.mjs --config tests/atlas-definitions/fixtures/suite.json --results .harness/custom/results.json --atlas-source ../CraftAtlas
```

The explicit source must be a clean local Git checkout; results record its full commit and that it is a development source. Foundry's default runner continues to require the exact clean submodule pin. Publish the reviewed Atlas change first, then update Foundry's gitlink and enable its definition integration tests in CI. Do not commit an unreachable remote pin or alter Atlas's independently pinned Foundry package to perform this source integration.

## Validation and CI

[Contract CI](../.github/workflows/contracts.yml) installs pinned npm/pnpm in an ignored local prefix and calls their explicit JS entry points on both operating systems. `CRAFTFOUNDRY_NPM_CLI` identifies the installed npm entry point for bootstrap and remains stable when pnpm overrides npm_execpath; the selected version is still verified. Bootstrap regression tests run before repository access, so a source acquisition failure cannot hide those results. The full consumer checks still require the real pinned Foundry package and do not pass when acquisition fails.

Contract CI runs `node scripts/prepare-foundry.mjs` directly against the public Foundry origin. It fetches the immutable source pin without a second checkout, custom Actions secrets or token injection, including on fork PRs. The initial Atlas checkout retains ordinary `actions/checkout` authentication and `contents: read` permissions. Source acquisition failures fail the job rather than skipping consumer checks.

The local `--source` option remains available for offline Git objects or independently configured private origins; it is not a CI prerequisite. Local cloud Git credentials are not needed for these public repositories and must not be copied into tracked files or Actions secrets.

For integration, use the four-target matrix in the README and the [1.20.1 prerequisites and commands below](#forge-and-fabric-1201-validation). Keep `mods/collector-1.20.1-common` isolated from the 1.21.1 Minecraft API sources; only `JsonFiles` and `DatapackCollector` are shared across versions. Read the target-specific serializer/network, pack API and viewer boundaries before expanding extraction. For integration, run doctor, inspect/build for each affected target, and its atlas-offline suite, followed by actual game suites when prerequisites are available. Doctor failures for absent Java/backend/display/EULA are environment blockers, not passes. Offline unit tests and successful TypeScript builds do not prove real Minecraft behavior.

Keep English procedural docs and a linked Japanese README. Retain necessary usage, constraints, licenses, and agent instructions; record changes/rationale in commits instead of separate design restatements, migration records, or phase histories. Pushes, PRs, merges, visibility changes, and publication are separate authorized operations.

## Offline fixtures

`pnpm fixture` regenerates the small offline snapshots; it does not capture a game. [Equipment definitions](../definitions/fixture-equipment.json) and [progression definitions](../definitions/fixture-progression.json) describe fictional equipment, summoning, ritual, and dimension-unlock processes for contract testing. They do not establish real-Mod construction or execution. Exercise the cost and UI contracts with:

```console
pnpm atlas cost --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json --json
pnpm atlas serve --snapshot fixtures/definition-progression-snapshot.json --definitions definitions/fixture-progression.json --scenario fixtures/definition-progression-scenario.json --request fixtures/definition-progression-cost-request.json
```

`pnpm build` copies schemas, Web UI assets, and LICENSE into `dist/`. Check the compiled CLI with `node dist/packages/cli/src/main.js validate --snapshot fixtures/before.json --json`.

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

Release includes NeoForge 1.21.1 atlas-server/client/offline/world, Fabric 1.21.1 atlas-fabric-server/client/offline, and both 1.20.1 targets with atlas-1.20.1-server, their JEI/EMI client suite, atlas-offline, and atlas-1.20.1-world. Missing client prerequisites cannot be replaced by server-only success. Runs preserve raw captures, snapshots, artifacts, diagnostics, diffs, and logs under `.harness/runs/<run-id>/`.

`atlas-negative` is an intentional failure outside required release suites; run it explicitly and expect failed recipe/tag requirements. The normal server suite's failure-fixture case instead passes when it successfully detects the injected violation.

### Fabric 1.21.1 validation

```console
node scripts/fetch-fabric-pack.ts
pnpm exec mch doctor --json
pnpm exec mch inspect --target fabric-1.21.1 --json
pnpm exec mch build --target fabric-1.21.1 --json
pnpm exec mch test --target fabric-1.21.1 --suite atlas-offline --json
pnpm exec mch test --target fabric-1.21.1 --suite atlas-fabric-server --json
pnpm exec mch test --target fabric-1.21.1 --suite atlas-fabric-client --json
```

The server suite checks capture consistency, reload refusal, missing-recipe diagnostics, and shutdown. The client suite checks integrated-world EMI data, exact session/generation, stale token rejection, reproducibility, and shutdown. Remote dedicated-server viewer capture and viewer capture without EMI are unsupported.

## Forge and Fabric 1.20.1 validation

The independent builds are `mods/collector-forge-1.20.1` (ForgeGradle 6.0.36 / Gradle 8.8) and `mods/collector-fabric-1.20.1` (Loom 1.8.13 / Gradle 8.10). Both use official Mojang mappings and Java 17 for compilation and the game. Fabric/Loom runs Gradle on Java 21; Forge runs Gradle on Java 17, matching Foundry's target roles. The loader/API pins match Foundry's existing 1.20.1 fixtures; the [tool lock](../harness.lock.json) reuses its server installers and mc-pilot helper hashes. These targets consume the immutable Foundry 0.1.5 package recorded in `craft-foundry.source.json`. Foundry's separate repository-only survival runner supports its documented 1.21.1 targets; use Atlas's suites below for 1.20.1 validation.

Add an absolute `java.java17` installation root to ignored `harness.local.json`, alongside `java21` for regression validation. Provide Node 24.19.0, npm 11.9.0, pnpm 11.19.0, Git access to the source pin, network/cache access to the configured Gradle distributions, Forge/Fabric/JEI/EMI Maven repositories and official Minecraft downloads. Clients require the verified mc-pilot 0.15.0 installation and display prerequisites. EULA state must come from the user's existing acceptance. Do not bypass blocked repositories or promote offline checks to a game pass.

Run from the Atlas repository root:

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
pnpm exec mch test --target forge-1.20.1 --suite atlas-1.20.1-world --json
pnpm exec mch inspect --target fabric-1.20.1 --json
pnpm exec mch build --target fabric-1.20.1 --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-offline --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-server --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-emi --json
pnpm exec mch test --target fabric-1.20.1 --suite atlas-1.20.1-world --json
```

There is no separate pack-fetch script for 1.20.1: Gradle resolves the exact API/viewer coordinates and exports actual dependency JAR hashes through `harnessExport`. JEI/EMI artifacts are client-only; Fabric API is deployed on both sides. These distribution hashes are run evidence, not proof of immutable Maven contents across future downloads. The harness also deploys a separate fictional data-only fixture Mod from `fixtures/embedded-1.20.1`, built with loader-specific metadata; it is not part of the collector distribution JAR. The server suite checks its embedded JSON, world overrides, source-only conditions, runtime-only entries, repeat identity, interrupted publication, reload and failed expectations. `craftatlas.testRuntimeFixture=true` is an isolated test JVM opt-in; normal collectors do not add runtime recipes.

For the existing 1.21.1 regression builds, first run `node scripts/fetch-pack.ts` and `node scripts/fetch-fabric-pack.ts`, then inspect/build both existing targets and execute their required suites. Finally run `pnpm exec mch test --all --profile release --json` after all prerequisites are present. Review current Run reports, actual distribution/dependency hashes, expected IDs and raw capture artifacts. Successful TypeScript tests or pure Java parser probes establish neither Minecraft compilation nor runtime behavior.

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

Also check operator permission inheritance and a player-issued block/entity observation in an integrated Forge/JEI and Fabric/EMI world: player UUID/game mode/luck, actual position/dimension, held-tool NBT and player damage context must survive; no entities or items should be granted by sampling. Dedicated-console cases have `player: null` and generic damage, so they do not verify these player-specific fields. For future collector or harness changes, collect fresh results for the affected implementation; documentation-only changes do not require another live-game run.

The 1.20.1 client suites exercise player-issued normal/Silk Touch block, entity and world samples before a fresh viewer dump. They enable commands only in the newly copied disposable world, record the changed `level.dat` hash, set up a held tool and known luck/position on a stone platform, and compare actual inventory, the platform block and nearby entity identities before/after sampling. The UUID is checked against player-issued vanilla `data get` feedback. Run each client suite again with `CRAFTATLAS_OBSERVATION_PERMISSION=denied` to disable commands in its separate fresh world and require denial of all four command types, unchanged inventory, no new requested zombie or dropped-item entities, and no attached observations. Natural animals can enter or leave the query radius in the denied world; their full before/after records are retained. This environment variable changes local test behavior only; it does not edit shared configuration or personal worlds.

## Browser UI locales

Add a message catalog in `packages/web/public/locales/<lowercase-language-tag>.js` and register its ID, native language name and import in `locale-catalogs.js`. Copy the keys and `{parameter}` names from `en.js`; English supplies missing translations. Use `data-i18n` (or `data-i18n-aria-label` / `data-i18n-placeholder`) for static UI and `msg` with `localize` for dynamic text so switching updates existing nodes. Keep captured names, identifiers and raw evidence unchanged. Run the locale tests and check loaded views in the browser, including graph controls, layout and accessible names.
