import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, scenario } from './helpers.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { diff } from '../packages/core/src/diff.ts';
import { readSnapshot, writeSnapshot } from '../packages/core/src/snapshot.ts';
import type { Json, Snapshot } from '../packages/core/src/types.ts';

function worldFixture(table: Json): Snapshot {
  const s = fixture(); s.recipes = []; s.coverage = [{ dataset: 'loot', type: '*', status: 'complete', enumerated: 1, interpreted: null, reasons: [] }];
  s.world = { lootTables: [{ id: 'atlas:probe', type: 'minecraft:loot_table', data: table }], lootModifiers: [], lootSources: [], biomes: [], dimensions: [], features: [], observations: [], limitations: [] }; return s;
}
const item = (id = 'minecraft:diamond') => ({ type: 'minecraft:item', name: id });
const table = (entries: Json[], extra: Record<string, Json> = {}) => ({ pools: [{ rolls: 1, entries, ...extra }] });
const lootScenario = () => { const s = scenario(); s.inventory['loot-context:atlas:probe'] = 1; return s; };
test('loot references, fixed rolls and per-stack count functions preserve quantities and evidence', () => {
  const s = worldFixture({ pools: [{ rolls: 2, entries: [{ type: 'minecraft:loot_table', value: 'atlas:nested' }], functions: [{ function: 'minecraft:set_count', count: 3 }] }] });
  s.world!.lootTables.push({ id: 'atlas:nested', type: 'minecraft:loot_table', data: table([item()]) });
  const m = normalize(s), p = m.processes.find(p => p.id === 'loot:atlas:probe')!;
  assert.equal(p.outputs[0].amount, 6); assert.equal(p.outputs[0].probability, 1); assert.equal(p.interpretation, 'supported');
  assert.ok(p.evidence.includes('runtime:world:lootTables:atlas:nested')); assert.equal(analyze(m, lootScenario(), 'minecraft:diamond').status, 'reachable');
});
test('weighted empty draws and random chance retain marginal probabilities without zero-as-unknown', () => {
  const m = normalize(worldFixture(table([{ ...item(), weight: 3 }, { type: 'minecraft:empty', weight: 1 }], { conditions: [{ condition: 'minecraft:random_chance', chance: 0.5 }] })));
  const p = m.processes.find(p => p.type === 'minecraft:loot')!; assert.equal(p.outputs[0].probability, 0.375);
  const zero = normalize(worldFixture(table([item()], { conditions: [{ condition: 'minecraft:random_chance', chance: 0 }] })));
  assert.equal(zero.processes.find(p => p.type === 'minecraft:loot')!.outputs.length, 0);
});
test('player and tool loot contexts require explicit scenario facts', () => {
  const m = normalize(worldFixture(table([item()], { conditions: [{ condition: 'minecraft:killed_by_player' }, { condition: 'minecraft:match_tool', predicate: { items: 'minecraft:stick' } }] })));
  const s = lootScenario(); assert.equal(analyze(m, s, 'minecraft:diamond').status, 'unknown');
  s.gameRules = { lootContext: { killedByPlayer: true, tool: 'minecraft:stick' } }; assert.equal(analyze(m, s, 'minecraft:diamond').status, 'reachable');
  s.gameRules = { lootContext: { killedByPlayer: false, tool: 'minecraft:stick' } }; assert.notEqual(analyze(m, s, 'minecraft:diamond').status, 'reachable');
});
test('post-loot additions retain their own context and opaque code can invalidate base-output proofs', () => {
  const s = worldFixture(table([item()]));
  s.world!.lootModifiers.push({ id: 'atlas:post', type: 'neoforge:global_loot_modifier', data: { type: 'craftatlas:add_item', item: 'minecraft:gold_ingot', count: 2, conditions: [{ condition: 'neoforge:loot_table_id', loot_table_id: 'atlas:probe' }, { condition: 'minecraft:weather_check', raining: true }] } });
  const m = normalize(s), context = lootScenario(); context.gameRules = { lootContext: { raining: false } };
  assert.equal(analyze(m, context, 'minecraft:diamond').status, 'reachable'); assert.notEqual(analyze(m, context, 'minecraft:gold_ingot').status, 'reachable');
  context.gameRules = { lootContext: { raining: true } }; assert.equal(analyze(m, context, 'minecraft:gold_ingot').status, 'reachable');
  s.world!.lootModifiers.push({ id: 'atlas:code', type: 'neoforge:global_loot_modifier', data: { type: 'custom:remove_everything', conditions: [] } });
  assert.equal(analyze(normalize(s), context, 'minecraft:diamond').status, 'unknown');
});
test('loot reference cycles, random counts and linked pool conditions remain unknown', () => {
  const s = worldFixture(table([{ type: 'minecraft:loot_table', value: 'atlas:probe' }]));
  assert.match(normalize(s).processes[0].unknown.join(), /cycle/);
  const random = normalize(worldFixture(table([{ ...item(), functions: [{ function: 'minecraft:set_count', count: { type: 'minecraft:uniform', min: 1, max: 5 } }] }])));
  assert.equal(random.processes[0].outputs[0].probability, null); assert.equal(random.processes[0].interpretation, 'opaque');
  const linked = normalize(worldFixture({ pools: [{ rolls: 1, entries: [item()], conditions: [{ condition: 'minecraft:weather_check', raining: true }] }, { rolls: 1, entries: [item('minecraft:gold_ingot')] }] }));
  assert.equal(analyze(linked, lootScenario(), 'minecraft:gold_ingot').status, 'unknown');
});
test('applied generator relationships differ from registry-only features and finite observations', () => {
  const s = worldFixture(table([item()]));
  s.world!.features = [{ id: 'configured_feature:atlas:ore', type: 'configured', data: { type: 'minecraft:ore', config: { size: 10, targets: [{ state: { Name: 'minecraft:diamond_ore' } }] } } }, { id: 'placed_feature:atlas:ore', type: 'placed', data: { feature: 'atlas:ore', placement: [] } }, { id: 'placed_feature:atlas:unused', type: 'placed', data: { feature: 'atlas:ore', placement: [] } }];
  s.world!.biomes = [{ id: 'minecraft:plains', type: 'biome', data: { generation: { features: [['atlas:ore']] }, spawns: { spawners: { monster: [{ type: 'minecraft:zombie', weight: 95 }] } } } }];
  s.world!.dimensions = [{ id: 'minecraft:overworld', type: 'dimension', data: { generator: { type: 'minecraft:noise' }, possibleBiomes: ['minecraft:plains'] } }];
  s.world!.observations = [{ id: 'sample', kind: 'world', trials: 1, totals: { 'block:minecraft:diamond_ore': 0 }, seed: '1', chunks: [[0, 0]], limitations: ['Finite sample'] }];
  const m = normalize(s), p = m.processes.find(p => p.type === 'minecraft:worldgen')!;
  assert.equal(p.outputs[0].resource, 'block:minecraft:diamond_ore'); assert.equal(p.outputs[0].probability, null); assert.equal(p.execution, 'unconfirmed');
  assert.equal(m.processes.find(p => p.id === 'registry:placed_feature:atlas:unused')!.execution, 'display');
  assert.equal(m.processes.find(p => p.id === 'observation:sample')!.outputs.length, 0);
  const context = scenario(); context.inventory['biome:minecraft:plains'] = 1;
  assert.equal(analyze(m, context, 'block:minecraft:diamond_ore').status, 'unknown');
  assert.ok(m.processes.some(p => p.type === 'minecraft:spawn')); assert.ok(m.evidence.some(e => e.kind === 'observation'));
});
test('world datasets participate in snapshot publication checks and duplicate record rejection', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-world-'));
  try { const s = worldFixture(table([item()])), path = join(root, 'snapshot'); writeSnapshot(path, s); assert.deepEqual(readSnapshot(path), s); s.world!.lootTables.push(s.world!.lootTables[0]); assert.throws(() => normalize(s), /Duplicate world/); }
  finally { rmSync(root, { recursive: true, force: true }); }
});
test('zero-weight loot candidates cannot prove a yield, including an all-zero pool', () => {
  const m = normalize(worldFixture(table([{ ...item(), weight: 0 }, { ...item('minecraft:gold_ingot'), weight: 1 }])));
  const p = m.processes.find(p => p.type === 'minecraft:loot')!;
  assert.deepEqual(p.outputs.map(o => o.resource), ['minecraft:gold_ingot']);
  assert.equal(analyze(m, lootScenario(), 'minecraft:gold_ingot').status, 'reachable');
  assert.notEqual(analyze(m, lootScenario(), 'minecraft:diamond').status, 'reachable');
  const empty = normalize(worldFixture(table([{ ...item(), weight: 0 }])));
  assert.equal(empty.processes.find(p => p.type === 'minecraft:loot')!.outputs.length, 0);
});
test('zero base rolls do not imply absence when luck-dependent bonus rolls are unacquired', () => {
  for (const rolls of [0, 1]) {
    const m = normalize(worldFixture(table([item()], { rolls, bonus_rolls: 1 })));
    const p = m.processes.find(p => p.type === 'minecraft:loot')!;
    assert.equal(p.interpretation, 'opaque'); assert.equal(p.outputs[0].amount, 1); assert.equal(p.outputs[0].probability, null);
    assert.equal(analyze(m, lootScenario(), 'minecraft:diamond').status, 'unknown');
  }
});
test('empty expanded tags do not leave a false fixed denominator for sibling candidates', () => {
  const s = worldFixture(table([{ type: 'minecraft:tag', name: 'atlas:empty', expand: true }, item()]));
  s.tags['atlas:empty'] = [];
  const m = normalize(s), p = m.processes.find(p => p.type === 'minecraft:loot')!;
  assert.equal(p.interpretation, 'opaque'); assert.equal(p.outputs[0].resource, 'minecraft:diamond'); assert.equal(p.outputs[0].probability, null);
});
test('conditional candidate expansion and group entries cannot become fixed independent yields', () => {
  const random = normalize(worldFixture(table([{ ...item(), conditions: [{ condition: 'minecraft:random_chance', chance: 0.5 }] }, item('minecraft:gold_ingot')])));
  const p = random.processes.find(p => p.type === 'minecraft:loot')!;
  assert.equal(p.interpretation, 'opaque'); assert.ok(p.outputs.every(o => o.probability === null));
  assert.equal(analyze(random, lootScenario(), 'minecraft:gold_ingot').status, 'unknown');
  const context = normalize(worldFixture(table([{ ...item(), conditions: [{ condition: 'minecraft:killed_by_player' }] }, item('minecraft:gold_ingot')])));
  const s = lootScenario(); s.gameRules = { lootContext: { killedByPlayer: false } };
  assert.ok(context.processes.find(p => p.type === 'minecraft:loot')!.requirements.every(r => r.kind === 'opaque'));
  assert.equal(analyze(context, s, 'minecraft:gold_ingot').status, 'unknown');
  const grouped = normalize(worldFixture(table([{ type: 'minecraft:group', children: [item(), item('minecraft:gold_ingot')] }])));
  assert.equal(grouped.processes.find(p => p.type === 'minecraft:loot')!.interpretation, 'opaque');
  assert.ok(grouped.processes.find(p => p.type === 'minecraft:loot')!.outputs.every(o => o.probability === null));
  assert.equal(analyze(grouped, lootScenario(), 'minecraft:diamond').status, 'unknown');
});
test('post-loot additions inherit uncertain default source mappings and failed event acquisition', () => {
  for (const error of [undefined, 'Event codec failed']) {
    const s = worldFixture(table([item()]));
    s.world!.lootSources.push({ id: 'minecraft:stone', type: 'block', data: { lootTable: 'atlas:probe', resourceId: 'block:minecraft:stone', kind: 'block', ...(!error ? { defaultMappingOnly: true } : {}) }, ...(error ? { error } : {}) });
    s.world!.lootModifiers.push({ id: 'atlas:post', type: 'modifier', data: { type: 'craftatlas:add_item', item: 'minecraft:gold_ingot', count: 1 } });
    const m = normalize(s), post = m.processes.find(p => p.type === 'minecraft:loot-post')!;
    const scenario = lootScenario(); scenario.inventory['block:minecraft:stone'] = 1;
    assert.equal(post.interpretation, 'opaque'); assert.ok(post.unknown.length > 0);
    assert.equal(analyze(m, scenario, 'minecraft:gold_ingot').status, 'unknown');
  }
});
test('malformed fractional count clamps cannot corrupt fixed item yields', () => {
  for (const limit of [1.5, {}, { min: 3, max: 1 }] as Json[]) {
    const m = normalize(worldFixture(table([{ ...item(), functions: [{ function: 'minecraft:limit_count', limit }] }])));
    const p = m.processes.find(p => p.type === 'minecraft:loot')!;
    assert.equal(p.interpretation, 'opaque'); assert.equal(p.outputs[0].amount, 1); assert.equal(p.outputs[0].probability, null);
    assert.equal(analyze(m, lootScenario(), 'minecraft:diamond').status, 'unknown');
  }
});
test('both loader coverage contracts prevent proofs when post-loot hook acquisition is incomplete', () => {
  for (const [dataset, type] of [['lootModifiers', 'fabric'], ['loot', 'runtime global modifiers in application order']]) {
    const s = worldFixture(table([item()]));
    s.coverage.push({ dataset, type, status: 'unsupported', enumerated: null, interpreted: null, reasons: ['Hooks unavailable'] });
    s.world!.lootModifiers.push({ id: 'atlas:post', type: 'modifier', data: { type: 'craftatlas:add_item', item: 'minecraft:gold_ingot', count: 1 } });
    const m = normalize(s);
    assert.equal(analyze(m, lootScenario(), 'minecraft:diamond').status, 'unknown');
    assert.equal(analyze(m, lootScenario(), 'minecraft:gold_ingot').status, 'unknown');
  }
});
test('repeated finite observations ignore acquisition metadata and retain trial conditions and results', () => {
  const s = worldFixture(table([item()]));
  s.world!.observations = [{ id: 'sample', timestamp: 'first', capturedAt: 'first', createdAt: 'first', session: 'first', generation: 1, dayTime: 0, gameTime: 1, timeOfDay: 'day', weather: 'clear', player: 'minecraft:steve', seed: '42', generator: { type: 'minecraft:noise' }, chunks: [[0, 0]], context: { killedByPlayer: true }, totals: { 'minecraft:diamond': 2 }, environmentHash: 'first-environment' }];
  const before = normalize(s), repeated = structuredClone(s);
  Object.assign(repeated.world!.observations![0] as Record<string, Json>, { timestamp: 'second', capturedAt: 'second', createdAt: 'second', session: 'second', generation: 2 });
  const after = normalize(repeated);
  assert.equal(before.contentHash, after.contentHash); assert.deepEqual(diff(before, after).changes, []);
  assert.deepEqual(after.processes.find(p => p.type === 'minecraft:observation')!.raw, repeated.world!.observations![0]);
  const changes: Record<string, Json> = { dayTime: 1, gameTime: 2, timeOfDay: 'night', weather: 'rain', player: 'minecraft:alex', seed: '43', generator: { type: 'minecraft:flat' }, chunks: [[1, 0]], context: { killedByPlayer: false }, totals: { 'minecraft:diamond': 3 }, environmentHash: 'second-environment' };
  for (const [field, value] of Object.entries(changes)) {
    const changed = structuredClone(repeated); (changed.world!.observations![0] as Record<string, Json>)[field] = value;
    const model = normalize(changed);
    assert.notEqual(before.contentHash, model.contentHash, field);
    assert.ok(diff(before, model).changes.some(c => c.id === 'observation:sample'), field);
  }
});
