import assert from 'node:assert/strict';
import test from 'node:test';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fixture, scenario } from './helpers.ts';
import type { DefinitionPack } from '../packages/core/src/types.ts';

function custom() {
  const s = fixture(); s.coverage = [s.coverage[0]!];
  s.recipes = [{ id: 'mekanism:press', type: 'mekanism:custom_press', data: { custom: true } }];
  s.coverage[0]!.enumerated = 1;
  const p: DefinitionPack = { schemaVersion: 1, id: 'mekanism:authoring_fixture', version: '1.0.0', priority: 10,
    targets: { minecraft: s.minecraft, loader: s.loader, mods: [{ id: 'mekanism', versions: ['10.7.14'] }] }, verified: ['Synthetic contract only'], additions: [],
    operations: [{ id: 'press', selector: { id: 'mekanism:press' }, action: 'replace', override: [], evidence: 'Synthetic machine contract', patch: {
      inputs: [{ alternatives: [{ tag: 'atlas:materials', members: ['minecraft:diamond'] }], amount: 2, unit: 'item', consumption: 'consumed', evidence: [] }],
      outputs: [{ resource: 'minecraft:diamond', amount: 1, unit: 'item', role: 'primary', probability: 1, evidence: [] }],
      requirements: [{ kind: 'context', id: 'powered', predicate: true, evidence: [] }], interpretation: 'supported', execution: 'executable', unknown: [], costs: [],
    } }] };
  const sc = scenario(); sc.inventory = { 'minecraft:dirt': 1 }; sc.gameRules = { lootContext: { powered: true } };
  sc.closed = true; sc.closedResources = s.resources.map(r => r.id);
  return { s, p, sc };
}
for (const loader of ['fabric', 'neoforge']) test(`custom ${loader} serializer becomes a conditional transformation with definition provenance`, () => {
  const { s, p, sc } = custom(); s.loader = p.targets.loader = loader;
  const original = normalize(s), model = applyDefinitions(original, [p], s);
  assert.equal(analyze(original, sc, 'minecraft:diamond').status, 'unknown');
  assert.equal(analyze(model, sc, 'minecraft:diamond').status, 'reachable');
  const process = model.processes[0]!;
  assert.deepEqual(process.inputs[0]!.alternatives[0]!.members, [...s.tags['atlas:materials']!].sort());
  assert.deepEqual(process.raw, original.processes[0]!.raw);
  assert.equal(process.fieldHistory!.interpretation![0]!.value, 'opaque');
  assert.ok(process.evidence.some(e => e.startsWith('definition:')));
  assert.equal(model.coverage.find(c => c.dataset === 'normalization')!.interpreted, 1);
  sc.inventory = {}; assert.equal(analyze(model, sc, 'minecraft:diamond').status, 'unreachable');
  sc.inventory = { 'minecraft:dirt': 1 }; sc.gameRules = {};
  assert.equal(analyze(model, sc, 'minecraft:diamond').status, 'unknown');
  sc.gameRules = { lootContext: { powered: false } };
  assert.equal(analyze(model, sc, 'minecraft:diamond').status, 'unreachable');
});
test('missing references and invented tag members cannot create a route', () => {
  for (const variant of ['resource', 'tag', 'output', 'ambiguous']) {
    const { s, p, sc } = custom(), patch = p.operations[0]!.patch;
    if (variant === 'resource') patch.inputs![0]!.alternatives = [{ resource: 'missing:input' }];
    if (variant === 'tag') patch.inputs![0]!.alternatives = [{ tag: 'missing:tag' }];
    if (variant === 'output') patch.outputs![0]!.resource = 'missing:output';
    if (variant === 'ambiguous') patch.inputs![0]!.alternatives = [{ resource: 'minecraft:dirt', tag: 'atlas:empty', members: [] }];
    const model = applyDefinitions(normalize(s), [p], s);
    assert.ok(model.diagnostics.some(d => d.rule === 'definition-reference-missing'), variant);
    assert.equal(analyze(model, sc, patch.outputs![0]!.resource).status, 'unknown', variant);
  }
});
test('definitions cannot erase failed capture coverage, opaque constraints or interpretation conflicts', () => {
  const { s, p, sc } = custom(); s.coverage[0]!.status = 'partial';
  const model = applyDefinitions(normalize(s), [p], s);
  assert.equal(model.coverage[0]!.status, 'partial');
  sc.inventory = {}; assert.equal(analyze(model, sc, 'minecraft:diamond').status, 'unknown');
  const original = normalize(s); original.processes[0]!.constraints = { linked: true };
  const constrained = applyDefinitions(original, [p], s);
  assert.equal(constrained.coverage.find(c => c.dataset === 'normalization')!.status, 'partial');
  sc.inventory = { 'minecraft:dirt': 1 }; assert.equal(analyze(constrained, sc, 'minecraft:diamond').status, 'unknown');
  const other = structuredClone(p); other.id = 'mekanism:other';
  const conflict = applyDefinitions(normalize(s), [p, other], s);
  assert.ok(conflict.processes[0]!.conflicts.length);
  assert.equal(analyze(conflict, sc, 'minecraft:diamond').status, 'unknown');
  p.operations[0]!.action = 'append';
  assert.ok(applyDefinitions(normalize(s), [p], s).diagnostics.some(d => d.rule === 'definition-invalid-append'));
});
test('unknown versions and malformed definitions fail schema validation', () => {
  const { s, p } = custom();
  assert.throws(() => applyDefinitions(normalize(s), [{ ...p, schemaVersion: 99 } as unknown as DefinitionPack], s), /definitions/);
  p.operations[0]!.patch.inputs![0]!.amount = 0;
  assert.throws(() => applyDefinitions(normalize(s), [p], s), /definitions/);
});

test('CLI loads authored packs and reports the actual conditional route', t => {
  const dir = mkdtempSync(join(tmpdir(), 'Atlas authoring 日本語 ')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const { s, p, sc } = custom();
  for (const [name, data] of [['snapshot', s], ['definitions', p], ['scenario', sc]] as const) writeFileSync(join(dir, `${name}.json`), JSON.stringify(data));
  const args = [resolve('packages/cli/src/main.ts'), 'explain', 'minecraft:diamond', '--snapshot', join(dir, 'snapshot.json'), '--definitions', join(dir, 'definitions.json'), '--scenario', join(dir, 'scenario.json'), '--json'];
  const positive = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(positive.status, 0, positive.stderr);
  assert.equal(JSON.parse(positive.stdout).result.status, 'reachable');
  sc.inventory = {}; writeFileSync(join(dir, 'scenario.json'), JSON.stringify(sc));
  const negative = spawnSync(process.execPath, args, { encoding: 'utf8' }); assert.equal(negative.status, 0, negative.stderr);
  assert.equal(JSON.parse(negative.stdout).result.status, 'unreachable');
});
