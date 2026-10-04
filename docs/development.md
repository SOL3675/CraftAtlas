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

Git must already have access to the recorded origin if it is private. The pinned commit must be reachable there; local commits work only with `--source` until pushed. Registry access is still needed for locked third-party dependencies, but the `craft-foundry` package is not fetched from npm. Git checkout uses LF, package generation uses umask `022`, and npm packaging uses fixed tool versions to stabilize tarball integrity across OSes and cloud permission defaults. The caller's shell umask is unchanged. Do not repair an integrity failure by bypassing lock checks; inspect the source pin and tool versions.

Future placement at `CraftFoundry/projects/craft-atlas` uses `--source ../..`. Explicit paths also support differently named Windows checkouts. There is no automatic parent detection, root npm workspace, recursive clone, install lifecycle hook, or parent-child install cycle. Submodules are not required or created by this workflow.

## Update the dependency deliberately

1. Commit and validate Foundry changes on its development branch. For package/API changes, update its version and npm lock consistently; source-only development pins can distinguish commits even at the same package version.
2. Set the full commit and matching package version in `craft-foundry.source.json`. Do not use `dev`, `main`, `HEAD`, or a movable tag as the pin. Make that commit available at the recorded origin before expecting remote-only restoration. If an initial squash merge changes commit identity, pin the reachable merged commit afterward; squash does not erase dev/PR history.
3. Run `node scripts/prepare-foundry.mjs --source <checkout>` and `pnpm update craft-foundry --lockfile-only --ignore-scripts` to refresh the file dependency's integrity. Then run a clean `pnpm install --frozen-lockfile --ignore-scripts`, check, test, and build. Review the lockfile diff; do not bypass integrity checks.
4. Restore/update Skills with the installer above, which preserves user edits, and review `.agents/skills/.mch-skills.json`. Re-run the affected harness suites as described in [usage](usage.md). Commit the source pin, dependency/lock changes, and Skills provenance together, with the reason for the update. Do not commit archives or generated Skills.

The six imports are `core/config`, `core/cache`, `core/tools`, `core/types`, `adapters/runtime/server`, and `adapters/runtime/mc-pilot`, under `craft-foundry/`. Source and compiled adapters resolve these same exports; do not edit installed node_modules or copy harness source.

## Mod acquisition definitions

When adding a serializer, machine, trade or code-controlled item source, first inspect the target capture and `packages/core/src/normalize.ts`. Add or update a version-scoped DefinitionPack only for reviewed semantics; do not represent a material-consuming process as a starting inventory seed. Existing append/replace/disable/addition behavior and conflicts remain explicit. Use [definition contracts](contracts.md) for interpretation patches, references, tag expansion and coverage.

Run `pnpm check`, `pnpm test`, and `pnpm build` after authoring changes. `tests/definition-authoring.test.ts` exercises both 1.21.1 loaders, conditional custom serializer mapping, missing inputs, missing references, conflicts and incomplete captures. Add/update an equivalent positive route and missing-prerequisite regression for each new mechanism. Keep dynamic hooks unknown when their actual conditions cannot be verified.

`tests/datapack.test.ts` covers raw-resource overlays, unknown serializers, malformed data, manifests/SQLite/CLI and definition interaction. To exercise the shared Java capture/parser against an embedded archive plus overrides without Minecraft, run `node scripts/check-collector-datapack.ts --gson <existing-gson.jar>` with Java/JDK 21 on PATH. A JRE can instead use `--ecj <existing-ecj.jar>` (ECJ 3.38.0 tested). The script downloads nothing and simulates the ResourceManager boundary; it does not prove either loader's integration. Target inspect/build and actual game captures remain necessary for that boundary.

For the Foundry development workflow, use its [survival suite](https://github.com/SOL3675/CraftFoundry/blob/dev/docs/survival.md). Until this Atlas commit is published and selected by a reviewed Foundry gitlink, run from the Foundry checkout:

```console
npm run test:atlas:definitions -- --atlas-source ../CraftAtlas
node scripts/atlas-survival.mjs --config tests/atlas-definitions/fixtures/suite.json --results .harness/custom/results.json --atlas-source ../CraftAtlas
```

The explicit source must be a clean local Git checkout; results record its full commit and that it is a development source. Foundry's default runner continues to require the exact clean submodule pin. Publish the reviewed Atlas change first, then update Foundry's gitlink and enable its definition integration tests in CI. Do not commit an unreachable remote pin or alter Atlas's independently pinned Foundry package to perform this source integration.

## Validation and CI

[Contract CI](../.github/workflows/contracts.yml) installs pinned npm/pnpm in an ignored local prefix and calls their explicit JS entry points on both operating systems. `CRAFTFOUNDRY_NPM_CLI` identifies the installed npm entry point for bootstrap and remains stable when pnpm overrides npm_execpath; the selected version is still verified. Bootstrap regression tests run before repository access, so an authentication failure cannot hide those results. The full consumer checks still require the real pinned Foundry package and do not pass when acquisition fails.

For private Foundry, the default Atlas GITHUB_TOKEN is scoped to Atlas; it does not automatically grant access to the separate repository. The workflow can use an **existing authorized** token supplied as the Atlas repository Actions secret `CRAFTFOUNDRY_READ_TOKEN` (Settings → Secrets and variables → Actions → Repository secrets). Its minimum access is the selected `SOL3675/CraftFoundry` repository with Contents: read (and the automatically required metadata read); no write, workflow-management, or other-repository access is needed. An administrator must approve any new token, secret registration, or permission expansion separately. This repository does not create or configure that secret.

When the secret is available, a second pinned checkout fetches the full SHA into `.harness/ci/foundry-source` with `persist-credentials: false` and no submodules; bootstrap consumes its Git objects via `--source`. Without the secret, bootstrap uses the runner's existing Git access or public origin. Missing private access produces an explicit failure, not skipped consumer checks reported as success. Fork PRs may have no secret access and must not be granted privileged tokens automatically. See [checkout's private-repository guidance](https://github.com/actions/checkout/blob/11d5960a326750d5838078e36cf38b85af677262/README.md#checkout-multiple-repos-private).

Local cloud Git access is not automatically transferable to hosted CI. Do not copy its transient credentials into repository files or secrets. An already authenticated checkout on a managed runner is another valid `--source` input. Until approved CI access or public read access exists, the full private-repository CI remains blocked.

For integration, run doctor, inspect/build for each affected target, and its atlas-offline suite, followed by actual game suites when prerequisites are available. Doctor failures for absent Java/backend/display/EULA are environment blockers, not passes. Offline unit tests and successful TypeScript builds do not prove real Minecraft behavior.

Keep English procedural docs and a linked Japanese README. Retain necessary usage, constraints, licenses, and agent instructions; record changes/rationale in commits instead of separate design restatements, migration records, or phase histories. Pushes, PRs, merges, visibility changes, and publication are separate authorized operations.
