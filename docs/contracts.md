# Data contracts and interpretation limits

[JSON schemas](../schemas/) and [TypeScript types](../packages/core/src/types.ts) define the exact fields. Schema version is 1; unknown versions are rejected rather than silently migrated. This guide explains interpretation rules needed to use the outputs correctly.

## Snapshots and evidence

A snapshot is one JSON file or a completed capture directory. A directory includes a manifest with file SHA-256 and semantic identities, resource/tag data, raw recipes.jsonl, environment information, coverage, optional viewer/world datasets, and completion.json. Standalone arbitrary JSONL is not an input format. Missing completion, failed capture, mismatched checksums, or paths escaping the capture root are rejected. A reload that changes the generation before publication cannot produce a successful capture.

Capture IDs/session/generation identify the acquisition; contentHash compares semantic data including versions, environment, Mods, resources, processes, tags, and coverage. A timestamp change alone is not a recipe change. Coverage distinguishes complete/partial/unsupported/failed; enumerated counts are denominators, interpreted counts describe understood entries, and unknown counts are null. Enumerating all recipes does not mean all Loot, worldgen, or code-generated acquisition paths are covered.

Evidence distinguishes runtime, viewer, definition, inference, and observation. Field evidence and replacement history preserve provenance. Final runtime state cannot reconstruct every overwritten script line or reason a recipe disappeared. Viewer categories and workstation hints do not prove executable survival routes.

## Resources, scenarios, and reachability

Process input slots are AND; alternatives inside a slot are OR. Tags retain their name and captured membership. Input quantities distinguish consumed materials, catalysts, and durability. Outputs distinguish products, byproducts, and returns. Probability null is unknown, 0 is impossible, and 1 is deterministic. Unknown predicates/components cannot be reduced to ordinary ID matching.

Owning an equipment item differs from having installed usable equipment. Scenarios declare inventory, equipment, stages, dimensions, forbidden processes, allowed types, supply assumptions, closed resource scope, and game rules. `allowedTypes: null` is unrestricted; an empty array forbids every type. Typed loot context predicates compare explicit `scenario.gameRules.lootContext` facts; absent facts remain unknown.

Results are reachable/unreachable/unknown. Proving unreachable requires an explicitly closed scope and adequate capture/interpretation coverage. Qualitative reachability does not prove a finite-inventory executable schedule, resource regeneration, infinite supply, or optimal routes. Cycles cannot create their own initial supply. Diagnostics preserve missing versus unsupported information; display filters do not modify scenario restrictions.

Definitions declare exact target Minecraft/loader/Mod versions, distinguish missing targets, version mismatch, unmatched selectors, duplicates, and conflicts, and support append/replace/disable/additional processes. Replacements must explicitly override conflicts; priority alone does not hide them. Definitions enrich analysis and do not modify the game. Fictional definitions are test inputs, not real-Mod support claims.

For a custom serializer, an explicit `replace` operation can also set `interpretation: "supported"`. Supply reviewed inputs, outputs, requirements, execution state and remaining unknowns; setting interpretation alone does not remove uncertainty. An opaque Java condition needs an opaque requirement or an unknown reason. Typed `context` requirements use explicit scenario facts, not Java execution. The consumer capability marker `definitionContractVersion = 2` distinguishes this authoring support from older source APIs; the additive JSON schema remains version 1.

Definition inputs/outputs must reference captured resources. Tags are expanded from the current snapshot, overriding supplied member lists; missing tags/resources and ambiguous alternatives produce `definition-reference-missing` and retain unknown. Equipment, stage and dimension requirements may name explicit scenario assumptions; reusable unlock resources still need to be present in the captured resource model. Overlays preserve raw values, field history and runtime diagnostics. After applying definitions, derived recipe normalization coverage is recalculated and added processes have separate `definitions` coverage. Raw capture/world/viewer coverage is never promoted. Unknown costs, predicates, custom constraints and conflicts retain incomplete interpretation. The Foundry survival evidence also records original and effective coverage and definition hashes.

SQLite is a rebuildable single-snapshot query cache, not an append-only history store. Keep the raw snapshot, normalizer revision, and applied definitions to reproduce it.

## CLI and HTTP

Machine output has schemaVersion, query, result, evidence, and limitations. Pages return items, total, limit, offset, and truncated. Defaults are 30 items and graph depth 1; bounds are 100 items, offset 1,000,000, depth 5, and 100 evidence entries. Display truncation does not truncate the underlying analysis. `explain` bounds its displayed route length by depth × limit and pages remaining diagnostics/reasons.

CLI exit 0 means the query completed; 1 means input/execution error. In particular, audit exit 0 does not mean expectations passed, and cost exit 0 does not mean a complete calculation. Inspect diagnostics, result status, total, and all relevant pages.

HTTP is a read-only GET API bound to loopback, with Host/Origin validation. It uses the model selected at startup and provides search/inspect/sources/uses/graph/coverage/diagnostics/diff/explain/cost. Cost uses the startup scenario/request or schema-validated request JSON (maximum 32768 characters). No arbitrary-file-read API is exposed.

## World data and finite observations

Loot tables/references/conditions/functions and applied modifier order are distinct from proof of all events or custom code. Applied biome/spawn/generator/feature relationships differ from registry-only features. Unknown hooks, generation rates, and code-controlled restrictions remain unknown; Fabric cannot enumerate every Java loot hook.

Observations record acquisition/environment identity, seed/generator/dimension/chunk/player, biome/difficulty/context/time/weather/game rules, trials, and results. Their own manifest/completion is verified, and only matching-generation data can attach to a dump. Finite non-observation cannot prove absence; observed quantities cannot establish sustainable or infinite supply. Observation-backed processes remain display/unknown evidence.

## Selected-route costs

A [cost request](../schemas/cost-request.schema.json) selects target resource/quantity/unit, routes/output indexes, OR material selections, mode, probability models, durability, and optional inventory units. Cycles, forbidden processes, and unit mismatch are invalid. Uninterpreted requirements or missing probability distributions yield unknown. Bounds are 1000 expansions, depth 100, and quantity 1e12.

Setup and recurring materials/costs remain separate, with batches, returns, deterministic byproducts, catalyst capacity, and tool durability. Different units are not summed. Unknown total amount is null and knownSubtotal preserves the known portion. This is selected-route accumulation, not optimization or parallel completion-time prediction.

Expectation mode requires explicit IID Bernoulli assumptions. For n successes with probability p, expected trials are n/p and variance n(1-p)/p²; output independence is separately declared. Random byproducts are not automatically reused as upstream supply. Finite inventory, upstream batch rounding, or random durability replacement can require full distributions and remain mean-flow/unknown. Joint variance of all material costs is outside scope.

Harness suites distinguish passed/failed/unsupported/skipped/infrastructure-error and require actual cases. Required missing or unsupported behavior cannot become a release pass. Keep raw data, hashes, diagnostics, logs, and artifacts within the Run for audit, rather than committing generated evidence.
