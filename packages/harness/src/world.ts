import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadConfig } from '../../../node_modules/mc-dev-harness/dist/core/config.js';
import { OwnedServer } from '../../../node_modules/mc-dev-harness/dist/adapters/runtime/server.js';
import { normalize } from '../../core/src/normalize.ts';
import { readSnapshot } from '../../core/src/snapshot.ts';
import { buildDatabase } from '../../core/src/db.ts';
import { bytesHash, hash } from '../../core/src/hash.ts';
import { runArtifacts, saveResults, RequiredUnsupported } from './common.ts';
import type { Case } from './common.ts';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url))), session = resolve(process.argv[2]), runRoot = resolve(process.argv[3]), target = process.argv[4];
const ids = ['atlas.loot', 'atlas.worldgen', 'atlas.observation', 'atlas.world-stopped'], cases: Case[] = [];
const loaded = await loadConfig(root), artifacts = runArtifacts(runRoot, target), version = loaded.config.targets[target].loaderVersion!;
const controller = new AbortController(); process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
const server = new OwnedServer(loaded, target, { kind: 'server', capabilities: ['dedicated-server'],
  setup: { executable: '{java:game}', args: ['-jar', '{tool:neoforge-server-1.21.1}', '--installServer', '.'] },
  command: { executable: '{java:game}', args: ['-Xmx2G', `@libraries/net/neoforged/neoforge/${version}/{os}_args.txt`, 'nogui'] }, readyPattern: 'Done \\(.*\\)! For help',
}, join(session, 'game'), join(session, 'game-logs'));
let stage = ids[0];
try {
  await server.prepare(artifacts, runRoot, controller.signal);
  const properties = join(server.directory, 'server.properties');
  writeFileSync(properties, readFileSync(properties, 'utf8').replace('level-type=minecraft:flat', 'level-type=minecraft:normal').replace('generate-structures=false', 'generate-structures=true').replace('difficulty=peaceful', 'difficulty=normal').replace('gamemode=creative', 'gamemode=survival'));
  mkdirSync(join(server.directory, 'world/datapacks'), { recursive: true }); cpSync(join(root, 'fixtures/datapack'), join(server.directory, 'world/datapacks/atlas'), { recursive: true });
  cpSync(join(root, 'fixtures/scripts'), join(server.directory, 'scripts'), { recursive: true });
  await server.start(controller.signal); await server.waitReady();
  const capture = async (label: string) => {
    const mark = server.mark(); server.command(`craftatlas dump ${label}`); await server.waitForOutput(new RegExp(`CRAFTATLAS COMPLETE label=${label}`), 180000, mark);
    const s = readSnapshot(join(server.directory, 'craftatlas', label));
    if (s.completion.status !== 'complete' || !s.world) throw new RequiredUnsupported('Required world collection is absent or partial');
    return s;
  };
  const before = await capture('before'), model = normalize(before), world = before.world!;
  for (const [dataset, type] of [['loot', 'tables'], ['loot', 'runtime global modifiers in application order'], ['worldgen', 'applied biomes/spawns'], ['worldgen', 'configured/placed features'], ['worldgen', 'active dimension generators and biome membership']]) {
    const rows = before.coverage.filter(c => c.dataset === dataset && c.type === type);
    if (!rows.length || rows.some(c => c.status !== 'complete' || c.enumerated === null)) throw new RequiredUnsupported(`Required ${dataset}/${type} raw coverage is incomplete`);
  }
  assert.ok(world.lootTables.length > 100); assert.ok(world.lootSources.some(s => s.data && typeof s.data === 'object' && !Array.isArray(s.data) && s.data.kind === 'entity'));
  const probe = model.processes.find(p => p.id === 'loot:atlas:probe')!; assert.ok(probe); assert.equal(probe.outputs.find(o => o.resource === 'minecraft:diamond')?.amount, 2);
  const modifier = model.processes.find(p => p.id.startsWith('loot:atlas:probe:modifier:'))!; assert.ok(modifier); assert.equal(modifier.outputs[0].resource, 'minecraft:emerald'); assert.equal(modifier.outputs[0].amount, 1);
  cases.push({ id: stage, status: 'passed', message: `Applied tables=${world.lootTables.length}; actual ordered modifiers=${world.lootModifiers.length}; deterministic probe+post stage interpreted` });
  stage = 'atlas.worldgen';
  const overworld = world.dimensions.find(d => d.id === 'minecraft:overworld')!;
  assert.ok(overworld && overworld.data && typeof overworld.data === 'object' && !Array.isArray(overworld.data));
  const dimension = overworld.data as any; assert.equal(dimension.generator.type, 'minecraft:noise'); assert.ok(dimension.possibleBiomes.length > 0); assert.equal(dimension.seed, '8675309');
  assert.ok(model.processes.some(p => p.type === 'minecraft:worldgen' && p.id.includes('/atlas:marker_ore') && p.execution === 'unconfirmed'));
  assert.equal(model.processes.find(p => p.id === 'registry:placed_feature:atlas:registry_only')?.execution, 'display');
  assert.ok(world.biomes.some(b => (b.data as any)?.spawns?.spawners?.monster?.length));
  cases.push({ id: stage, status: 'passed', message: 'Normal noise generator, applied NeoForge biome feature, spawn settings and registry-only distinction verified' });
  stage = 'atlas.observation';
  const observe = async (label: string, command: string) => {
    const mark = server.mark(); server.command(`craftatlas observe ${command.replace('{label}', label)}`);
    await server.waitForOutput(new RegExp(`CRAFTATLAS OBSERVATION COMPLETE label=${label}`), 180000, mark);
    const directory = join(server.directory, 'craftatlas/observations', label), bytes = readFileSync(join(directory, 'observation.json'));
    const manifestBytes = readFileSync(join(directory, 'manifest.json')), manifest = JSON.parse(manifestBytes.toString()), completion = JSON.parse(readFileSync(join(directory, 'completion.json'), 'utf8')), observation = JSON.parse(bytes.toString());
    assert.equal(completion.status, 'complete'); assert.equal(completion.manifestHash, bytesHash(manifestBytes)); assert.equal(manifest.files['observation.json'], bytesHash(bytes)); assert.equal(manifest.contentHash, hash(observation));
    assert.equal(observation.session, before.session); assert.equal(observation.generation, before.generation); assert.equal(observation.seed, '8675309'); assert.equal(observation.generator.type, 'minecraft:noise'); assert.equal(observation.dimension, 'minecraft:overworld'); assert.equal(observation.environmentHash, hash(before.environment));
    assert.ok(observation.chunks.length > 0 && observation.limitations.length > 0); return observation;
  };
  const loot = await observe('loot_probe', 'loot {label} atlas:probe 10');
  assert.equal(loot.trials, 10); assert.equal(loot.samples.length, 10); assert.equal(loot.totals['minecraft:diamond'], 20); assert.equal(loot.totals['minecraft:emerald'], 10);
  for (const sample of loot.samples) { assert.equal(sample.outputs.find((o: any) => o.resource === 'minecraft:diamond')?.amount, 2); assert.equal(sample.outputs.find((o: any) => o.resource === 'minecraft:emerald')?.amount, 1); }
  const block = await observe('block_probe', 'block {label} minecraft:stone minecraft:diamond_pickaxe 5'); assert.equal(block.context.breakPerformed, false); assert.equal(block.totals['minecraft:cobblestone'], 5);
  const entity = await observe('entity_probe', 'entity {label} minecraft:zombie 10'); assert.equal(entity.context.deathPerformed, false); assert.equal(entity.samples.length, 10);
  const natural = await observe('world_probe', 'world {label} 0 0 31'); assert.equal(natural.trials, 1); assert.equal(Object.values(natural.totals).reduce((sum: number, value) => sum + Number(value), 0), 8192);
  assert.ok(Object.keys(natural.totals).some(id => id !== 'block:minecraft:air')); assert.equal(natural.chunks[0].minY, 0); assert.equal(natural.chunks[0].maxY, 31);
  const after = await capture('after'); assert.equal(after.world!.observations?.length, 4); const afterModel = normalize(after); buildDatabase(join(session, 'world.sqlite'), afterModel);
  assert.equal(afterModel.processes.find(p => p.id === 'observation:world_probe')?.execution, 'display');
  writeFileSync(join(session, 'observation-evidence.json'), JSON.stringify({ loot, block, entity, natural, capture: JSON.parse(readFileSync(join(server.directory, 'craftatlas/after/measurements.json'), 'utf8')), snapshot: after.id }, null, 2));
  cases.push({ id: stage, status: 'passed', message: 'Real post-loot sampling, block/entity contexts and bounded normal-generator chunk observation; SHA-256 publication checks verified' });
} catch (error) { process.stderr.write(String(error) + '\n'); cases.push({ id: stage, status: error instanceof RequiredUnsupported ? 'unsupported' : error instanceof assert.AssertionError ? 'failed' : 'infrastructure-error', message: String(error) }); }
finally {
  const stopped = await server.stop(); cases.push({ id: 'atlas.world-stopped', status: stopped?.exitCode === 0 ? 'passed' : 'infrastructure-error', message: `Owned game exit ${stopped?.exitCode}` });
  for (const id of ids) if (!cases.some(c => c.id === id)) cases.push({ id, status: 'skipped', message: 'Prerequisite did not complete' });
  const evidence = await server.collectEvidence(); writeFileSync(join(session, 'evidence.json'), JSON.stringify({ schemaVersion: 1, artifacts, packLockHash: bytesHash(readFileSync(join(root, 'fixtures/pack.lock.json'))), propertiesHash: existsSync(join(server.directory, 'server.properties')) ? bytesHash(readFileSync(join(server.directory, 'server.properties'))) : null, evidence, casesHash: hash(cases) }, null, 2)); saveResults(session, cases);
}
