import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture, scenario } from './helpers.ts';
import { bytesHash } from '../packages/core/src/hash.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { readSnapshot, writeSnapshot } from '../packages/core/src/snapshot.ts';
import { buildDatabase, openDatabase } from '../packages/core/src/db.ts';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { validateSnapshot } from '../packages/core/src/validate.ts';
import { audit } from '../packages/core/src/audit.ts';
import { diff } from '../packages/core/src/diff.ts';
import type { DatapackVariant, DefinitionPack, Json } from '../packages/core/src/types.ts';

function variant(source: string, data: Json): DatapackVariant {
  const text = JSON.stringify(data); return { source, text, sha256: bytesHash(Buffer.from(text)), data };
}
function embedded() {
  const s = fixture(); s.recipes = [];
  const low = variant('mod/embedded', { type: 'atlas:custom_press', inputs: ['unreviewed:field'], result: { id: 'minecraft:diamond' } });
  const high = variant('file/override', { type: 'atlas:custom_press', material: 'minecraft:dirt', result: { id: 'minecraft:diamond' }, 'neoforge:conditions': [{ type: 'atlas:java_condition' }] });
  s.datapack = { directories: ['recipe', 'machines'], selectedPacks: ['vanilla', 'mod:atlas', 'file/override'], loadedPacks: ['vanilla', 'mod/embedded', 'file/override'], disabledPacks: ['file/disabled'], resources: [
    { id: 'atlas:recipe/press.json', effective: high, stack: [low, high] },
    { id: 'atlas:machines/press.json', effective: low, stack: [low] },
  ], limitations: ['Synthetic active server resource capture; no game validation'] };
  s.coverage = [{ dataset: 'recipes', type: '*', status: 'complete', enumerated: 0, interpreted: null, reasons: [] }, { dataset: 'datapack', type: 'recipe,machines', status: 'complete', enumerated: 2, interpreted: null, reasons: [] }];
  return s;
}
for (const loader of ['fabric', 'neoforge']) test(`${loader}: unknown embedded serializer preserves effective JSON and overrides without inventing a route`, () => {
  const s = embedded(); s.loader = loader;
  const m = normalize(s), p = m.processes[0]!;
  assert.equal(m.processes.length, 1, 'custom directories are raw evidence, not guessed recipes');
  assert.equal(p.id, 'atlas:press'); assert.equal(p.type, 'atlas:custom_press');
  assert.equal(p.interpretation, 'opaque'); assert.equal(p.execution, 'unconfirmed');
  assert.deepEqual(p.inputs, []); assert.deepEqual(p.outputs, []);
  assert.deepEqual(p.raw, s.datapack!.resources[0]!.effective.data);
  assert.deepEqual(m.datapack, s.datapack);
  assert.equal(m.coverage.find(c => c.dataset === 'normalization')!.interpreted, 0);
  assert.equal(analyze(m, scenario(), 'minecraft:diamond').status, 'unknown');
  const changed = structuredClone(s); changed.datapack!.resources[0]!.stack[0] = variant('mod/embedded', { type: 'atlas:old_version' });
  assert.notEqual(normalize(changed).contentHash, m.contentHash, 'overridden authoring evidence remains part of snapshot identity');
});
test('RecipeManager wins, links source provenance, preserves codec failures and identifies runtime-only IDs', () => {
  const s = embedded(); s.recipes = [
    { id: 'atlas:press', type: 'atlas:custom_press', data: null, error: 'Codec refuses to encode' },
    { id: 'atlas:runtime_only', type: 'atlas:runtime_only', data: { runtime: true } },
  ];
  const m = normalize(s), p = m.processes.find(p => p.id === 'atlas:press')!;
  assert.equal(m.processes.length, 2); assert.equal(p.raw, null);
  assert.equal(p.execution, 'unconfirmed');
  assert.ok(p.evidence.includes('runtime:atlas:press')); assert.ok(p.evidence.includes('datapack:atlas:press'));
  assert.ok(p.unknown.some(u => u.includes('Codec refuses')));
  assert.ok(m.datapack!.resources[0]!.effective.text!.includes('java_condition'));
  assert.ok(m.diagnostics.some(d => d.rule === 'recipe-resource-missing' && d.target === 'atlas:runtime_only'));
  s.recipes[0]!.type = 'atlas:mutated';
  assert.ok(normalize(s).diagnostics.some(d => d.rule === 'datapack-runtime-conflict'));
});
test('unregistered vanilla JSON, malformed text and missing type remain opaque with their original bytes', () => {
  const s = embedded(), text = '{"type":';
  const malformed: DatapackVariant = { source: 'mod/embedded', text, sha256: bytesHash(Buffer.from(text)), data: null, error: 'Malformed JSON' };
  const untyped = variant('mod/embedded', ['not a recipe']);
  const vanilla = variant('mod/embedded', { type: 'minecraft:crafting_shapeless', ingredients: [{ item: 'minecraft:dirt' }], result: { id: 'minecraft:diamond' } });
  for (const [name, effective] of [['bad', malformed], ['untyped', untyped], ['conditional', vanilla]] as const) s.datapack!.resources.push({ id: `atlas:recipe/${name}.json`, effective, stack: [effective] });
  const m = normalize(s);
  assert.ok(m.processes.every(p => p.interpretation === 'opaque' && p.execution === 'unconfirmed' && !p.outputs.length));
  assert.ok(m.diagnostics.some(d => d.rule === 'datapack-resource-error'));
  assert.equal(m.processes.find(p => p.id === 'atlas:untyped')!.type, 'craftatlas:uninterpretable');
  assert.equal(m.datapack!.resources.find(r => r.id === 'atlas:recipe/bad.json')!.effective.text, text);
});
test('definitions require explicit execution review for data-only recipes and preserve raw capture coverage/history', () => {
  const s = embedded(), original = normalize(s);
  const pack: DefinitionPack = { schemaVersion: 1, id: 'atlas:reviewed', version: '1', priority: 1, targets: { minecraft: s.minecraft, loader: s.loader, mods: [] }, verified: ['Synthetic contract only'], additions: [], operations: [{ id: 'press', selector: { id: 'atlas:press' }, action: 'replace', evidence: 'Reviewed material, condition and machine contract', override: [], patch: {
    interpretation: 'supported', unknown: [], inputs: [{ alternatives: [{ resource: 'minecraft:dirt' }], amount: 1, unit: 'item', consumption: 'consumed', evidence: [] }], outputs: [{ resource: 'minecraft:diamond', amount: 1, unit: 'item', role: 'primary', probability: 1, evidence: [] }], requirements: [{ kind: 'context', id: 'enabled', predicate: true, evidence: [] }],
  } }] };
  const sc = scenario(); sc.gameRules = { lootContext: { enabled: true } };
  assert.equal(analyze(applyDefinitions(original, [pack], s), sc, 'minecraft:diamond').status, 'unknown');
  pack.operations[0]!.patch.execution = 'executable';
  const reviewed = applyDefinitions(original, [pack], s);
  assert.equal(analyze(reviewed, sc, 'minecraft:diamond').status, 'reachable');
  sc.gameRules = {}; assert.equal(analyze(reviewed, sc, 'minecraft:diamond').status, 'unknown');
  assert.deepEqual(reviewed.datapack, original.datapack); assert.deepEqual(reviewed.processes[0]!.raw, original.processes[0]!.raw);
  assert.equal(reviewed.processes[0]!.fieldHistory!.execution![0]!.value, 'unconfirmed');
  assert.deepEqual(reviewed.coverage.find(c => c.dataset === 'datapack'), original.coverage.find(c => c.dataset === 'datapack'));
});
test('raw datapacks round-trip through manifests, models, SQLite and paginated CLI', t => {
  const dir = mkdtempSync(join(tmpdir(), 'atlas-datapack-')); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const s = embedded(), capture = join(dir, 'capture'); writeSnapshot(capture, s);
  assert.deepEqual(readSnapshot(capture), s); assert.ok(JSON.parse(readFileSync(join(capture, 'manifest.json'), 'utf8')).files['datapack.json']);
  const m = normalize(s), dbPath = join(dir, 'atlas.sqlite'); buildDatabase(dbPath, m);
  const db = openDatabase(dbPath); try { assert.deepEqual(db.model().datapack, s.datapack); } finally { db.close(); }
  const cli = spawnSync(process.execPath, [resolve('packages/cli/src/main.ts'), 'datapack', '--db', dbPath, '--limit', '1', '--offset', '1', '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr); const result = JSON.parse(cli.stdout).result;
  assert.equal(result.resources.total, 2); assert.equal(result.resources.items.length, 1); assert.equal(result.resources.truncated, true);
  writeFileSync(join(capture, 'datapack.json'), '{}'); assert.throws(() => readSnapshot(capture), /Checksum/);
});
test('datapack validation rejects altered bytes, parsed values, duplicate IDs and disabled selection overlap', () => {
  for (const change of [
    (s: ReturnType<typeof embedded>) => { s.datapack!.resources[0]!.effective.text += ' '; },
    (s: ReturnType<typeof embedded>) => { s.datapack!.resources[0]!.effective.data = {}; },
    (s: ReturnType<typeof embedded>) => { s.datapack!.resources.push(s.datapack!.resources[0]!); },
    (s: ReturnType<typeof embedded>) => { s.datapack!.disabledPacks.push('vanilla'); },
  ]) { const s = embedded(); change(s); assert.throws(() => validateSnapshot(s), /Datapack|datapack/); }
  const legacy = fixture(); assert.equal(normalize(legacy).datapack, undefined);
});
test('raw custom API data cannot silently establish closed acquisition coverage', () => {
  const s = embedded(); s.datapack!.resources = [s.datapack!.resources[1]!];
  const sc = scenario(); sc.inventory = {}; sc.closed = true; sc.closedResources = s.resources.map(r => r.id);
  assert.equal(analyze(normalize(s), sc, 'minecraft:diamond').status, 'unknown');
  assert.equal(normalize(s).coverage.find(c => c.dataset === 'datapackInterpretation')!.status, 'unsupported');
});
test('raw-only IDs cannot satisfy required runtime recipes; codec failure retains registration evidence', () => {
  const s = embedded();
  const check = { schemaVersion: 1 as const, recipes: ['atlas:press'], nonemptyTags: [], supportedTypes: [], reachable: [], unreachable: [] };
  assert.ok(audit(normalize(s), check).some(d => d.rule === 'required-recipe' && d.status === 'confirmed'));
  s.recipes = [{ id: 'atlas:press', type: 'atlas:custom_press', data: null, error: 'Codec error' }];
  assert.equal(audit(normalize(s), check).some(d => d.rule === 'required-recipe'), false, 'registration evidence is independent of interpretation');
});
test('raw evidence diffs expose overridden and custom-directory changes without guessing custom API impact', () => {
  const before = embedded(), after = structuredClone(before);
  after.datapack!.resources[0]!.stack[0] = variant('mod/embedded', { type: 'atlas:changed_shadowed' });
  after.datapack!.resources[1]!.effective = variant('mod/embedded', { arbitrary: 'changed' });
  const result = diff(normalize(before), normalize(after));
  assert.equal(result.changes.filter(c => c.kind === 'datapack').length, 2);
  assert.ok(result.provenance.datapackChanged);
  assert.deepEqual(result.impact.processes, ['atlas:press']);
  assert.equal(result.changes.some(c => c.kind === 'process'), false);
});
