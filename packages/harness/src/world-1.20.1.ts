import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadConfig } from 'craft-foundry/core/config';
import { OwnedServer } from 'craft-foundry/adapters/runtime/server';
import { normalize } from '../../core/src/normalize.ts';
import { readSnapshot } from '../../core/src/snapshot.ts';
import { buildDatabase } from '../../core/src/db.ts';
import { analyze } from '../../core/src/analyze.ts';
import { bytesHash, hash } from '../../core/src/hash.ts';
import { runArtifacts, saveResults, RequiredUnsupported } from './common.ts';
import type { Case } from './common.ts';
import { target1201, server1201 } from './targets-1.20.1.ts';
import { readObservation1201 } from './observation-1.20.1.ts';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const session = resolve(process.argv[2]), runRoot = resolve(process.argv[3]), target = process.argv[4];
const ids = ['atlas.observation-loot', 'atlas.observation-block', 'atlas.observation-entity', 'atlas.observation-world', 'atlas.observation-rejections', 'atlas.observation-reload', 'atlas.world-stopped'];
const cases: Case[] = [], loaded = await loadConfig(root), artifacts = runArtifacts(runRoot, target);
const metadata = target1201(target, loaded.config.targets[target]);
const server = new OwnedServer(loaded, target, { ...server1201(target, loaded.config.targets[target]), capabilities: ['dedicated-server', 'world-observation'] }, join(session, 'game'), join(session, 'game-logs'));
const controller = new AbortController();
process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
let stage = ids[0];
try {
  await server.prepare(artifacts, runRoot, controller.signal);
  const properties = join(server.directory, 'server.properties');
  writeFileSync(properties, readFileSync(properties, 'utf8').replace('level-type=minecraft:flat', 'level-type=minecraft:normal').replace('difficulty=peaceful', 'difficulty=normal'));
  mkdirSync(join(server.directory, 'world/datapacks'), { recursive: true });
  cpSync(join(root, metadata.fixture), join(server.directory, 'world/datapacks/atlas'), { recursive: true });
  if (metadata.loader === 'forge') cpSync(join(root, 'fixtures/forge-observation-1.20.1'), join(server.directory, 'world/datapacks/atlas'), { recursive: true });
  cpSync(join(root, 'fixtures/scripts'), join(server.directory, 'scripts'), { recursive: true });
  await server.start(controller.signal); await server.waitReady();
  const capture = async (label: string) => {
    const mark = server.mark(); server.command(`craftatlas dump ${label}`);
    await server.waitForOutput(new RegExp(`CRAFTATLAS COMPLETE label=${label} `), 180000, mark);
    const snapshot = readSnapshot(join(server.directory, 'craftatlas', label));
    if (snapshot.completion.status !== 'complete' || !snapshot.world) throw new RequiredUnsupported('Required world collection is absent or partial');
    return snapshot;
  };
  const before = await capture('before'); assert.equal(before.world!.observations?.length, 0);
  assert.ok(before.coverage.some(row => row.dataset === 'observation' && row.type === 'commands' && row.status === 'complete' && row.enumerated === 4));
  const directory = (label: string) => join(server.directory, 'craftatlas/observations', label);
  const observe = async (label: string, command: string) => {
    const mark = server.mark(); server.command(`craftatlas observe ${command.replace('{label}', label)}`);
    await server.waitForOutput(new RegExp(`CRAFTATLAS OBSERVATION (?:COMPLETE|FAILED) label=${label}(?: |$)`), 180000, mark);
    assert.ok(existsSync(join(directory(label), 'completion.json')), `Observation ${label} failed; see game logs`);
    const observation = readObservation1201(directory(label), before);
    assert.equal(observation.seed, '8675309'); assert.equal(observation.dimension, 'minecraft:overworld');
    assert.equal(observation.generator.type, 'minecraft:noise'); assert.equal(observation.player, null);
    return observation;
  };
  const loot = await observe('loot_probe', 'loot {label} atlas:probe 10');
  assert.equal(loot.trials, 10); assert.equal(loot.totals['minecraft:diamond'], 20);
  for (const sample of loot.samples) assert.equal(sample.outputs.find((output: any) => output.resource === 'minecraft:diamond')?.amount, 2);
  if (metadata.loader === 'forge') {
    assert.ok(before.coverage.some(row => row.dataset === 'loot' && row.type === 'runtime global modifiers in application order' && row.status === 'complete'));
    assert.ok(before.world!.lootModifiers.some(row => row.id === 'atlas:probe_bonus'));
    assert.equal(loot.totals['minecraft:emerald'], 10, 'Non-raw runtime API must apply Forge global modifiers');
    for (const sample of loot.samples) assert.equal(sample.outputs.find((output: any) => output.resource === 'minecraft:emerald')?.amount, 1);
  } else assert.equal(loot.totals['minecraft:emerald'], undefined);
  const empty = await observe('empty_probe', 'loot {label} atlas:empty 1'); assert.deepEqual(empty.totals, {});
  cases.push({ id: stage, status: 'passed', message: 'Registered deterministic and empty tables sampled through non-raw runtime API; manifests, seeds, totals and environment verified' });
  stage = ids[1];
  const block = await observe('block_probe', 'block {label} minecraft:stone minecraft:diamond_pickaxe 5');
  assert.equal(block.context.breakPerformed, false); assert.equal(block.context.blockEntity, null); assert.equal(block.totals['minecraft:cobblestone'], 5);
  assert.equal(block.context.tool.id, 'minecraft:diamond_pickaxe');
  const silk = await observe('silk_probe', 'block {label} minecraft:stone minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]} 1');
  assert.equal(silk.totals['minecraft:stone'], 1); assert.ok(silk.context.tool.tag, '1.20.1 tool NBT must survive capture');
  cases.push({ id: stage, status: 'passed', message: 'Stone tool and Silk Touch NBT contexts sampled; no actual break or item grant' });
  stage = ids[2];
  const entity = await observe('entity_probe', 'entity {label} minecraft:zombie 10');
  assert.equal(entity.samples.length, 10); assert.equal(entity.context.entityType, 'minecraft:zombie');
  assert.equal(entity.context.entitySpawned, false); assert.equal(entity.context.deathPerformed, false);
  assert.equal(entity.context.damageSource, 'generic'); assert.ok(entity.context.entityState);
  cases.push({ id: stage, status: 'passed', message: 'Unspawned living entity and console damage context captured; probabilistic drop amounts are not asserted' });
  stage = ids[3];
  const natural = await observe('world_probe', 'world {label} 0 0 31');
  assert.equal(natural.trials, 1); assert.equal(Object.values(natural.totals).reduce((sum: number, value) => sum + Number(value), 0), 8192);
  assert.ok(Object.keys(natural.totals).some(id => id !== 'block:minecraft:air'));
  const maximum = await observe('world_maximum', 'world {label} 1 0 63'); assert.equal(maximum.trials, 9);
  const after = await capture('after'); assert.equal(after.world!.observations?.length, 7);
  for (const observation of [loot, empty, block, silk, entity, natural, maximum]) assert.deepEqual(after.world!.observations!.find((value: any) => value.id === observation.id), observation);
  const model = normalize(after); buildDatabase(join(session, 'world.sqlite'), model);
  const process = model.processes.find(process => process.id === 'observation:world_probe')!;
  assert.equal(process.execution, 'display'); assert.equal(process.interpretation, 'opaque');
  const scenario = { schemaVersion: 1 as const, id: 'observation-only', closed: false, inventory: {}, equipment: [], stages: [], dimensions: [], forbiddenProcesses: [], allowedTypes: ['minecraft:observation'], supply: 'finite' as const, closedResources: [], gameRules: {} };
  assert.notEqual(analyze(model, scenario, 'minecraft:diamond').status, 'reachable');
  assert.ok(after.coverage.some(row => row.dataset === 'observation' && row.type === 'finite samples' && row.status === 'partial' && row.enumerated === 7));
  cases.push({ id: stage, status: 'passed', message: '1 and 9 chunks with 32/64 height samples; exact volume, attachment and display-only normalization verified' });
  stage = ids[4];
  const rejected = [
    ['invalid_trials_zero', 'loot invalid_trials_zero atlas:probe 0'], ['invalid_trials_high', 'loot invalid_trials_high atlas:probe 1001'],
    ['invalid_radius', 'world invalid_radius 2 0 31'], ['invalid_span', 'world invalid_span 0 0 64'],
    ['invalid_reversed', 'world invalid_reversed 0 31 0'], ['invalid_height', 'world invalid_height 0 -65 -64'],
    ['invalid_overflow', 'world invalid_overflow 0 -2147483648 2147483647'],
    ['invalid_table', 'loot invalid_table atlas:missing 1'], ['invalid_context', 'loot invalid_context minecraft:entities/zombie 1'],
    ['invalid_type', 'entity invalid_type atlas:missing 1'], ['invalid_nonliving', 'entity invalid_nonliving minecraft:item 1'],
  ];
  for (const [label, command] of rejected) {
    const mark = server.mark(); server.command(`craftatlas observe ${command}`); server.command('craftatlas status');
    await server.waitForOutput(/CRAFTATLAS STATUS .*status=/, 180000, mark);
    assert.equal(existsSync(join(directory(label), 'completion.json')), false, label);
  }
  const originalHash = bytesHash(readFileSync(join(directory('loot_probe'), 'observation.json')));
  const duplicateMark = server.mark(); server.command('craftatlas observe loot loot_probe atlas:probe 1');
  await server.waitForOutput(/CRAFTATLAS OBSERVATION FAILED label=loot_probe/, 180000, duplicateMark);
  assert.equal(bytesHash(readFileSync(join(directory('loot_probe'), 'observation.json'))), originalHash);
  const invalidLabelMark = server.mark(); server.command('craftatlas observe loot .. atlas:probe 1'); server.command('craftatlas status');
  await server.waitForOutput(/CRAFTATLAS STATUS .*status=/, 180000, invalidLabelMark);
  assert.equal((await capture('after_rejections')).world!.observations?.length, 7);
  cases.push({ id: stage, status: 'passed', message: 'Trial/radius/height/overflow bounds, missing table/type/context, nonliving type, invalid label and overwrite refusal; no fabricated attachment' });
  stage = ids[5];
  const mark = server.mark(); server.command('craftatlas observe loot interrupted atlas:probe 1');
  await server.waitForOutput(/CRAFTATLAS OBSERVATION CAPTURED label=interrupted /, 180000, mark);
  server.command('craftatlas observe loot busy_probe atlas:probe 1'); server.command('reload');
  await server.waitForOutput(/Collector cannot observe while busy\/reloading\/stopped/, 180000, mark);
  await server.waitForOutput(/CRAFTATLAS RELOADING/, 180000, mark);
  await server.waitForOutput(/CRAFTATLAS RELOADED/, 180000, mark);
  await server.waitForOutput(/CRAFTATLAS OBSERVATION FAILED label=interrupted/, 180000, mark);
  assert.equal(existsSync(join(directory('interrupted'), 'completion.json')), false);
  assert.equal(existsSync(join(directory('busy_probe'), 'completion.json')), false);
  const staged = readdirSync(join(server.directory, 'craftatlas/observations')).filter(name => name.startsWith('interrupted.tmp-'));
  assert.equal(staged.length, 1); assert.equal(JSON.parse(readFileSync(join(directory(staged[0]), 'completion.json'), 'utf8')).status, 'failed');
  const changed = await capture('changed'); assert.equal(changed.session, before.session); assert.ok(changed.generation > before.generation);
  assert.deepEqual(changed.world!.observations, []);
  const freshMark = server.mark(); server.command('craftatlas observe loot fresh atlas:probe 1');
  await server.waitForOutput(/CRAFTATLAS OBSERVATION COMPLETE label=fresh /, 180000, freshMark);
  const fresh = readObservation1201(directory('fresh'), changed); assert.equal(fresh.totals['minecraft:diamond'], 2);
  assert.equal((await capture('fresh_capture')).world!.observations?.length, 1);
  writeFileSync(join(session, 'observation-evidence.json'), JSON.stringify({ loot, empty, block, silk, entity, natural, maximum, fresh, snapshot: after.id, rejected }, null, 2));
  cases.push({ id: stage, status: 'passed', message: 'Busy refusal, reload invalidation, failed staging, prior-generation detachment and fresh-generation acquisition verified' });
} catch (error) {
  process.stderr.write(String(error) + '\n');
  cases.push({ id: stage, status: error instanceof RequiredUnsupported ? 'unsupported' : error instanceof assert.AssertionError ? 'failed' : 'infrastructure-error', message: String(error) });
} finally {
  const stopped = await server.stop();
  cases.push({ id: 'atlas.world-stopped', status: stopped?.exitCode === 0 ? 'passed' : 'infrastructure-error', message: `Owned game exit ${stopped?.exitCode}` });
  for (const id of ids) if (!cases.some(c => c.id === id)) cases.push({ id, status: 'skipped', message: 'Prerequisite did not complete' });
  const evidence = await server.collectEvidence();
  writeFileSync(join(session, 'evidence.json'), JSON.stringify({ schemaVersion: 1, target, targetMetadata: metadata, artifacts, toolLockHash: bytesHash(readFileSync(join(root, 'harness.lock.json'))), inputs: ['probe', 'empty'].map(name => {
    const path = `${metadata.fixture}/data/atlas/loot_tables/${name}.json`; return { path, sha256: bytesHash(readFileSync(join(root, path))) };
  }), evidence: evidence.map(path => relative(runRoot, join(server.directory, path))), casesHash: hash(cases) }, null, 2));
  saveResults(session, cases);
}
