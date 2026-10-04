import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { normalize } from '../packages/core/src/normalize.ts';
import { datapackRecipeId, recipeDirectory } from '../packages/core/src/datapack.ts';
import { validateSnapshot } from '../packages/core/src/validate.ts';
import { readSnapshot, writeSnapshot } from '../packages/core/src/snapshot.ts';
import { buildDatabase, openDatabase } from '../packages/core/src/db.ts';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { server1201, target1201 } from '../packages/harness/src/targets-1.20.1.ts';
import { scenario, fixture } from './helpers.ts';
import { snapshot1201 } from './fixtures-1.20.1.ts';
import type { DefinitionPack } from '../packages/core/src/types.ts';

for (const loader of ['forge', 'fabric'] as const) {
  test(`${loader} 1.20.1: plural recipes retain runtime/network/source identity and unknown custom APIs`, () => {
    const s = snapshot1201(loader), m = normalize(s), p = m.processes.find(p => p.id === 'atlas:diamond')!;
    assert.equal(p.interpretation, 'supported'); assert.equal(p.outputs[0].amount, 2);
    assert.deepEqual(p.raw, { data: s.recipes[0].data, serialization: s.recipes[0].serialization });
    assert.ok(p.evidence.includes('datapack:atlas:diamond'));
    assert.ok(m.evidence.some(e => e.adapter === `${loader}-registry-1.20.1`));
    for (const id of ['atlas:source_only', 'atlas:conditional', 'atlas:runtime_only']) {
      const unknown = m.processes.find(p => p.id === id)!;
      assert.equal(unknown.interpretation, 'opaque'); assert.equal(unknown.execution, 'unconfirmed'); assert.deepEqual(unknown.outputs, []);
    }
    assert.ok(m.diagnostics.some(d => d.rule === 'recipe-resource-missing' && d.target === 'atlas:runtime_only'));
    assert.ok(!m.processes.some(p => p.id === 'atlas:press'));
    assert.equal(m.coverage.find(c => c.dataset === 'datapackInterpretation')?.status, 'unsupported');
    assert.deepEqual(m.datapack?.disabledPacks, ['file/disabled']);
    const noInput = scenario(); noInput.inventory = {};
    assert.equal(analyze(m, noInput, 'minecraft:diamond').status, 'unknown');
    assert.equal(analyze(m, scenario(), 'minecraft:diamond').status, 'reachable');
    const damaged = structuredClone(s); damaged.recipes[0].serialization!.bytesBase64 = 'AQ==';
    assert.throws(() => validateSnapshot(damaged), /checksum/);
    const failed = structuredClone(s); failed.recipes[1].serialization = { encoding: 'recipe-network-1.20.1', error: 'encoder failed', limitations: [] };
    assert.ok(validateSnapshot(failed)); assert.equal(normalize(failed).processes.find(p => p.id === 'atlas:runtime_only')?.execution, 'unconfirmed');
  });
  test(`${loader} 1.20.1: snapshot/manifest/SQLite/CLI preserve network bytes and plural raw resources`, () => {
    const temp = mkdtempSync(join(tmpdir(), 'atlas-1201-'));
    try {
      const capture = join(temp, 'capture'), db = join(temp, 'atlas.sqlite'), s = snapshot1201(loader);
      writeSnapshot(capture, s); assert.deepEqual(readSnapshot(capture), s);
      const m = normalize(readSnapshot(capture)); buildDatabase(db, m); const database = openDatabase(db);
      try { assert.deepEqual(database.model().datapack, s.datapack); assert.deepEqual(database.model().processes.find(p => p.id === 'atlas:runtime_only')?.raw, { data: null, serialization: s.recipes[1].serialization }); }
      finally { database.close(); }
      const cli = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'datapack', 'atlas:recipes/diamond.json', '--db', db, '--json'], { encoding: 'utf8' });
      assert.equal(cli.status, 0, cli.stderr); assert.ok(cli.stdout.includes('file/override')); assert.ok(cli.stdout.includes('mod/embedded'));
      const validate = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'validate', '--snapshot', capture, '--json'], { encoding: 'utf8' });
      assert.equal(validate.status, 0, validate.stderr);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  });
  test(`${loader} 1.20.1: reviewed definitions remain exact-target and require actual materials`, () => {
    const s = snapshot1201(loader), m = normalize(s);
    const pack: DefinitionPack = { schemaVersion: 1, id: 'atlas:reviewed-1201', version: '1', priority: 1, targets: { minecraft: '1.20.1', loader, mods: [{ id: 'atlasfixture', versions: ['1.0.0'] }] }, verified: ['Synthetic contract review'], additions: [], operations: [{ id: 'review', selector: { id: 'atlas:source_only' }, action: 'replace', evidence: 'reviewed fixture', override: [], patch: { interpretation: 'supported', execution: 'executable', unknown: [], requirements: [], costs: [], inputs: [{ alternatives: [{ resource: 'minecraft:dirt' }], amount: 1, unit: 'item', consumption: 'consumed', evidence: [] }], outputs: [{ resource: 'minecraft:diamond', amount: 1, unit: 'item', role: 'primary', probability: 1, evidence: [] }] } }] };
    const reviewed = applyDefinitions(m, [pack], s);
    assert.equal(reviewed.processes.find(p => p.id === 'atlas:source_only')?.execution, 'executable');
    const noInput = scenario(); noInput.inventory = {};
    assert.equal(analyze(reviewed, noInput, 'minecraft:diamond').status, 'unknown');
    assert.equal(analyze(reviewed, scenario(), 'minecraft:diamond').status, 'reachable');
    assert.deepEqual(reviewed.datapack, m.datapack);
    assert.ok(applyDefinitions(m, [pack], { ...s, minecraft: '1.21.1' }).diagnostics.some(d => d.rule === 'definition-environment-mismatch'));
  });
}
test('directory and adapter boundaries reject guessed cross-version conventions', () => {
  const s = snapshot1201('forge'), resource = s.datapack!.resources[0];
  assert.equal(recipeDirectory('1.20.1'), 'recipes'); assert.equal(recipeDirectory('1.21.1'), 'recipe'); assert.equal(recipeDirectory('1.19.2'), undefined);
  assert.equal(datapackRecipeId(resource, '1.20.1'), 'atlas:diamond'); assert.equal(datapackRecipeId(resource, '1.21.1'), undefined);
  assert.equal(datapackRecipeId({ ...resource, id: 'atlas:recipe/diamond.json' }, '1.20.1'), undefined);
  const existing = fixture(); assert.equal(normalize(existing).processes.find(p => p.id === 'atlas:diamond')?.interpretation, 'supported');
  existing.loader = 'forge'; assert.equal(normalize(existing).processes.find(p => p.id === 'atlas:diamond')?.interpretation, 'opaque');
  s.loader = 'neoforge'; assert.equal(normalize(s).processes.find(p => p.id === 'atlas:diamond')?.interpretation, 'opaque');
});
test('configured matrix preserves 1.21.1 requirements and pins 1.20.1 loaders, Java, server/helper tools and required viewer suites', () => {
  const config = JSON.parse(readFileSync('harness.config.json', 'utf8')), lock = JSON.parse(readFileSync('harness.lock.json', 'utf8'));
  assert.deepEqual(Object.keys(config.targets).sort(), ['fabric-1.20.1','fabric-1.21.1','forge-1.20.1','neoforge-1.21.1']);
  assert.ok(config.targets['neoforge-1.21.1'].requiredSuites.includes('atlas-world'));
  for (const loader of ['forge', 'fabric'] as const) {
    const id = `${loader}-1.20.1`, target = config.targets[id], metadata = target1201(id, target), runtime = server1201(id, target);
    assert.equal(target.java.toolchain, 17); assert.equal(target.java.game, 'java17');
    assert.equal(target.java.gradle, loader === 'fabric' ? 'java21' : 'java17');
    assert.ok(lock.tools[metadata.helper].sha256.match(/^[a-f0-9]{64}$/));
    assert.ok(runtime.command!.args.includes('-Dcraftatlas.testRuntimeFixture=true'));
    assert.ok(runtime.command!.args.some(a => a.includes(loader === 'forge' ? '1.20.1-47.3.0' : '{tool:fabric-server-1.20.1}')));
    assert.ok(target.requiredSuites.includes(`atlas-1.20.1-${metadata.viewer}`));
    assert.throws(() => target1201(id, { ...target, minecraft: '1.21.1' }), /mismatched/);
  }
});
test('1.20.1 NBT, custom predicates and loader conditions retain uncertainty', () => {
  const s = snapshot1201('forge'); (s.recipes[0].data as any).result.nbt = '{Damage:4}';
  (s.recipes[0].data as any)['forge:conditions'] = [{ type: 'atlas:opaque_hook' }];
  const p = normalize(s).processes.find(p => p.id === 'atlas:diamond')!;
  assert.deepEqual(p.outputs[0].components, { nbt: '{Damage:4}' }); assert.ok(p.unknown.some(u => u.includes('NBT'))); assert.ok(p.requirements.some(r => r.kind === 'opaque'));
});
for (const loader of ['forge', 'fabric'] as const) test(`${loader} 1.20.1: reviewed vanilla runtime forms preserve shaped slots, quantities, smithing and fuel unknowns`, () => {
  const s = snapshot1201(loader); s.datapack = undefined;
  s.recipes = [
    { id: 'atlas:shape', type: 'minecraft:crafting_shaped', data: { pattern: ['A A', ' B '], key: { A: { item: 'minecraft:dirt' }, B: { tag: 'atlas:materials' } }, result: { item: 'minecraft:diamond', count: 3 } } },
    { id: 'atlas:stonecut', type: 'minecraft:stonecutting', data: { ingredient: { item: 'minecraft:dirt' }, result: { item: 'minecraft:diamond' }, count: 2 } },
    { id: 'atlas:smith', type: 'minecraft:smithing_transform', data: { template: { item: 'minecraft:dirt' }, base: { item: 'minecraft:stick' }, addition: { item: 'minecraft:diamond' }, result: { item: 'minecraft:emerald' } } },
    ...['smelting', 'blasting', 'smoking', 'campfire_cooking'].map(type => ({ id: `atlas:${type}`, type: `minecraft:${type}`, data: { ingredient: { item: 'minecraft:dirt' }, result: 'minecraft:diamond', cookingtime: 200, experience: 0.1 } })),
  ];
  const m = normalize(s), shaped = m.processes.find(p => p.id === 'atlas:shape')!;
  assert.deepEqual(shaped.constraints, { kind: 'shaped-grid', layout: [[0, null, 1], [null, 2, null]] });
  assert.equal(shaped.inputs.length, 3); assert.equal(shaped.outputs[0].amount, 3);
  assert.equal(m.processes.find(p => p.id === 'atlas:stonecut')?.outputs[0].amount, 2);
  const smith = m.processes.find(p => p.id === 'atlas:smith')!; assert.equal(smith.inputs.length, 3); assert.ok(smith.unknown.length);
  for (const type of ['smelting', 'blasting', 'smoking', 'campfire_cooking']) {
    const p = m.processes.find(p => p.id === `atlas:${type}`)!;
    assert.equal(p.interpretation, 'supported'); assert.equal(p.costs[0].amount, 200);
    assert.equal(p.requirements.some(r => r.kind === 'opaque'), type !== 'campfire_cooking');
  }
});
