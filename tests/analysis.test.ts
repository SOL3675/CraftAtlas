import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../packages/core/src/analyze.ts';
import { audit } from '../packages/core/src/audit.ts';
import { diff } from '../packages/core/src/diff.ts';
import { localGraph } from '../packages/core/src/graph.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { fixture } from './helpers.ts';
import type { Alternative, Expectations, Model, Process, Scenario } from '../packages/core/src/types.ts';

const slot = (...alternatives: Alternative[]): Process['inputs'][number] => ({ alternatives, amount: 1, unit: 'item', consumption: 'consumed', evidence: ['ev'] });
function process(id: string, inputs: Process['inputs'], output: string, equipment: string[] = []): Process {
  return { id, sourceId: id, type: 'test:craft', inputs, outputs: [{ resource: output, amount: 1, unit: 'item', role: 'primary', probability: 1, evidence: ['ev'] }], requirements: equipment.map(id => ({ kind: 'equipment', id, evidence: ['ev'] })), evidence: ['ev'], interpretation: 'supported', execution: 'executable', enabled: true, costs: [], unknown: [], raw: {}, fieldEvidence: {}, conflicts: [] };
}
function model(processes: Process[], capabilities: string[] = []): Model {
  const ids = [...new Set(['a', 'b', 'c', 'd', 'goal', 'machine', ...processes.flatMap(p => [...p.outputs.map(o => o.resource), ...p.inputs.flatMap(i => i.alternatives.flatMap(a => a.resource ? [a.resource] : a.members ?? []))])])];
  return { schemaVersion: 1, snapshotId: 'before', session: 'session', generation: 0, normalizerVersion: 'test', environment: {}, mods: [], resources: ids.map(id => ({ id, kind: capabilities.includes(id) ? 'capability' : 'item', name: id, evidence: ['ev'] })), tags: {}, processes, evidence: [{ id: 'ev', kind: 'runtime', source: 'before', adapter: 'test', pointer: 'recipes' }], coverage: [{ dataset: 'recipes', type: '*', status: 'complete', enumerated: processes.length, interpreted: null, reasons: [] }, { dataset: 'normalization', type: 'test:craft', status: 'complete', enumerated: processes.length, interpreted: processes.length, reasons: [] }], diagnostics: [], contentHash: 'test' };
}
function scenario(): Scenario { return { schemaVersion: 1, id: 'start', inventory: { a: 1 }, equipment: [], stages: [], dimensions: [], forbiddenProcesses: [], allowedTypes: null, supply: 'renewable', closed: true, closedResources: ['a', 'b', 'c', 'd', 'goal', 'machine'], gameRules: {} }; }
const expectations = (): Expectations => ({ schemaVersion: 1, recipes: [], nonemptyTags: [], supportedTypes: [], reachable: [], unreachable: [] });

test('AND slots, OR alternatives and a proven path retain evidence', () => {
  const m = model([process('first', [slot({ resource: 'a' }, { resource: 'b' })], 'c'), process('last', [slot({ resource: 'c' }), slot({ resource: 'd' })], 'goal')]);
  const s = scenario(); const blocked = analyze(m, s, 'goal'); assert.equal(blocked.status, 'unreachable'); assert.deepEqual(blocked.evidence, ['ev']); assert.ok(blocked.stopReasons.every(r => r.evidence.includes('ev')));
  s.inventory.d = 1;
  const result = analyze(m, s, 'goal'); assert.equal(result.status, 'reachable'); assert.deepEqual(result.path, ['a', 'first', 'c', 'd', 'last', 'goal']); assert.deepEqual(result.evidence, ['ev']);
  assert.equal(result.path.includes('b'), false);
});
test('equipment installation is an AND prerequisite and ordinary machine items do not prove it', () => {
  const m = model([process('last', [slot({ resource: 'a' })], 'goal', ['machine'])]); const s = scenario(); s.inventory.machine = 1;
  assert.equal(analyze(m, s, 'goal').status, 'unreachable'); s.equipment.push('machine'); assert.equal(analyze(m, s, 'goal').status, 'reachable');
  const construction = process('build', [slot({ resource: 'a' })], 'machine'); m.processes.push(construction); s.equipment = []; m.resources.find(r => r.id === 'machine')!.kind = 'capability';
  assert.equal(analyze(m, s, 'goal').status, 'reachable');
});
test('finite stock has qualitative witnesses but cannot prove a feasible consumption schedule', () => {
  const m = model([process('one', [slot({ resource: 'a' })], 'b'), process('two', [slot({ resource: 'a' })], 'c'), process('last', [slot({ resource: 'b' }), slot({ resource: 'c' })], 'goal')]);
  const s = scenario(); s.supply = 'finite'; const result = analyze(m, s, 'goal'); assert.equal(result.status, 'unknown'); assert.ok(result.path.length); assert.match(result.unknown.join(), /Finite inventory/);
  assert.equal(analyze(m, s, 'a').status, 'reachable');
});
test('uninterpreted ingredients, execution, output probabilities, stages and filters are distinct', () => {
  const p = process('last', [slot({ resource: 'a', predicate: { custom: true } })], 'goal'), m = model([p]), s = scenario();
  assert.equal(analyze(m, s, 'goal').status, 'unknown'); p.inputs = [slot({ resource: 'a', components: { damage: 0 } })]; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  p.inputs = [slot({ resource: 'a' })]; p.execution = 'display'; assert.equal(analyze(m, s, 'goal').status, 'unreachable'); p.execution = 'unconfirmed'; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  p.execution = 'executable'; p.outputs[0]!.probability = 0; assert.equal(analyze(m, s, 'goal').status, 'unreachable'); p.outputs[0]!.probability = null; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  p.outputs[0]!.probability = 0.05; assert.equal(analyze(m, s, 'goal').status, 'reachable'); p.requirements.push({ kind: 'stage', id: 'research', evidence: ['ev'] }); assert.equal(analyze(m, s, 'goal').status, 'unreachable'); s.stages.push('research'); assert.equal(analyze(m, s, 'goal').status, 'reachable');
  s.forbiddenProcesses = ['last']; assert.equal(analyze(m, s, 'goal').status, 'unreachable'); s.forbiddenProcesses = []; s.allowedTypes = []; assert.equal(analyze(m, s, 'goal').status, 'unreachable');
});
test('unknown acquisition and incomplete coverage never become unreachable', () => {
  const m = model([process('last', [slot({ resource: 'b' })], 'goal')]), s = scenario();
  assert.equal(analyze(m, s, 'goal').status, 'unreachable'); s.closed = false; assert.equal(analyze(m, s, 'goal').status, 'unknown'); s.closed = true; s.closedResources = ['goal']; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  s.closedResources.push('b'); m.coverage.push({ dataset: 'loot', type: '*', status: 'unsupported', enumerated: null, interpreted: null, reasons: ['No collector'] }); assert.equal(analyze(m, s, 'goal').status, 'unknown');
  m.coverage = []; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  m.coverage = [{ dataset: 'recipes', type: '*', status: 'complete', enumerated: 1, interpreted: null, reasons: [] }]; m.processes[0]!.interpretation = 'opaque'; m.processes[0]!.outputs = []; assert.equal(analyze(m, s, 'goal').status, 'unknown');
});
test('equipment cycles are candidates; initial or external supply breaks warnings', () => {
  const m = model([process('parts', [slot({ resource: 'a' })], 'b', ['machine']), process('build', [slot({ resource: 'b' })], 'machine'), process('last', [slot({ resource: 'b' })], 'goal')], ['machine']), s = scenario();
  const result = analyze(m, s, 'goal'); assert.equal(result.status, 'unreachable'); assert.equal(result.diagnostics.filter(d => d.rule === 'equipment-cycle-candidate').length, 1);
  s.equipment = ['machine']; assert.equal(analyze(m, s, 'goal').status, 'reachable'); assert.equal(analyze(m, s, 'goal').diagnostics.filter(d => d.rule === 'equipment-cycle-candidate').length, 0);
  s.equipment = []; m.processes.push(process('external', [], 'machine')); assert.equal(analyze(m, s, 'goal').status, 'reachable'); assert.equal(analyze(m, s, 'goal').diagnostics.filter(d => d.rule === 'equipment-cycle-candidate').length, 0);
});
test('audit evaluates required recipes, tags, support and expectation unknowns honestly', () => {
  const m = model([process('last', [slot({ resource: 'a' })], 'goal')]), e = expectations(); e.recipes = ['missing']; e.nonemptyTags = ['empty']; m.tags.empty = [];
  let ds = audit(m, e); assert.ok(ds.some(d => d.rule === 'required-recipe' && d.status === 'confirmed')); assert.ok(ds.some(d => d.rule === 'required-tag' && d.status === 'confirmed'));
  m.coverage[0]!.status = 'partial'; ds = audit(m, e); assert.ok(ds.some(d => d.rule === 'required-recipe' && d.status === 'unknown'));
  m.coverage.push({ dataset: 'recipes', type: 'other', status: 'complete', enumerated: 1, interpreted: null, reasons: [] }); assert.ok(audit(m, e).some(d => d.rule === 'required-recipe' && d.status === 'unknown'));
  e.recipes = []; e.nonemptyTags = []; e.reachable = ['goal']; assert.ok(audit(m, e).some(d => d.status === 'unknown' && d.rule === 'required-reachability'));
  e.supportedTypes = ['not-collected']; assert.ok(audit(m, e, scenario()).some(d => d.rule === 'required-supported-type' && d.status === 'unknown'));
  e.unreachable = ['goal']; assert.ok(audit(m, e, scenario()).some(d => d.rule === 'expected-reachability' && d.status === 'confirmed'));
});
test('required supported types include operational gates and incomplete fields; optional unknown time does not block qualitative reach', () => {
  const p = process('last', [slot({ resource: 'a' })], 'goal', ['machine']), m = model([p]), s = scenario(), e = expectations();
  s.equipment = ['machine']; e.supportedTypes = ['test:craft']; assert.equal(audit(m, e, s).some(d => d.rule === 'required-supported-type'), false);
  p.requirements.push({ kind: 'opaque', id: 'Power supply and configured demand', evidence: ['ev'] });
  assert.equal(analyze(m, s, 'goal').status, 'unknown'); const operational = audit(m, e, s).find(d => d.rule === 'required-supported-type')!; assert.equal(operational.status, 'unknown'); assert.ok(operational.unknown.some(u => u.includes('Power supply')));
  p.requirements.pop(); p.costs.push({ kind: 'time', amount: null, unit: 'tick', basis: 'unmeasured' });
  assert.equal(analyze(m, s, 'goal').status, 'reachable'); assert.ok(audit(m, e, s).some(d => d.rule === 'required-supported-type' && d.unknown.some(u => u.includes('Unacquired time'))));
  p.costs = []; p.execution = 'unconfirmed'; assert.ok(audit(m, e, s).some(d => d.rule === 'required-supported-type')); p.execution = 'executable'; p.outputs[0]!.probability = null; assert.ok(audit(m, e, s).some(d => d.rule === 'required-supported-type'));
  p.outputs[0]!.probability = 1; p.inputs[0]!.alternatives[0]!.components = { damage: 0 }; assert.ok(audit(m, e, s).some(d => d.rule === 'required-supported-type'));
});
test('unknown linked constraints cannot become independent OR proofs or fully supported types', () => {
  const p = process('last', [slot({ resource: 'a' }, { resource: 'b' })], 'goal'), m = model([p]), s = scenario(), e = expectations();
  p.constraints = { kind: 'correlated-alternatives', validCombinations: [] }; e.supportedTypes = ['test:craft'];
  const result = analyze(m, s, 'goal'); assert.equal(result.status, 'unknown'); assert.ok(result.stopReasons.some(r => r.kind === 'constraints')); assert.ok(audit(m, e, s).some(d => d.rule === 'required-supported-type' && d.status === 'unknown'));
  p.type = 'minecraft:crafting_shaped'; p.constraints = { kind: 'shaped-grid', layout: [[0]] }; assert.equal(analyze(m, s, 'goal').status, 'reachable');
  p.constraints = { kind: 'shaped-grid', layout: [[0, 0]] }; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  p.constraints = { kind: 'shaped-grid', layout: [[0]], linkedPredicate: true }; assert.equal(analyze(m, s, 'goal').status, 'unknown');
  const snapshot = fixture(); snapshot.recipes = [{ id: 'atlas:shape', type: 'minecraft:crafting_shaped', data: { pattern: ['X ', ' X'], key: { X: { item: 'minecraft:dirt' } }, result: { id: 'minecraft:diamond' } } }];
  const generated = normalize(snapshot); s.inventory = { 'minecraft:dirt': 2 }; assert.equal(analyze(generated, s, 'minecraft:diamond').status, 'reachable');
});
test('viewer source IDs do not satisfy required runtime recipe IDs', () => {
  const snapshot = fixture(), p = normalize(snapshot).processes.find(p => p.id === 'atlas:diamond')!;
  snapshot.viewer = { session: snapshot.session, generation: snapshot.generation, context: {}, coverage: [], recipes: [{ id: 'required:removed', recipeId: null, category: 'viewer:display', inputs: p.inputs, outputs: p.outputs, equipment: [], execution: 'display', unknown: [], raw: {} }] };
  const e = expectations(); e.recipes = ['required:removed']; const m = normalize(snapshot);
  assert.ok(audit(m, e).some(d => d.rule === 'required-recipe' && d.target === 'required:removed' && d.status === 'confirmed'));
  e.recipes = ['atlas:diamond']; assert.equal(audit(m, e).some(d => d.rule === 'required-recipe'), false);
});
test('meaningful diff ignores acquisition metadata and follows old and new outputs downstream with a cap', () => {
  const before = model([process('first', [slot({ resource: 'a' })], 'b'), process('use-b', [slot({ resource: 'b' })], 'goal'), process('use-c', [slot({ resource: 'c' })], 'd')]), after = structuredClone(before);
  after.snapshotId = 'after'; after.session = 'later'; after.generation = 10; after.processes[0]!.sourceId = 'new-source'; after.processes[0]!.evidence = []; after.processes[0]!.raw = { irrelevant: 'new' };
  assert.equal(diff(before, after).changes.length, 0);
  after.processes[0]!.outputs[0]!.resource = 'c'; after.processes[0]!.outputs[0]!.amount = 2;
  const result = diff(before, after); assert.deepEqual(result.changes[0]!.fields, ['outputs']); assert.deepEqual(result.impact.processes, ['first', 'use-b', 'use-c']); assert.ok(result.impact.resources.includes('goal')); assert.ok(result.impact.resources.includes('d')); assert.equal(diff(before, after, { limit: 2 }).impact.truncated, true);
  after.normalizerVersion = 'new'; after.environment = { scriptHash: 'new' }; assert.equal(diff(before, after).provenance.normalizerChanged, true); assert.equal(diff(before, after).provenance.environmentChanged, true);
});
test('local graph preserves slot AND / alternative OR and display filters leave analysis unchanged', () => {
  const m = model([process('last', [slot({ resource: 'a' }, { resource: 'b' }), slot({ resource: 'd' })], 'goal')]); const s = scenario(); s.inventory.d = 1;
  const graph = localGraph(m, 'goal'); const inputs = graph.edges.filter(e => e.role === 'input'); assert.deepEqual(inputs.map(e => [e.slot, e.alternative]), [[0, 0], [0, 1], [1, 0]]);
  assert.equal(localGraph(m, 'goal', { types: [] }).nodes.length, 1); assert.equal(analyze(m, s, 'goal').status, 'reachable'); assert.equal(localGraph(m, 'goal', { limit: 2 }).truncated, true);
  const rooted = localGraph(m, 'last'); assert.equal(rooted.nodes[0]!.kind, 'process'); assert.equal(rooted.nodes.some(n => n.id === 'resource:last'), false); assert.ok(rooted.edges.some(e => e.role === 'input'));
});
test('diff impact follows produced stage and dimension gates without treating context IDs as resources', () => {
  const research = process('research', [slot({ resource: 'a' })], 'b'), travel = process('travel', [], 'c'), last = process('last', [], 'goal');
  travel.requirements = [{ kind: 'stage', id: 'b', evidence: ['ev'] }]; last.requirements = [{ kind: 'dimension', id: 'c', evidence: ['ev'] }];
  const context = process('context-only', [], 'd'); context.requirements = [{ kind: 'context', id: 'b', predicate: true, evidence: ['ev'] }];
  const before = model([research, travel, last, context]); before.resources.find(r => r.id === 'b')!.kind = 'stage'; before.resources.find(r => r.id === 'c')!.kind = 'dimension';
  const after = structuredClone(before); after.processes[0]!.enabled = false;
  const impact = diff(before, after).impact;
  assert.deepEqual(impact.processes, ['last', 'research', 'travel']); assert.deepEqual(impact.resources, ['b', 'c', 'goal']);
  assert.equal(diff(before, after, { limit: 3 }).impact.truncated, true);
});
test('local graph follows stage and dimension unlocks and shows distinct context and opaque predicates', () => {
  const research = process('research', [slot({ resource: 'a' })], 'b'), travel = process('travel', [], 'c'), last = process('last', [], 'goal');
  travel.requirements = [{ kind: 'stage', id: 'b', evidence: ['ev'] }];
  last.requirements = [{ kind: 'dimension', id: 'c', evidence: ['ev'] }, { kind: 'context', id: 'raining', predicate: false, evidence: ['ev'] }, { kind: 'opaque', id: 'linked-circle', predicate: { pattern: ['symbol', 'rune'] }, evidence: ['ev'] }];
  const m = model([research, travel, last]); m.resources.find(r => r.id === 'b')!.kind = 'stage'; m.resources.find(r => r.id === 'c')!.kind = 'dimension';
  const before = structuredClone(m), s = scenario(), analysis = analyze(m, s, 'goal');
  const graph = localGraph(m, 'goal', { depth: 3, direction: 'sources' });
  assert.ok(graph.nodes.some(n => n.id === 'process:research')); assert.ok(graph.nodes.some(n => n.id === 'process:travel'));
  assert.ok(graph.edges.some(e => e.role === 'stage' && e.source === 'resource:b' && e.target === 'process:travel'));
  assert.ok(graph.edges.some(e => e.role === 'dimension' && e.source === 'resource:c' && e.target === 'process:last'));
  const context = graph.nodes.find(n => n.condition?.kind === 'context')!, opaque = graph.nodes.find(n => n.condition?.kind === 'opaque')!;
  assert.equal(context.kind, 'predicate'); assert.match(context.label, /raining = false/); assert.deepEqual(context.condition, last.requirements[1]); assert.ok(context.evidence.includes('ev'));
  assert.equal(opaque.kind, 'predicate'); assert.match(opaque.unknown.join(), /no interpreter/); assert.deepEqual(opaque.condition, last.requirements[2]);
  assert.equal(graph.nodes.some(n => n.id === 'resource:raining' || n.id === 'resource:linked-circle'), false);
  assert.ok(graph.edges.some(e => e.role === 'context')); assert.ok(graph.edges.some(e => e.role === 'opaque'));
  assert.ok(localGraph(m, 'b', { direction: 'uses', depth: 1 }).nodes.some(n => n.id === 'process:travel'));
  assert.equal(localGraph(m, 'goal', { depth: 1, limit: 2 }).truncated, true);
  assert.deepEqual(m, before); assert.deepEqual(analyze(m, s, 'goal'), analysis);
});
