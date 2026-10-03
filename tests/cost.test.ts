import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculateCost } from '../packages/core/src/cost.ts';
import type { Alternative, CostRequest, Model, Process, Scenario } from '../packages/core/src/types.ts';

function slot(id: string, amount = 1, consumption: 'consumed' | 'catalyst' | 'durability' = 'consumed', unit = 'item'): Process['inputs'][number] { return { alternatives: [{ resource: id }], amount, consumption, unit, evidence: ['ev'] }; }
function process(id: string, inputs: Process['inputs'], output: string, amount = 1, unit = 'item'): Process {
  return { id, sourceId: id, type: 'fixture:craft', inputs, outputs: [{ resource: output, amount, unit, role: 'primary', probability: 1, evidence: ['ev'] }], requirements: [], evidence: ['ev'], interpretation: 'supported', execution: 'executable', enabled: true, unknown: [], raw: {}, fieldEvidence: {}, conflicts: [], costs: [] };
}
function model(ps: Process[], kinds: Record<string, string> = {}): Model {
  const ids = [...new Set(ps.flatMap(p => [...p.outputs.map(o => o.resource), ...p.inputs.flatMap(i => i.alternatives.flatMap(a => a.resource ? [a.resource] : a.members ?? []))]))];
  return { schemaVersion: 1, snapshotId: 'cost-fixture', session: 'offline', generation: 0, normalizerVersion: 'test', environment: {}, mods: [], resources: ids.map(id => ({ id, kind: kinds[id] ?? 'item', name: id, evidence: ['ev'] })), tags: {}, processes: ps, evidence: [{ id: 'ev', kind: 'runtime', source: 'fixture', adapter: 'fixture', pointer: 'recipes' }], coverage: [], diagnostics: [], contentHash: 'fixture' };
}
function scenario(inventory: Scenario['inventory'] = {}): Scenario { return { schemaVersion: 1, id: 'cost-start', inventory, equipment: [], stages: [], dimensions: [], forbiddenProcesses: [], allowedTypes: null, supply: 'finite', closed: false, closedResources: [], gameRules: {} }; }
function request(target = 'goal', amount = 1, routes: CostRequest['routes'] = {}): CostRequest { return { schemaVersion: 1, id: 'selected-plan', target: { resource: target, amount, unit: 'item' }, routes, selections: {}, mode: 'deterministic', probabilityModels: {}, durability: {} }; }
const route = (process: string, output = 0) => ({ process, output });

test('selected OR inputs retain AND quantities, integer batches and the evidence behind costs', () => {
  const p = process('craft', [slot('a', 3), slot('c')], 'goal', 2); p.inputs[0]!.alternatives.push({ resource: 'b' }); p.costs = [{ kind: 'time', amount: 4, unit: 'tick', basis: 'runtime' }, { kind: 'energy', amount: 2, unit: 'J', basis: 'runtime' }];
  const m = model([p]), r = request('goal', 5, { goal: route('craft') }), s = scenario({ a: 9, b: 9, c: 3 });
  assert.equal(calculateCost(m, r, s).status, 'unknown'); r.selections.craft = { '0': 'a' };
  const cost = calculateCost(m, r, s); assert.equal(cost.status, 'complete'); assert.equal(cost.steps[0]!.batches, 3); assert.deepEqual(cost.materials.recurring.map(m => [m.resource, m.amount]), [['a', 9], ['c', 3]]);
  assert.equal(cost.costs.total.find(c => c.kind === 'time')!.amount, 12); assert.equal(cost.costs.total.find(c => c.kind === 'energy')!.amount, 6); assert.equal(cost.outputs[0]!.amount, 6); assert.deepEqual(cost.evidence, ['ev']);
  r.selections.craft!['0'] = 'outside'; assert.equal(calculateCost(m, r, s).status, 'invalid');
});
test('batch surplus and deterministic byproducts supply later selected dependencies', () => {
  const make = process('make', [slot('ore', 3)], 'b', 2), next = process('next', [slot('b')], 'd'), end = process('end', [slot('b'), slot('d')], 'goal');
  const r = request('goal', 1, { goal: route('end'), b: route('make'), d: route('next') }), cost = calculateCost(model([make, next, end]), r, scenario({ ore: 3 }));
  assert.equal(cost.status, 'complete'); assert.deepEqual(cost.steps.map(s => [s.process, s.batches]), [['make', 1], ['next', 1], ['end', 1]]); assert.equal(cost.materials.recurring.find(m => m.resource === 'ore')!.amount, 3);
  make.outputs.push({ resource: 'd', amount: 1, unit: 'item', role: 'byproduct', probability: 1, evidence: ['ev'] }); const reuse = calculateCost(model([make, next, end]), r, scenario({ ore: 3 })); assert.equal(reuse.steps.some(s => s.process === 'next'), false);
});
test('returned containers require an initial seed and are reused rather than subtracted from unrelated ingredients', () => {
  const p = process('pour', [slot('container'), slot('ore')], 'goal'); p.outputs.push({ resource: 'container', amount: 1, unit: 'item', role: 'returned', probability: 1, evidence: ['ev'] });
  const r = request('goal', 3, { goal: route('pour') }), m = model([p]), cost = calculateCost(m, r, scenario({ container: 1, ore: 3 }));
  assert.equal(cost.status, 'complete'); assert.equal(cost.materials.recurring.find(m => m.resource === 'container')!.amount, 1); assert.equal(cost.outputs.find(o => o.role === 'returned')!.reused, 2);
  assert.equal(calculateCost(m, r, scenario({ ore: 3 })).status, 'unknown');
  p.outputs[1]!.resource = 'different-container'; assert.equal(calculateCost(model([p]), r, scenario({ container: 1, ore: 3 })).status, 'unknown');
});
test('catalysts are reserved once and durability consumes wear with actual tool replacement counts', () => {
  const p = process('use', [slot('ore'), slot('focus', 1, 'catalyst'), slot('pick', 2, 'durability', 'durability')], 'goal'), r = request('goal', 5, { goal: route('use') }), m = model([p]);
  r.durability.pick = { remaining: 3, lifetime: 4 }; const cost = calculateCost(m, r, scenario({ ore: 5, focus: 1, pick: 3 }));
  assert.equal(cost.status, 'complete'); assert.equal(cost.materials.recurring.find(m => m.resource === 'focus')!.amount, 1); assert.equal(cost.materials.recurring.find(m => m.resource === 'pick')!.amount, 3);
  assert.equal(cost.durability[0]!.wear, 10); assert.equal(cost.durability[0]!.toolsRequired, 3); assert.equal(cost.durability[0]!.replacementTools, 2); assert.equal(cost.durability[0]!.remaining, 1);
  r.durability = {}; assert.equal(calculateCost(m, r, scenario({ ore: 5, focus: 1, pick: 3 })).status, 'unknown');
});
test('returned catalysts and tools remain the same physical items rather than newly produced stock', () => {
  const use = process('use', [slot('ore'), slot('focus', 1, 'catalyst')], 'middle'); use.outputs.push({ resource: 'focus', amount: 1, unit: 'item', role: 'returned', probability: 1, evidence: ['ev'] });
  const end = process('end', [slot('middle', 3), slot('focus', 2)], 'goal'), r = request('goal', 1, { goal: route('end'), middle: route('use') });
  const cost = calculateCost(model([use, end]), r, scenario({ ore: 3, focus: 1 })); assert.equal(cost.status, 'unknown'); assert.ok(cost.diagnostics.some(d => d.rule === 'cost-supply' && d.target === 'focus')); assert.equal(cost.outputs.find(o => o.role === 'returned')!.reused, 3);
});
test('equipment assembly is charged once as setup, independently of repeated processing', () => {
  const build = process('build', [slot('iron', 4)], 'installed-machine', 1, 'capability'); build.costs = [{ kind: 'time', amount: 10, unit: 'tick', basis: 'fixture' }];
  const p = process('use', [slot('ore')], 'goal', 2); p.requirements = [{ kind: 'equipment', id: 'installed-machine', evidence: ['ev'] }]; p.costs = [{ kind: 'time', amount: 4, unit: 'tick', basis: 'fixture' }];
  const m = model([build, p], { 'installed-machine': 'capability' }), r = request('goal', 5, { goal: route('use'), 'installed-machine': route('build') }), s = scenario({ iron: 4, ore: 3 });
  const cost = calculateCost(m, r, s); assert.equal(cost.status, 'complete'); assert.equal(cost.materials.setup[0]!.amount, 4); assert.equal(cost.materials.recurring[0]!.amount, 3); assert.equal(cost.costs.setup[0]!.amount, 10); assert.equal(cost.costs.recurring[0]!.amount, 12); assert.equal(cost.costs.total[0]!.amount, 22);
  s.equipment = ['installed-machine']; const ready = calculateCost(m, r, s); assert.equal(ready.status, 'complete'); assert.deepEqual(ready.materials.setup, []); assert.equal(ready.steps.some(s => s.process === 'build'), false);
  s.equipment = []; m.resources.find(r => r.id === 'installed-machine')!.kind = 'item'; assert.equal(calculateCost(m, r, s).status, 'unknown');
});
test('unknown costs retain known subtotals and mixed units are never merged into one number', () => {
  const a = process('a', [slot('ore')], 'middle'); a.costs = [{ kind: 'time', amount: 3, unit: 'tick', basis: 'known' }, { kind: 'energy', amount: 4, unit: 'J', basis: 'known' }];
  const b = process('b', [slot('middle')], 'goal'); b.costs = [{ kind: 'time', amount: null, unit: 'tick', basis: 'unmeasured' }, { kind: 'energy', amount: 5, unit: 'FE', basis: 'known' }];
  const cost = calculateCost(model([a, b]), request('goal', 1, { goal: route('b'), middle: route('a') }), scenario({ ore: 1 }));
  assert.equal(cost.status, 'unknown'); assert.equal(cost.costs.total.find(c => c.kind === 'time')!.amount, null); assert.equal(cost.costs.total.find(c => c.kind === 'time')!.knownSubtotal, 3); assert.deepEqual(cost.costs.total.filter(c => c.kind === 'energy').map(c => c.unit).sort(), ['FE', 'J']);
});
test('explicit IID model gives negative binomial expected trials, variance and independent byproduct yields', () => {
  const p = process('random', [slot('ore')], 'goal', 2); p.outputs[0]!.probability = 0.25; p.outputs.push({ resource: 'bonus', amount: 4, unit: 'item', role: 'byproduct', probability: 0.5, evidence: ['ev'] }); p.costs = [{ kind: 'time', amount: 2, unit: 'tick', basis: 'known' }];
  const r = request('goal', 5, { goal: route('random') }), s = scenario({ ore: 1 }); s.supply = 'renewable';
  assert.equal(calculateCost(model([p]), r, s).status, 'unknown'); r.mode = 'expectation'; r.probabilityModels.random = { kind: 'iid-bernoulli', independentOutputs: true };
  const cost = calculateCost(model([p]), r, s); assert.equal(cost.status, 'complete'); assert.equal(cost.steps[0]!.batches, 12); assert.equal(cost.steps[0]!.batchVariance, 36); assert.equal(cost.materials.recurring[0]!.amount, 12); assert.equal(cost.costs.total[0]!.amount, 24); assert.equal(cost.outputs.find(o => o.resource === 'bonus')!.amount, 24);
  r.probabilityModels.random.independentOutputs = false; const dependent = calculateCost(model([p]), r, s); assert.equal(dependent.status, 'unknown'); assert.equal(dependent.outputs.find(o => o.resource === 'bonus')!.amount, null);
  p.outputs[0]!.probability = 0; assert.equal(calculateCost(model([p]), r, s).status, 'invalid'); p.outputs[0]!.probability = null; assert.equal(calculateCost(model([p]), r, s).status, 'unknown');
});
test('mean-only upstream rounding and finite stock are not falsely advertised as exact expectations', () => {
  const upstream = process('batch', [slot('ore')], 'dust', 4); upstream.costs = [{ kind: 'time', amount: 2, unit: 'tick', basis: 'known' }];
  const root = process('random', [slot('dust', 3)], 'goal'); root.outputs[0]!.probability = 0.5;
  const r = request('goal', 1, { goal: route('random'), dust: route('batch') }); r.mode = 'expectation'; r.probabilityModels.random = { kind: 'iid-bernoulli', independentOutputs: true }; const s = scenario({ ore: 1 }); s.supply = 'renewable';
  const cost = calculateCost(model([upstream, root]), r, s); assert.equal(cost.status, 'unknown'); assert.equal(cost.steps.find(s => s.process === 'batch')!.batchBasis, 'mean-flow'); assert.equal(cost.costs.total[0]!.amount, null); assert.ok(cost.diagnostics.some(d => d.rule === 'cost-batch-distribution'));
  upstream.outputs[0]!.amount = 3; const exact = calculateCost(model([upstream, root]), r, s); assert.equal(exact.status, 'complete'); assert.equal(exact.steps.find(s => s.process === 'batch')!.batches, 2); assert.equal(exact.costs.total[0]!.amount, 4);
  s.supply = 'finite'; s.inventory.ore = 100; assert.equal(calculateCost(model([upstream, root]), r, s).status, 'unknown');
});
test('stochastic byproducts are displayed but cannot silently supply another selected dependency', () => {
  const p = process('random', [slot('ore')], 'a'); p.outputs[0]!.probability = 0.5; p.outputs.push({ resource: 'b', amount: 1, unit: 'item', role: 'byproduct', probability: 0.5, evidence: ['ev'] });
  const end = process('end', [slot('a'), slot('b')], 'goal'), r = request('goal', 1, { goal: route('end'), a: route('random') }); r.mode = 'expectation'; r.probabilityModels.random = { kind: 'iid-bernoulli', independentOutputs: true }; const s = scenario({ ore: 1 }); s.supply = 'renewable';
  const cost = calculateCost(model([p, end]), r, s); assert.equal(cost.outputs.find(o => o.resource === 'b')!.amount, 1); assert.equal(cost.status, 'unknown'); assert.ok(cost.diagnostics.some(d => d.rule === 'cost-supply' && d.target === 'b'));
});
test('deterministic returned seeds are reused across the modeled until-success trials', () => {
  const p = process('trial', [slot('container'), slot('ore')], 'goal'); p.outputs[0]!.probability = 0.5; p.outputs.push({ resource: 'container', amount: 1, unit: 'item', role: 'returned', probability: 1, evidence: ['ev'] });
  const r = request('goal', 3, { goal: route('trial') }); r.mode = 'expectation'; r.probabilityModels.trial = { kind: 'iid-bernoulli', independentOutputs: false }; const s = scenario({ container: 1, ore: 1 }); s.supply = 'renewable';
  const cost = calculateCost(model([p]), r, s); assert.equal(cost.status, 'complete'); assert.equal(cost.materials.recurring.find(m => m.resource === 'container')!.amount, 1); assert.equal(cost.materials.recurring.find(m => m.resource === 'ore')!.amount, 6); assert.equal(cost.outputs.find(o => o.role === 'returned')!.reused, 5);
});
test('cycles, scenario forbidden methods, unit mismatches and computation bounds cannot produce a successful bill', () => {
  const a = process('a', [slot('b')], 'goal'), b = process('b', [slot('goal')], 'b'), m = model([a, b]), r = request('goal', 1, { goal: route('a'), b: route('b') }), s = scenario();
  assert.equal(calculateCost(m, r, s).status, 'invalid'); s.forbiddenProcesses = ['a']; assert.equal(calculateCost(m, r, s).status, 'invalid'); s.forbiddenProcesses = []; r.target.unit = 'mB'; assert.equal(calculateCost(m, r, s).status, 'invalid'); r.target.unit = 'item'; r.target.amount = 1e12 + 1; assert.throws(() => calculateCost(m, r, s), /cost-request/);
  const large = process('large', [slot('ore', 1e12)], 'goal'); const capped = calculateCost(model([large]), request('goal', 2, { goal: route('large') }), scenario({ ore: 1 })); assert.equal(capped.status, 'unknown'); assert.ok(capped.diagnostics.some(d => d.rule === 'cost-limit'));
  const chain = Array.from({ length: 110 }, (_, index) => process(`process-${index}`, [slot(`resource-${index + 1}`)], `resource-${index}`)); const deep = request('resource-0', 1, Object.fromEntries(chain.map((p, index) => [`resource-${index}`, route(p.id)])));
  const stopped = calculateCost(model(chain), deep, scenario({ 'resource-110': 1 })); assert.equal(stopped.status, 'unknown'); assert.ok(stopped.diagnostics.some(d => d.rule === 'cost-limit'));
});
test('missing and false contexts remain separate from valid modeled progress gates', () => {
  const p = process('contextual', [slot('ore')], 'goal'); p.requirements = [{ kind: 'context', id: 'tool', predicate: 'silk', evidence: ['ev'] }]; const m = model([p]), r = request('goal', 1, { goal: route('contextual') }), s = scenario({ ore: 1 });
  assert.equal(calculateCost(m, r, s).status, 'unknown'); s.gameRules = { lootContext: { tool: 'plain' } }; assert.equal(calculateCost(m, r, s).status, 'invalid'); s.gameRules = { lootContext: { tool: 'silk' } }; assert.equal(calculateCost(m, r, s).status, 'complete');
});
