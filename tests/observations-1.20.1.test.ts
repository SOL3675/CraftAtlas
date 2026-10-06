import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot1201 } from './fixtures-1.20.1.ts';
import { scenario } from './helpers.ts';
import { bytesHash, hash } from '../packages/core/src/hash.ts';
import { validate } from '../packages/core/src/validate.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { diff } from '../packages/core/src/diff.ts';
import { writeSnapshot, readSnapshot } from '../packages/core/src/snapshot.ts';
import { readObservation1201 } from '../packages/harness/src/observation-1.20.1.ts';

/** Synthetic records verify contracts only, never claim Minecraft execution. */
function observation(loader: 'forge' | 'fabric', kind: 'loot' | 'world' = 'loot') {
  const snapshot = snapshot1201(loader); snapshot.generation = 1;
  const shared = { schemaVersion: 1, id: 'synthetic', session: snapshot.session, generation: snapshot.generation, minecraft: snapshot.minecraft,
    loader, loaderVersion: snapshot.loaderVersion, environmentHash: hash(snapshot.environment), seed: '8675309', generator: { type: 'minecraft:noise' },
    dimension: 'minecraft:overworld', difficulty: 'normal', biome: 'minecraft:plains', position: [0, 0, 0], player: null,
    gameTime: '1', dayTime: '1', weather: { raining: false, thundering: false }, gameRules: '{}',
    kind, trials: 1, limitations: ['Synthetic publication fixture; no Minecraft execution'] };
  const value: any = kind === 'loot' ? { ...shared, chunks: [{ x: 0, z: 0 }], lootTable: 'atlas:probe', context: { kind: 'explicit_table' },
    samples: [{ trial: 0, randomSeed: '8675310', outputs: [{ resource: 'minecraft:diamond', amount: 2, stack: { id: 'minecraft:diamond', Count: 2 } }] }], totals: { 'minecraft:diamond': 2 } }
    : { ...shared, chunks: [{ x: 0, z: 0, wasLoaded: true, minY: 0, maxY: 31, blockCounts: { 'block:minecraft:stone': 8192 }, biomes: ['minecraft:plains'] }], totals: { 'block:minecraft:stone': 8192 } };
  return { snapshot, value };
}
function publish(directory: string, value: any, manifestPatch = {}, completionPatch = {}) {
  const bytes = JSON.stringify(value);
  const manifestBytes = JSON.stringify({ schemaVersion: 1, id: value.id, session: value.session, generation: value.generation,
    files: { 'observation.json': bytesHash(Buffer.from(bytes)) }, contentHash: hash(value), ...manifestPatch });
  writeFileSync(join(directory, 'observation.json'), bytes); writeFileSync(join(directory, 'manifest.json'), manifestBytes);
  writeFileSync(join(directory, 'completion.json'), JSON.stringify({ status: 'complete', errors: [], id: value.id, manifestHash: bytesHash(Buffer.from(manifestBytes)), ...completionPatch }));
}
for (const loader of ['forge', 'fabric'] as const) test(`${loader}: finite publication verifies schema, identities, checksums and totals; corruption never passes`, () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-observation-'));
  try {
    for (const kind of ['loot', 'world'] as const) {
      const { snapshot, value } = observation(loader, kind); publish(directory, value);
      assert.deepEqual(readObservation1201(directory, snapshot), value);
      const bad = (edit: (value: any) => void) => { const copy = structuredClone(value); edit(copy); publish(directory, copy); assert.throws(() => readObservation1201(directory, snapshot)); };
      for (const field of ['id', 'session', 'generation', 'environmentHash', 'generator', 'limitations']) bad(copy => { delete copy[field]; });
      bad(copy => { copy.session = 'different-session'; }); bad(copy => { ++copy.generation; });
      bad(copy => { copy.environmentHash = '0'.repeat(64); }); bad(copy => { copy.loaderVersion = 'different'; });
      bad(copy => { copy.loader = loader === 'forge' ? 'fabric' : 'forge'; });
      bad(copy => { copy.minecraft = '1.21.1'; }); bad(copy => { copy.trials = 0; }); bad(copy => { copy.trials = 1001; });
      bad(copy => { copy.totals['minecraft:invented'] = 1; });
      if (kind === 'loot') {
        bad(copy => { copy.samples[0].randomSeed = '0'; }); bad(copy => { copy.samples[0].trial = 1; });
        bad(copy => { copy.samples[0].outputs[0].amount = -1; }); bad(copy => { copy.samples = []; });
      } else {
        bad(copy => { copy.chunks[0].maxY = 64; }); bad(copy => { copy.chunks[0].maxY = -1; });
        bad(copy => { copy.chunks[0].blockCounts['block:minecraft:stone'] = 8191; });
        bad(copy => { copy.trials = 2; copy.chunks.push(structuredClone(copy.chunks[0])); copy.totals['block:minecraft:stone'] *= 2; });
      }
      for (const patch of [{ session: 'stale' }, { id: 'different' }, { generation: 99 }, { contentHash: '0'.repeat(64) }, { files: { 'observation.json': '0'.repeat(64) } }]) {
        publish(directory, value, patch); assert.throws(() => readObservation1201(directory, snapshot));
      }
      for (const patch of [{ status: 'failed' }, { errors: ['write failed'] }, { id: 'different' }, { manifestHash: '0'.repeat(64) }]) {
        publish(directory, value, {}, patch); assert.throws(() => readObservation1201(directory, snapshot));
      }
      publish(directory, value); writeFileSync(join(directory, 'observation.json'), JSON.stringify({ ...value, trials: 2 }));
      assert.throws(() => readObservation1201(directory, snapshot));
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
for (const loader of ['forge', 'fabric'] as const) test(`${loader}: observations retain NBT/provenance and runtime diagnostics without supplying executable routes`, () => {
  const { snapshot, value } = observation(loader);
  value.context = { kind: 'block', tool: { id: 'minecraft:diamond_pickaxe', Count: 1, tag: '{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]}' }, breakPerformed: false };
  validate('observation-1.20.1', value);
  snapshot.world = { lootTables: [], lootModifiers: [], lootSources: [], biomes: [], dimensions: [], features: [], observations: [value], limitations: [] };
  snapshot.coverage.push({ dataset: 'observation', type: 'finite samples', status: 'partial', enumerated: 1, interpreted: null, reasons: ['Finite samples never prove absence'] });
  const model = normalize(snapshot), process = model.processes.find(process => process.id === 'observation:synthetic')!;
  assert.deepEqual(process.raw, value); assert.equal(process.execution, 'display'); assert.equal(process.interpretation, 'opaque');
  assert.deepEqual(process.outputs.map(output => [output.resource, output.amount, output.probability]), [['minecraft:diamond', 2, null]]);
  assert.ok(model.evidence.some(evidence => evidence.kind === 'observation'));
  assert.ok(model.diagnostics.some(diagnostic => diagnostic.rule === 'recipe-resource-missing' && diagnostic.target === 'atlas:runtime_only'));
  assert.equal(model.coverage.find(row => row.dataset === 'observation')?.status, 'partial');
  const context = scenario(); context.inventory = {}; context.allowedTypes = ['minecraft:observation'];
  assert.notEqual(analyze(model, context, 'minecraft:diamond').status, 'reachable');
  const directory = mkdtempSync(join(tmpdir(), 'atlas-observation-snapshot-'));
  try {
    writeSnapshot(join(directory, 'capture'), snapshot); assert.deepEqual(readSnapshot(join(directory, 'capture')).world!.observations, [value]);
    const changed = structuredClone(snapshot); (changed.world!.observations![0] as any).totals['minecraft:diamond'] = 3;
    assert.ok(diff(model, normalize(changed)).changes.some(change => change.id === 'observation:synthetic'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('both 1.20.1 loaders require the shared seven-case real-game suite and inherit level-2 command permissions', () => {
  const config = JSON.parse(readFileSync('harness.config.json', 'utf8'));
  for (const loader of ['forge', 'fabric']) {
    assert.ok(config.targets[`${loader}-1.20.1`].requiredSuites.includes('atlas-1.20.1-world'));
    const path = loader === 'forge' ? 'forge/CollectorMod' : 'fabric/FabricAtlasMod';
    const source = readFileSync(`mods/collector-${loader}-1.20.1/src/main/java/dev/craftatlas/${path}.java`, 'utf8');
    assert.match(source, /requires\(s -> s.hasPermission\(2\)\)/); assert.match(source, /\.then\(ObservationCommands.tree\(/);
  }
  const suite = config.suites['atlas-1.20.1-world']; assert.equal(suite.minTests, 7);
  assert.equal(suite.expectedTests.length, 7); assert.equal(new Set(suite.expectedTests).size, 7);
  assert.ok(suite.eulaRequired); assert.deepEqual(suite.requiredCapabilities, ['dedicated-server', 'world-observation']);
  const source = readFileSync('mods/collector-1.20.1-common/src/main/java/dev/craftatlas/WorldObservations.java', 'utf8');
  assert.match(source, /getRandomItems\(parameters, seed\)/); assert.doesNotMatch(source, /getRandomItemsRaw/);
  assert.match(source, /LootContextParams.KILLER_ENTITY/); assert.doesNotMatch(source, /reloadableRegistries/);
});
