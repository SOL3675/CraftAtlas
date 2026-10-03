# Measure performance

Use `scripts/benchmark.ts` on an explicitly selected successful real-server Run and its completed baseline capture. Offline demo fixtures cannot substitute for real-pack evidence. Complete [game setup](usage.md) first. Choose a new output directory for every measurement; overwriting is rejected.

```console
node scripts/benchmark.ts --target neoforge-1.21.1 --run <run-id> --snapshot .harness/runs/<run-id>/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline --measurements .harness/runs/<run-id>/sessions/neoforge-1.21.1/atlas-server/game/craftatlas/baseline/measurements.json --output .harness/performance/neo-new
node scripts/benchmark.ts --target fabric-1.21.1 --run <run-id> --snapshot .harness/runs/<run-id>/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline --measurements .harness/runs/<run-id>/sessions/fabric-1.21.1/atlas-fabric-server/game/craftatlas/baseline/measurements.json --output .harness/performance/fabric-new
```

Replace every run-id with the actual chosen Run. The script verifies completion, manifests/checksums/semantic hashes, required suite cases, and recorded/deployed JAR identities. [Budgets](../fixtures/performance-budgets.json) require every metric: missing metrics, empty data, or exceeded limits produce status failed and exit 1. `--budgets` selects a reviewed alternative budget, not a way to hide missing required metrics.

Capture time/heap delta come from the recorded Java measurements; offline reruns do not regenerate them. The script measures snapshot loading, three normalizations (including the first), one DB build, twenty queries per query kind, and bounded local graphs. It records timings, counts, input/source hashes, query plans, and budget outcomes in performance.json, with copied inputs and a DB. Archive the actual Run together with this ignored output when sharing evidence.

Record OS, CPU, memory, Node version, concurrent load, and storage. Cache/JIT/GC variation affects timings. NeoForge and Fabric packs have different Mods, so differences do not isolate loader performance. These budgets do not promise arbitrary-pack scalability.

For UI measurements, serve the actual captured model, inspect graph root `data-performance` values, and evaluate [UI budgets](../fixtures/ui-performance-budgets.json). apiMs measures through response parsing; domBuildMs measures DOM construction; frameReadyMs waits for two animation-frame callbacks. Record resource IDs, graph bounds, browser/environment, counts, and screenshots. These timings are not exact GPU paint time, sustained FPS, or long-term p95. Keep measurement evidence outside versioned procedural docs.
