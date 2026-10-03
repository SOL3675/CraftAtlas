import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture } from './helpers.ts';
import { normalize, semanticHash } from '../packages/core/src/normalize.ts';
import { diff } from '../packages/core/src/diff.ts';
import { readSnapshot, writeSnapshot } from '../packages/core/src/snapshot.ts';
import { buildDatabase, openDatabase } from '../packages/core/src/db.ts';
import { validateSnapshot } from '../packages/core/src/validate.ts';
test('original JSONL snapshot roundtrip verifies checksums, completion, semantic identity', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-contract-'));
  try {
    const path = join(root, 'snapshot'); writeSnapshot(path, fixture()); assert.deepEqual(readSnapshot(path), fixture());
    assert.throws(() => writeSnapshot(path, fixture()), /overwrite/);
    writeFileSync(join(path, 'tags.json'), '{}'); assert.throws(() => readSnapshot(path), /Checksum/);
    const incomplete = join(root, 'incomplete'); writeSnapshot(incomplete, fixture());
    const completion = JSON.parse(readFileSync(join(incomplete, 'completion.json'), 'utf8')); completion.status = 'failed'; writeFileSync(join(incomplete, 'completion.json'), JSON.stringify(completion));
    assert.throws(() => readSnapshot(incomplete), /Incomplete/);
    const staged = join(root, 'unpublished'); writeSnapshot(staged, fixture());
    renameSync(staged, staged + '.tmp-test');
    assert.throws(() => readSnapshot(staged + '.tmp-test'), /Unpublished/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('no generation/time noise in normalized hash and dynamic types are opaque', () => {
  const s = fixture(), newer = structuredClone(s); newer.id = 'new'; newer.session = 'new-session'; newer.generation = 42;
  const m = normalize(s); assert.equal(m.contentHash, normalize(newer).contentHash);
  const recipe = m.processes.find(p => p.id === 'atlas:diamond')!;
  assert.equal(recipe.inputs.length, 2); assert.equal(recipe.inputs[0].alternatives.length, 1); assert.deepEqual(recipe.inputs[0].alternatives[0].members, ['minecraft:dirt', 'minecraft:cobblestone']);
  assert.equal(m.processes.find(p => p.id === 'atlas:dynamic')!.interpretation, 'opaque');
  const machine = m.processes.find(p => p.type === 'mekanism:enriching')!;
  assert.equal(machine.inputs[0].amount, 2); assert.equal(machine.outputs[0].amount, 3); assert.equal(machine.costs[0].amount, null);
});
test('unknown tags, malformed shaped keys, missing results do not become empty known recipes', () => {
  const s = fixture(); s.recipes = [{ id: 'bad:shape', type: 'minecraft:crafting_shaped', data: { pattern: ['X'], key: {}, result: { id: 'minecraft:stick' } } }, { id: 'bad:tag', type: 'minecraft:crafting_shapeless', data: { ingredients: [{ tag: 'missing:tag' }], result: { id: 'minecraft:stick' } } }];
  const m = normalize(s); assert.equal(m.processes[0].interpretation, 'opaque'); assert.match(m.processes[1].unknown.join(), /Tag not acquired/);
});
test('SQLite rebuild reproduces indexed queries, including tag OR and pagination', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-db-'));
  try {
    const m = normalize(fixture()), one = join(root, 'one.sqlite'), two = join(root, 'two.sqlite'); buildDatabase(one, m); buildDatabase(two, m);
    const a = openDatabase(one), b = openDatabase(two);
    try {
      assert.deepEqual(a.inspect('minecraft:dirt'), b.inspect('minecraft:dirt')); assert.equal(a.uses('minecraft:cobblestone').items[0].id, 'atlas:diamond');
      assert.equal(a.sources('minecraft:diamond').items[0].outputs[0].amount, 2); assert.equal(a.search('', { limit: 1 }).truncated, true);
      assert.equal(a.search('%').total, 0); assert.throws(() => a.search('', { limit: NaN }), /pagination/); assert.throws(() => a.model('missing'), /Unknown/);
      assert.equal(a.coverage().items.find(c => c.dataset === 'loot')!.enumerated, null);
      assert.deepEqual(a.model(), m);
    } finally { a.close(); b.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('SQLite uses indexes resource gates and excludes colliding context or opaque condition IDs', () => {
  const root = mkdtempSync(join(tmpdir(), 'atlas-db-gates-'));
  try {
    const m = normalize(fixture()), template = m.processes.find(p => p.id === 'atlas:diamond')!;
    for (const kind of ['equipment', 'stage', 'dimension'] as const) {
      const id = `atlas:gate-${kind}`;
      m.resources.push({ id, kind, name: id, evidence: template.evidence });
      for (const requirementKind of [kind, 'context', 'opaque'] as const) {
        const p = structuredClone(template); p.id = p.sourceId = `atlas:${kind}-${requirementKind}`; p.inputs = [];
        p.requirements = [{ kind: requirementKind, id, evidence: template.evidence, ...(requirementKind === 'context' ? { predicate: true } : {}) }]; m.processes.push(p);
      }
    }
    // A real ingredient use still counts when the same process also has a context ID collision.
    const ingredient = structuredClone(template); ingredient.id = ingredient.sourceId = 'atlas:ingredient-and-context';
    ingredient.inputs = [{ alternatives: [{ resource: 'atlas:gate-equipment' }], amount: 1, unit: 'item', consumption: 'consumed', evidence: template.evidence }];
    ingredient.requirements = [{ kind: 'context', id: 'atlas:gate-equipment', predicate: true, evidence: template.evidence }]; m.processes.push(ingredient);
    m.contentHash = semanticHash(m);
    const file = join(root, 'gates.sqlite'); buildDatabase(file, m); const db = openDatabase(file);
    try {
      for (const kind of ['equipment', 'stage', 'dimension'] as const) {
        const expected = [`atlas:${kind}-${kind}`, ...(kind === 'equipment' ? ['atlas:ingredient-and-context'] : [])].sort();
        const result = db.uses(`atlas:gate-${kind}`);
        assert.deepEqual(result.items.map(p => p.id), expected); assert.equal(result.total, expected.length);
        assert.deepEqual(db.inspect(`atlas:gate-${kind}`).uses.map(p => p.id), expected);
      }
    } finally { db.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('reject duplicate identities, failed snapshot and stale JEI tokens', () => {
  const s = fixture(); s.recipes.push(s.recipes[0]); assert.throws(() => validateSnapshot(s), /Duplicate/);
  const stale = fixture(); stale.viewer = { session: 'old', generation: 0, context: {}, recipes: [], coverage: [] }; assert.throws(() => normalize(stale), /Stale/);
  const failed = fixture(); failed.completion.status = 'failed'; assert.throws(() => normalize(failed), /failed/);
});
test('shaped placement and unknown raw changes remain meaningful; malformed recipes never become free supplies', () => {
  const s = fixture(); s.recipes = [{ id: 'atlas:shape', type: 'minecraft:crafting_shaped', data: { pattern: ['X ', ' X'], key: { X: { item: 'minecraft:dirt' } }, result: { id: 'minecraft:stick' } } }];
  const after = structuredClone(s); (after.recipes[0].data as any).pattern = ['XX', '  '];
  assert.ok(diff(normalize(s), normalize(after)).changes.some(c => c.fields.includes('constraints')));
  const opaque = fixture(); (opaque.recipes[2].data as any).custom = 1; assert.notEqual(normalize(opaque).contentHash, normalize(fixture()).contentHash);
  const bad = fixture(); bad.recipes = [{ id: 'atlas:empty', type: 'minecraft:crafting_shapeless', data: { ingredients: [], result: { id: 'minecraft:diamond' } } }]; assert.equal(normalize(bad).processes[0].interpretation, 'opaque');
});
test('viewer metadata enriches exact matches; ambiguous or display-only records remain separate', () => {
  const s = fixture(); const p = normalize(s).processes.find(p => p.id === 'atlas:diamond')!;
  const v = { id: 'known', recipeId: p.id, category: 'minecraft:crafting', inputs: p.inputs, outputs: p.outputs, equipment: ['minecraft:crafting_table'], execution: 'unconfirmed' as const, unknown: [], raw: {} };
  s.viewer = { session: s.session, generation: s.generation, context: {}, recipes: [v, { ...v, id: 'display', recipeId: null, execution: 'display' }], coverage: [] };
  const m = normalize(s), exact = m.processes.find(p => p.id === 'atlas:diamond')!;
  assert.equal(exact.viewerSources![0].equipment[0], 'minecraft:crafting_table'); assert.equal(exact.requirements.length, 0);
  assert.equal(m.processes.find(p => p.id === 'jei:display')!.execution, 'display'); assert.ok(m.diagnostics.some(d => d.rule === 'ambiguous-viewer-match'));
  const modified = structuredClone(s); modified.viewer!.recipes[0].equipment.push('minecraft:furnace');
  assert.notEqual(m.contentHash, normalize(modified).contentHash);
});
