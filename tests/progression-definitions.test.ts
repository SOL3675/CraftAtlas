import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalize } from '../packages/core/src/normalize.ts';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { calculateCost } from '../packages/core/src/cost.ts';
import type { CostRequest, DefinitionPack, Scenario, Snapshot } from '../packages/core/src/types.ts';

function fixtures() {
  const read = <T>(path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as T;
  const snapshot = read<Snapshot>('../fixtures/definition-progression-snapshot.json'), pack = read<DefinitionPack>('../definitions/fixture-progression.json');
  return { snapshot, pack, scenario: read<Scenario>('../fixtures/definition-progression-scenario.json'), request: read<CostRequest>('../fixtures/definition-progression-cost-request.json'), model: applyDefinitions(normalize(snapshot), [pack], { minecraft: snapshot.minecraft, loader: snapshot.loader }) };
}
test('version-scoped multiblock, magic circle, stage and dimension unlock precede repeatable summoning', () => {
  const { model, scenario } = fixtures(), result = analyze(model, scenario, 'atlas_fixture:gem');
  assert.equal(result.status, 'reachable'); for (const id of ['build_gate_frame', 'draw_circle', 'research_gate', 'open_realm', 'summon_wisp', 'harvest_wisp']) assert.ok(result.path.includes(`atlas_fixture:${id}`), id);
  const summoned = model.processes.find(p => p.id === 'atlas_fixture:summon_wisp')!;
  assert.equal(summoned.inputs.some(i => i.alternatives.some(a => a.resource === 'atlas_fixture:chalk' || a.resource === 'atlas_fixture:stone')), false);
  assert.ok(summoned.requirements.some(r => r.kind === 'dimension' && r.id === 'atlas_fixture:realm')); assert.ok(result.evidence.some(e => e.startsWith('definition:atlas-fixture-progression@2.0.0')));
});
test('registration and existing materials do not prove structure, summoning context or unlocked access', () => {
  const { model, scenario } = fixtures(); scenario.gameRules = {}; assert.equal(analyze(model, scenario, 'atlas_fixture:gem').status, 'unknown');
  scenario.gameRules = { lootContext: { gate_multiblock_valid: false, circle_drawing_valid: true, summoning_context_valid: true, harvest_context_valid: true } }; assert.equal(analyze(model, scenario, 'atlas_fixture:gem').status, 'unknown');
  scenario.forbiddenProcesses = ['atlas_fixture:open_realm']; assert.equal(analyze(model, scenario, 'atlas_fixture:gem').status, 'unknown');
  scenario.dimensions.push('atlas_fixture:realm'); scenario.stages.push('atlas_fixture:gate_researched'); assert.equal(analyze(model, scenario, 'atlas_fixture:gem').status, 'reachable');
});
test('explicit cost plan separates one-time structures/unlocks from expected summoning and drops', () => {
  const { model, scenario, request } = fixtures(), cost = calculateCost(model, request, scenario);
  assert.equal(cost.status, 'complete', JSON.stringify(cost.diagnostics)); assert.equal(cost.steps.find(s => s.process === 'atlas_fixture:harvest_wisp')!.batches, 4); assert.equal(cost.steps.find(s => s.process === 'atlas_fixture:harvest_wisp')!.batchVariance, 12);
  assert.equal(cost.steps.find(s => s.process === 'atlas_fixture:draw_circle')!.phase, 'setup'); assert.equal(cost.steps.find(s => s.process === 'atlas_fixture:draw_circle')!.batches, 1); assert.equal(cost.steps.find(s => s.process === 'atlas_fixture:summon_wisp')!.phase, 'recurring');
  assert.equal(cost.materials.setup.find(m => m.resource === 'atlas_fixture:stone')!.amount, 12); assert.equal(cost.materials.recurring.find(m => m.resource === 'atlas_fixture:reagent')!.amount, 12);
  assert.equal(cost.costs.setup.find(c => c.kind === 'time')!.amount, 75); assert.equal(cost.costs.recurring.find(c => c.kind === 'time')!.amount, 48); assert.equal(cost.costs.total.find(c => c.kind === 'energy')!.amount, 20);
  assert.equal(cost.outputs.find(o => o.resource === 'atlas_fixture:empty_vial')!.amount, 4); assert.equal(cost.outputs.find(o => o.resource === 'atlas_fixture:dust')!.amount, 2);
});
test('wrong Mod version and unavailable predicates are explicit instead of a broad real-Mod support claim', () => {
  const { snapshot, pack, model, scenario, request } = fixtures(); snapshot.mods.find(m => m.id === 'atlas_fixture')!.version = '3';
  const mismatch = applyDefinitions(normalize(snapshot), [pack], { minecraft: snapshot.minecraft, loader: snapshot.loader }); assert.equal(mismatch.processes.length, 0); assert.ok(mismatch.diagnostics.some(d => d.rule === 'definition-version-mismatch'));
  scenario.gameRules = {}; const unknown = calculateCost(model, request, scenario); assert.equal(unknown.status, 'unknown'); assert.ok(unknown.diagnostics.some(d => d.rule === 'cost-context'));
  scenario.gameRules = { lootContext: { gate_multiblock_valid: true, circle_drawing_valid: true, summoning_context_valid: false, harvest_context_valid: true } }; assert.equal(calculateCost(model, request, scenario).status, 'invalid');
  assert.ok(pack.verified.some(s => s.includes('Synthetic offline')));
});
