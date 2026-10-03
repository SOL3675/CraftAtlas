import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixture } from './helpers.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import { diff } from '../packages/core/src/diff.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { audit } from '../packages/core/src/audit.ts';
import type { DefinitionPack, Process, Scenario, Snapshot } from '../packages/core/src/types.ts';

const context = { minecraft: '1.21.1', loader: 'neoforge' };
function pack(id = 'base', priority = 1): DefinitionPack {
  return { schemaVersion: 1, id, version: '1.0', priority, targets: { ...context, mods: [{ id: 'mekanism', versions: ['10.7.14'] }] }, verified: ['unit-test fixture only'], operations: [], additions: [] };
}
function operation(id: string, patch: DefinitionPack['operations'][number]['patch'], action: 'append' | 'replace' | 'disable' = 'append'): DefinitionPack['operations'][number] {
  return { id, selector: { id: 'atlas:diamond' }, action, patch, evidence: 'fixture recipe inspection', override: [] };
}
test('definition append/replace/disable preserves original raw and previous facts with field provenance', () => {
  const original = normalize(fixture()), p = pack();
  p.operations = [operation('stage', { requirements: [{ kind: 'stage', id: 'research', evidence: [] }] }), operation('amount', { outputs: [{ ...original.processes.find(p => p.id === 'atlas:diamond')!.outputs[0]!, amount: 4 }] }, 'replace'), { ...operation('disable', {}, 'disable'), selector: { id: 'atlas:dynamic' } }];
  const updated = applyDefinitions(original, [p], context), before = original.processes.find(p => p.id === 'atlas:diamond')!, after = updated.processes.find(p => p.id === 'atlas:diamond')!;
  assert.equal(before.outputs[0]!.amount, 2); assert.equal(after.outputs[0]!.amount, 4); assert.deepEqual(after.raw, before.raw);
  assert.deepEqual(after.fieldHistory!.outputs![0]!.value, before.outputs); assert.deepEqual(after.fieldHistory!.outputs![0]!.evidence, before.fieldEvidence.outputs);
  assert.ok(after.fieldEvidence.outputs!.includes('definition:base@1.0:amount')); assert.ok(after.fieldEvidence.outputs!.includes('runtime:atlas:diamond'));
  assert.ok(after.requirements.some(r => r.id === 'research')); assert.equal(updated.processes.find(p => p.id === 'atlas:dynamic')!.enabled, false);
  assert.ok(updated.diagnostics.some(d => d.rule === 'definition-runtime-contradiction'));
  assert.equal(original.evidence.some(e => e.kind === 'definition'), false); assert.equal(diff(original, updated).provenance.definitionsChanged, true);
});
test('target environment, absent Mod, version and unmatched selector have separate diagnostics', () => {
  const m = normalize(fixture()), environment = pack('env'), absent = pack('absent'), version = pack('version'), selector = pack('selector');
  environment.targets.minecraft = '1.20.1'; absent.targets.mods = [{ id: 'absent', versions: ['1'] }]; version.targets.mods[0]!.versions = ['wrong']; selector.operations = [{ ...operation('gone', {}), selector: { id: 'removed:recipe' } }];
  const result = applyDefinitions(m, [environment, absent, version, selector], context);
  for (const rule of ['definition-environment-mismatch', 'definition-mod-missing', 'definition-version-mismatch', 'definition-selector-empty']) assert.ok(result.diagnostics.some(d => d.rule === rule), rule);
  assert.deepEqual(result.processes, m.processes);
});
test('overlays are independent of load order and conflicting replacements require an explicit override', () => {
  const m = normalize(fixture()), base = pack('base', 1), custom = pack('custom', 10);
  base.operations = [operation('state', { execution: 'display' }, 'replace')]; custom.operations = [operation('state', { execution: 'executable' }, 'replace')];
  const one = applyDefinitions(m, [base, custom], context), two = applyDefinitions(m, [custom, base], context);
  assert.deepEqual(one, two); assert.ok(one.diagnostics.some(d => d.rule === 'definition-conflict')); assert.equal(one.processes.find(p => p.id === 'atlas:diamond')!.execution, 'executable');
  custom.operations[0]!.override = ['base:state'];
  const resolved = applyDefinitions(m, [custom, base], context); assert.equal(resolved.diagnostics.some(d => d.rule === 'definition-conflict'), false); assert.deepEqual(resolved.processes.find(p => p.id === 'atlas:diamond')!.fieldEvidence.execution, ['runtime:atlas:diamond', 'definition:custom@1.0:state']);
  custom.priority = 1; const tie = applyDefinitions(m, [base, custom], context); assert.ok(tie.diagnostics.some(d => d.rule === 'definition-invalid-override'));
});
test('invalid/ambiguous override references and duplicate pack/operation IDs do not silently choose a writer', () => {
  const m = normalize(fixture()), p = pack(), other = pack('other', 2);
  p.operations = [operation('same', { execution: 'display' }, 'replace')]; other.operations = [{ ...operation('x', { execution: 'executable' }, 'replace'), override: ['missing'] }];
  assert.ok(applyDefinitions(m, [p, other], context).diagnostics.some(d => d.rule === 'definition-invalid-override'));
  assert.ok(applyDefinitions(m, [p, structuredClone(p)], context).diagnostics.some(d => d.rule === 'definition-duplicate'));
  p.operations.push(structuredClone(p.operations[0]!)); assert.ok(applyDefinitions(m, [p], context).diagnostics.some(d => d.rule === 'definition-operation-duplicate'));
});
test('definition additions retain catalysts, durability, return outputs and equipment separately', () => {
  const m = normalize(fixture()), p = pack(), added: Process = {
    id: 'atlas:ritual', sourceId: 'atlas:ritual', type: 'atlas:ritual', inputs: [
      { alternatives: [{ resource: 'minecraft:dirt' }], amount: 2, unit: 'item', consumption: 'consumed', evidence: [] },
      { alternatives: [{ resource: 'minecraft:stick' }], amount: 1, unit: 'item', consumption: 'durability', evidence: [] },
      { alternatives: [{ resource: 'minecraft:cobblestone' }], amount: 1, unit: 'item', consumption: 'catalyst', evidence: [] },
    ], outputs: [{ resource: 'minecraft:diamond', amount: 1, unit: 'item', role: 'primary', probability: 0.5, evidence: [] }, { resource: 'minecraft:stick', amount: 1, unit: 'item', role: 'returned', probability: 1, evidence: [] }], requirements: [{ kind: 'equipment', id: 'magic-circle', evidence: [] }], evidence: [], interpretation: 'supported', execution: 'executable', enabled: true, unknown: [], raw: { manual: true }, fieldEvidence: {}, conflicts: [], costs: [{ kind: 'time', amount: null, unit: 'tick', basis: 'unmeasured' }],
  };
  p.additions = [added]; const result = applyDefinitions(m, [p], context), actual = result.processes.find(p => p.id === added.id)!;
  assert.deepEqual(actual.inputs.map(i => i.consumption), ['consumed', 'durability', 'catalyst']); assert.equal(actual.outputs[1]!.role, 'returned'); assert.equal(actual.costs[0]!.amount, null); assert.equal(actual.requirements[0]!.id, 'magic-circle'); assert.ok(actual.inputs.every(i => i.evidence.length));
  const conflicting = pack('conflicting'); conflicting.additions = [added]; const conflict = applyDefinitions(m, [p, conflicting], context); assert.ok(conflict.diagnostics.some(d => d.rule === 'definition-addition-conflict')); assert.equal(conflict.processes.some(p => p.id === added.id), false);
});
test('version-scoped sample separates installed equipment from its repeating ritual', () => {
  const sample = JSON.parse(readFileSync(new URL('../definitions/fixture-equipment.json', import.meta.url), 'utf8')) as DefinitionPack;
  const snapshot = JSON.parse(readFileSync(new URL('../fixtures/definition-equipment-snapshot.json', import.meta.url), 'utf8')) as Snapshot;
  const scenario = JSON.parse(readFileSync(new URL('../fixtures/definition-equipment-scenario.json', import.meta.url), 'utf8')) as Scenario;
  const m = applyDefinitions(normalize(snapshot), [sample], context), assembly = m.processes.find(p => p.id.endsWith('assemble_circle'))!, ritual = m.processes.find(p => p.id.endsWith('repeat_ritual'))!;
  assert.equal(assembly.inputs[1]!.consumption, 'durability'); assert.equal(ritual.inputs[1]!.consumption, 'catalyst'); assert.equal(ritual.outputs[1]!.role, 'returned'); assert.equal(ritual.inputs.some(i => i.alternatives.some(a => a.resource?.endsWith('floor'))), false);
  const result = analyze(m, scenario, 'atlas_fixture:crystal'); assert.equal(result.status, 'reachable'); assert.ok(result.path.includes('atlas_fixture:assemble_circle')); assert.ok(result.path.includes('atlas_fixture:repeat_ritual')); assert.ok(result.evidence.some(e => e.startsWith('definition:')));
  assert.equal(audit(m, { schemaVersion: 1, recipes: ['atlas_fixture:assemble_circle', 'atlas_fixture:repeat_ritual'], nonemptyTags: [], supportedTypes: [], reachable: [], unreachable: [] }).some(d => d.rule === 'required-recipe'), false);
  scenario.forbiddenProcesses = ['atlas_fixture:assemble_circle']; assert.equal(analyze(m, scenario, 'atlas_fixture:crystal').status, 'unknown');
  scenario.equipment = ['atlas_fixture:installed_circle']; assert.equal(analyze(m, scenario, 'atlas_fixture:crystal').status, 'reachable');
});
