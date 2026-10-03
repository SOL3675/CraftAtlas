import { readFileSync, writeFileSync, mkdirSync, statSync, realpathSync, existsSync } from 'node:fs';
import { resolve, relative, isAbsolute, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, totalmem, release } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { readSnapshot } from '../packages/core/src/snapshot.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { buildDatabase, AtlasDatabase } from '../packages/core/src/db.ts';
import { localGraph } from '../packages/core/src/graph.ts';
import { bytesHash, hash } from '../packages/core/src/hash.ts';
import { runArtifacts } from '../packages/harness/src/common.ts';

// Offline measurements of a completed real-game run; no synthetic fallback or implicit latest run.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
const allowed = new Set(['--target', '--run', '--snapshot', '--measurements', '--output', '--budgets']);
const options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
  if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options[args[i]]) throw new Error('Expected unique --target/--run/--snapshot/--measurements/--output/--budgets value pairs');
  options[args[i]] = args[i + 1];
}
const required = (key: string) => { if (!options[key]) throw new Error(`Missing ${key}`); return options[key]; };
const target = required('--target'), runId = required('--run');
const output = resolve(required('--output'));
mkdirSync(output, { recursive: true });
const evidencePath = join(output, 'performance.json');
if (existsSync(evidencePath)) throw new Error(`Refusing to replace ${evidencePath}`);
const start = new Date().toISOString();
const report: any = { schemaVersion: 1, status: 'failed', target, runId, startedAt: start, errors: [] };
function check(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
const positive = (value: unknown, label: string) => { check(typeof value === 'number' && Number.isFinite(value) && value > 0, `Missing/invalid positive metric: ${label}`); return value as number; };
const sourcePaths = ['scripts/benchmark.ts', 'packages/core/src/normalize.ts', 'packages/core/src/world.ts', 'packages/core/src/db.ts', 'packages/core/src/graph.ts', 'packages/core/src/snapshot.ts', 'packages/core/src/validate.ts', 'packages/core/src/hash.ts', 'packages/core/src/diff.ts', 'packages/core/src/types.ts'];
const sourceHashes = () => Object.fromEntries(sourcePaths.map(path => [path, bytesHash(readFileSync(resolve(root, path)))]));
const timings = (samples: number[]) => {
  check(samples.length > 0 && samples.every(n => Number.isFinite(n) && n > 0), 'Empty/invalid timing samples');
  const sorted = [...samples].sort((a, b) => a - b);
  return { trials: samples.length, samplesMs: samples, p50Ms: sorted[Math.ceil(sorted.length * .5) - 1], p95Ms: sorted[Math.ceil(sorted.length * .95) - 1], maxMs: sorted.at(-1)! };
};
let rssPeak = process.memoryUsage().rss;
const rss = () => { rssPeak = Math.max(rssPeak, process.memoryUsage().rss); };
try {
  const budgetsPath = resolve(options['--budgets'] ?? join(root, 'fixtures/performance-budgets.json'));
  const budgetsBytes = readFileSync(budgetsPath), budgets = JSON.parse(budgetsBytes.toString());
  check(budgets.schemaVersion === 1 && budgets.targets?.[target], 'Unsupported performance budget/target');
  const budget = budgets.targets[target];
  writeFileSync(join(output, 'budgets.json'), budgetsBytes, { flag: 'wx' });
  const runRoot = realpathSync(join(root, '.harness/runs', runId));
  check(relative(join(root, '.harness/runs'), runRoot) === runId, 'Run must be an explicit local harness run ID');
  const runPath = join(runRoot, 'report.json');
  const runBytes = readFileSync(runPath), run = JSON.parse(runBytes.toString());
  check(run.id === runId && run.status === 'passed', 'A passed real-game run is required');
  const suite = run.targets?.find((t: any) => t.id === target)?.suites?.find((s: any) => s.id === budget.suite);
  check(Number.isInteger(budget.minimumCases) && budget.minimumCases > 0 && suite?.status === 'passed' && suite.detected >= budget.minimumCases && suite.cases?.length >= budget.minimumCases && suite.cases.every((c: any) => c.status === 'passed'), 'Required real-game suite/cases are missing');
  const snapshotPath = realpathSync(resolve(required('--snapshot'))), measurementsPath = realpathSync(resolve(required('--measurements')));
  for (const path of [snapshotPath, measurementsPath]) {
    const rel = relative(runRoot, path); check(rel && !rel.startsWith('..') && !isAbsolute(rel), 'Snapshot and measurements must belong to the named run');
  }
  check(statSync(snapshotPath).isDirectory() && relative(snapshotPath, measurementsPath) === 'measurements.json', 'Supply the original snapshot directory and its measurements.json');
  const artifacts = runArtifacts(runRoot, target);
  check(artifacts.some(a => a.kind === 'distribution' && a.path.endsWith('.jar')), 'Recorded distribution mod JAR is required');
  const deployedDistributions = artifacts.filter(a => a.kind === 'distribution').map(a => {
    const path = join(resolve(snapshotPath, '../..'), 'mods', basename(a.path));
    check(bytesHash(readFileSync(path)) === a.sha256, 'Deployed distribution differs from recorded JAR');
    return { path, sha256: a.sha256 };
  });
  const measurementBytes = readFileSync(measurementsPath), measurements = JSON.parse(measurementBytes.toString());
  const manifestPath = join(snapshotPath, 'manifest.json'), manifestBytes = readFileSync(manifestPath), manifest = JSON.parse(manifestBytes.toString());
  writeFileSync(join(output, 'input-manifest.json'), manifestBytes, { flag: 'wx' });
  writeFileSync(join(output, 'collector-measurements.json'), measurementBytes, { flag: 'wx' });
  const sourceBefore = sourceHashes();
  const beforeRead = performance.now(); const snapshot = readSnapshot(snapshotPath); const readMs = performance.now() - beforeRead; rss();
  check(snapshot.completion.status === 'complete' && snapshot.completion.errors.length === 0 && snapshot.recipes.length > 0 && snapshot.resources.length > 0 && snapshot.world && snapshot.world.lootTables.length > 0 && snapshot.world.features.length > 0, 'Required snapshot/world capture is incomplete or empty');
  check(snapshot.loader === budget.loader, 'Snapshot loader and budget target differ');
  check(measurements.recipes === snapshot.recipes.length && typeof measurements.capturedAt === 'string', 'Collector measurement identity/count missing');
  const captureNanos = positive(measurements.captureNanos, 'captureNanos');
  check(typeof measurements.heapDeltaBytes === 'number' && Number.isFinite(measurements.heapDeltaBytes), 'Required heap delta measurement missing (negative GC deltas are valid)');
  const snapshotJsonBytes = Object.keys(manifest.files).reduce((n, file) => n + statSync(join(snapshotPath, file)).size, 0);
  const normalizeTimes: number[] = []; let model: ReturnType<typeof normalize> | undefined;
  for (let trial = 0; trial < 3; ++trial) {
    const begin = performance.now(), next = normalize(snapshot); normalizeTimes.push(performance.now() - begin);
    if (model) check(next.contentHash === model.contentHash, 'Repeated normalization changed the semantic model');
    model = next; rss();
  }
  check(model && model.processes.length > 0 && model.evidence.length > 0, 'Normalization produced empty required data');
  const dbPath = join(output, 'atlas.sqlite'); check(!existsSync(dbPath), 'Database output exists');
  const beforeDb = performance.now(); buildDatabase(dbPath, model); const dbBuildMs = performance.now() - beforeDb; rss();
  const db = new AtlasDatabase(dbPath), planDb = new DatabaseSync(dbPath, { readOnly: true });
  const keys = ['minecraft:iron_ingot', 'minecraft:diamond', 'minecraft:oak_log', 'minecraft:cobblestone', 'minecraft:redstone'];
  check(keys.every(key => model!.resources.some(r => r.id === key)), 'Common workload resources are missing');
  const queries: Record<string, any> = {};
  const queryPlans = {
    search: planDb.prepare("EXPLAIN QUERY PLAN SELECT payload FROM resources WHERE snapshot_id=? AND (id LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY id LIMIT ? OFFSET ?").all(snapshot.id, '%iron%', '%iron%', 50, 0),
    sources: planDb.prepare('EXPLAIN QUERY PLAN SELECT p.payload FROM processes p WHERE p.snapshot_id=? AND EXISTS(SELECT 1 FROM outputs o WHERE o.snapshot_id=p.snapshot_id AND o.process_id=p.id AND o.resource_id=?) ORDER BY p.id LIMIT ? OFFSET ?').all(snapshot.id, keys[0], 50, 0),
    uses: planDb.prepare("EXPLAIN QUERY PLAN SELECT p.payload FROM processes p WHERE p.snapshot_id=? AND (EXISTS(SELECT 1 FROM input_members i WHERE i.snapshot_id=p.snapshot_id AND i.process_id=p.id AND i.resource_id=?) OR EXISTS(SELECT 1 FROM requirements r WHERE r.snapshot_id=p.snapshot_id AND r.process_id=p.id AND r.id=? AND r.kind IN ('equipment','stage','dimension'))) ORDER BY p.id LIMIT ? OFFSET ?").all(snapshot.id, keys[0], keys[0], 50, 0),
  };
  check(queryPlans.sources.some(p => String(p.detail).includes('output_lookup')) && queryPlans.uses.some(p => String(p.detail).includes('input_lookup')) && queryPlans.uses.some(p => String(p.detail).includes('requirement_lookup')), 'Required source/use indexes are not used');
  try {
    check(db.snapshots().length === 1 && db.snapshots()[0].contentHash === model.contentHash, 'Built database identity differs');
    for (const kind of ['search', 'sources', 'uses'] as const) {
      const query = (key: string) => kind === 'search' ? db.search(key.split(':').at(-1)!, { limit: 50 }) : db[kind](key, { limit: 50 });
      keys.forEach(query); // One unmeasured warm-up per key; production methods still count and decode pages.
      const times: number[] = [], results: any[] = [];
      for (let trial = 0; trial < 20; ++trial) {
        const key = keys[trial % keys.length], begin = performance.now(), page = query(key); times.push(performance.now() - begin);
        results.push({ key, total: page.total, returned: page.items.length, truncated: page.truncated }); rss();
      }
      check(results.reduce((n, r) => n + r.returned, 0) > 0, `Zero detected ${kind} results`);
      queries[kind] = { ...timings(times), results, plans: queryPlans[kind] };
    }
  } finally { db.close(); planDb.close(); }
  const graphTimes: number[] = [], graphs: any[] = [];
  for (let trial = 0; trial < 10; ++trial) {
    const key = keys[trial % keys.length], begin = performance.now(), graph = localGraph(model, key, { depth: 2, limit: 200, direction: 'both', rootKind: 'resource' });
    graphTimes.push(performance.now() - begin); rss();
    check(graph.nodes.length > 1 && graph.edges.length > 0 && graph.nodes.length <= 200 && graph.depth === 2, 'Empty graph or ignored node/depth cap');
    const nodes = new Set(graph.nodes.map(n => n.id)); check(graph.edges.every(e => nodes.has(e.source) && nodes.has(e.target)), 'Dangling graph edge');
    graphs.push({ key, nodes: graph.nodes.length, edges: graph.edges.length, truncated: graph.truncated });
  }
  rss(); const resourceUsage = process.resourceUsage();
  // Node reports maxRSS in KiB; retain both sampled RSS and the process high-water measurement.
  const nodePeakRssBytes = Math.max(rssPeak, resourceUsage.maxRSS * 1024);
  const normalizeStats = timings(normalizeTimes), graphStats = timings(graphTimes);
  const metrics: Record<string, number> = {
    resources: snapshot.resources.length, recipes: snapshot.recipes.length, processes: model.processes.length,
    evidence: model.evidence.length, snapshotJsonBytes, dbBytes: statSync(dbPath).size,
    captureMs: captureNanos / 1e6, captureHeapDeltaBytes: Math.max(0, measurements.heapDeltaBytes),
    nodePeakRssBytes, readMs, normalizeP95Ms: normalizeStats.p95Ms, dbBuildMs,
    searchP95Ms: queries.search.p95Ms, sourcesP95Ms: queries.sources.p95Ms, usesP95Ms: queries.uses.p95Ms, graphP95Ms: graphStats.p95Ms,
  };
  report.metrics = metrics;
  const requiredMetrics = Object.keys(metrics);
  check(Object.keys(budget.limits).length === requiredMetrics.length && requiredMetrics.every(key => budget.limits[key]), 'All required metrics must have explicit limits');
  const checks = requiredMetrics.map(key => {
    const value = metrics[key], limit = budget.limits[key];
    check(Number.isFinite(value) && (value > 0 || key === 'captureHeapDeltaBytes'), `Unmeasured required metric ${key}`);
    check(Number.isFinite(limit.max) && limit.max > 0 && Number.isFinite(limit.min) && limit.min >= 0 && limit.max >= limit.min, `Invalid budget ${key}`);
    return { metric: key, value, ...limit, status: value >= limit.min && value <= limit.max ? 'passed' : 'failed' };
  });
  check(hash(sourceBefore) === hash(sourceHashes()), 'Benchmark/core sources changed during measurement');
  Object.assign(report, {
    provenance: { run: { path: runPath, sha256: bytesHash(runBytes), suite: budget.suite, detected: suite.detected },
      snapshot: { path: snapshotPath, manifestSha256: bytesHash(manifestBytes), contentHash: manifest.contentHash, snapshotId: snapshot.id, generation: snapshot.generation },
      measurements: { path: measurementsPath, sha256: bytesHash(measurementBytes), ...measurements },
      artifacts: artifacts.map(a => ({ ...a, path: join(runRoot, a.path) })), deployedDistributions, budget: { path: budgetsPath, archivedPath: join(output, 'budgets.json'), sha256: bytesHash(budgetsBytes) }, sourceHashes: sourceBefore },
    host: { node: process.version, platform: process.platform, arch: process.arch, osRelease: release(), cpu: cpus()[0]?.model, logicalCpus: cpus().length, totalMemoryBytes: totalmem() },
    workload: { normalizationTrials: 3, databaseBuildTrials: 1, queryTrialsPerEndpoint: 20, queryWarmupsPerEndpoint: keys.length, graphTrials: 10, graphDepth: 2, graphNodeLimit: 200, keys, forcedGc: false, isolatedHost: false },
    metrics, normalization: normalizeStats, queries, graph: { ...graphStats, samples: graphs },
    memory: { sampledRssPeakBytes: rssPeak, resourceUsageMaxRssKiB: resourceUsage.maxRSS, captureHeapDeltaBytes: measurements.heapDeltaBytes, note: 'Collector heap delta may include garbage collection; it is allocation evidence, not retained heap. Node high water covers read/normalize/database/query/graph in this process.' },
    database: { path: dbPath, sha256: bytesHash(readFileSync(dbPath)), modelContentHash: model.contentHash },
    checks, status: checks.every(c => c.status === 'passed') ? 'passed' : 'failed',
  });
  if (report.status === 'failed') report.errors.push('One or more performance budgets failed');
} catch (error) { report.errors.push(String(error)); }
report.finishedAt = new Date().toISOString();
writeFileSync(evidencePath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
process.stdout.write(JSON.stringify({ status: report.status, target, runId, evidence: evidencePath, metrics: report.metrics, errors: report.errors }) + '\n');
if (report.status !== 'passed') process.exitCode = 1;
