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

The checked-in `craft-foundry.source.json` records the verified repository URL, a full immutable commit, package version, and build-tool versions. The script checks the versions, fetches that commit into a fresh isolated Git checkout, runs Foundry's `npm ci --ignore-scripts` and build, then packages it to `.harness/vendor/craft-foundry.tgz`. Atlas's manifest references that stable local path; its lockfile verifies the exact packed bytes. Tarballs, node_modules, and build output are never committed.

`--source` uses Git objects from the given checkout, not its dirty files or current branch. The required commit must exist there. The script never changes that checkout, initializes its submodules, or installs Atlas while building Foundry. Existing package bytes are replaced only after a successful build; concurrent bootstraps are rejected. A stale bootstrap lock requires confirming its owner has stopped before removing it.

For a fresh machine without the Foundry checkout:

```console
node scripts/prepare-foundry.mjs
pnpm install --frozen-lockfile --ignore-scripts
```

Git must already have access to the recorded origin if it is private. The pinned commit must be reachable there; local commits work only with `--source` until pushed. Registry access is still needed for locked third-party dependencies, but the `craft-foundry` package is not fetched from npm. Git checkout uses LF and npm packaging uses fixed tool versions to stabilize tarball integrity across OSes. Do not repair an integrity failure by bypassing lock checks; inspect the source pin and tool versions.

Future placement at `CraftFoundry/projects/craft-atlas` uses `--source ../..`. Explicit paths also support differently named Windows checkouts. There is no automatic parent detection, root npm workspace, recursive clone, install lifecycle hook, or parent-child install cycle. Submodules are not required or created by this workflow.

## Update the dependency deliberately

1. Commit and validate Foundry changes on its development branch. For package/API changes, update its version and npm lock consistently; source-only development pins can distinguish commits even at the same package version.
2. Set the full commit and matching package version in `craft-foundry.source.json`. Do not use `dev`, `main`, `HEAD`, or a movable tag as the pin. Make that commit available at the recorded origin before expecting remote-only restoration. If an initial squash merge changes commit identity, pin the reachable merged commit afterward; squash does not erase dev/PR history.
3. Run `node scripts/prepare-foundry.mjs --source <checkout>` and `pnpm update craft-foundry --lockfile-only --ignore-scripts` to refresh the file dependency's integrity. Then run a clean `pnpm install --frozen-lockfile --ignore-scripts`, check, test, and build. Review the lockfile diff; do not bypass integrity checks.
4. Restore/update Skills with the installer above, which preserves user edits, and review `.agents/skills/.mch-skills.json`. Re-run the affected harness suites as described in [usage](usage.md). Commit the source pin, dependency/lock changes, and Skills provenance together, with the reason for the update. Do not commit archives or generated Skills.

The six imports are `core/config`, `core/cache`, `core/tools`, `core/types`, `adapters/runtime/server`, and `adapters/runtime/mc-pilot`, under `craft-foundry/`. Source and compiled adapters resolve these same exports; do not edit installed node_modules or copy harness source.

## Validation and CI

The bootstrap precedes frozen install in [contract CI](../.github/workflows/contracts.yml). Windows and Linux execute the same Node script. The workflow requires normal Git read access to the pinned Foundry repository; for separate private repositories, the default Atlas GITHUB_TOKEN does not automatically have that access. Configure an already authorized read-only checkout outside the workflow and pass `--source`, or supply repository access through the CI administrator's approved method. Do not commit credentials. Until that access or public read access exists, remote bootstrap is a visible CI prerequisite.

For integration, run doctor, inspect/build for each affected target, and its atlas-offline suite, followed by actual game suites when prerequisites are available. Doctor failures for absent Java/backend/display/EULA are environment blockers, not passes. Offline unit tests and successful TypeScript builds do not prove real Minecraft behavior.

Keep English procedural docs and a linked Japanese README. Retain necessary usage, constraints, licenses, and agent instructions; record changes/rationale in commits instead of separate design restatements, migration records, or phase histories. Pushes, PRs, merges, visibility changes, and publication are separate authorized operations.
