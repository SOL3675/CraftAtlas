import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { McPilotRuntimeAdapter } from 'craft-foundry/adapters/runtime/mc-pilot';
import { bytesHash } from '../../core/src/hash.ts';
import { readSnapshot } from '../../core/src/snapshot.ts';
import { readObservation1201 } from './observation-1.20.1.ts';
import { waitFor } from './common.ts';

/** Change only the command flag in this runner's newly copied, disposable world. */
export function configureObservationWorld(path: string, enabled: boolean) {
  const original = readFileSync(path), data = gunzipSync(original);
  let cursor = 0, commandOffset = -1;
  const string = () => { const size = data.readUInt16BE(cursor); cursor += 2; const value = data.toString('utf8', cursor, cursor + size); cursor += size; return value; };
  const payload = (type: number, names: string[]) => {
    if (names.join('/') === 'Data/allowCommands') { assert.equal(type, 1); assert.equal(commandOffset, -1); commandOffset = cursor; }
    if ([1, 2, 3, 4, 5, 6].includes(type)) cursor += ({ 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 } as Record<number, number>)[type];
    else if (type === 8) string();
    else if ([7, 11, 12].includes(type)) { const size = data.readInt32BE(cursor); assert.ok(size >= 0); cursor += 4 + size * (type === 7 ? 1 : type === 11 ? 4 : 8); }
    else if (type === 9) { const child = data.readUInt8(cursor++), size = data.readInt32BE(cursor); cursor += 4; assert.ok(size >= 0 && size <= data.length); for (let i = 0; i < size; i++) payload(child, [...names, String(i)]); }
    else if (type === 10) { for (;;) { const child = data.readUInt8(cursor++); if (!child) break; payload(child, [...names, string()]); } }
    else throw new Error(`Unsupported NBT tag ${type}`);
    assert.ok(cursor <= data.length, 'Truncated world NBT');
  };
  assert.equal(data.readUInt8(cursor++), 10); string(); payload(10, []);
  assert.equal(cursor, data.length); assert.ok(commandOffset >= 0, 'World command flag missing');
  const previous = data[commandOffset]; assert.ok(previous === 0 || previous === 1);
  data[commandOffset] = enabled ? 1 : 0; writeFileSync(path, gzipSync(data));
  return { originalHash: bytesHash(original), modifiedHash: bytesHash(readFileSync(path)), commandsAllowed: enabled, previous };
}

export async function verifyPlayerObservations(adapter: McPilotRuntimeAdapter, clientDir: string, session: string, dump: (label: string) => Promise<void>, denied: boolean) {
  const record: Record<string, any> = { permission: denied ? 'denied' : 'operator', commands: [] };
  const command = async (text: string) => { record.commands.push({ text, result: await adapter.control('chat.command', { command: text }) }); };
  const labels = ['player_block', 'player_silk', 'player_entity', 'player_world'];
  const requests = [
    'block player_block minecraft:stone minecraft:diamond_pickaxe 5',
    'block player_silk minecraft:stone minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]} 1',
    'entity player_entity minecraft:zombie 10', 'world player_world 0 0 31',
  ];
  if (denied) { labels.push('player_loot'); requests.push('loot player_loot atlas:probe 1'); }
  const observationRoot = join(clientDir, 'craftatlas/observations');
  try {
    if (!denied) {
      for (const text of ['gamemode creative', 'gamerule doMobSpawning false', 'setblock 0 149 0 minecraft:stone', 'tp @s 0.5 150 0.5', 'clear @s',
        'item replace entity @s weapon.mainhand with minecraft:diamond_pickaxe{Enchantments:[{id:"minecraft:silk_touch",lvl:1s}]}',
        'attribute @s minecraft:generic.luck base set 2']) await command(text);
      await waitFor('Player setup applied', () => adapter.control('inventory.held') as Promise<any>, value => JSON.stringify(value).includes('diamond_pickaxe'), 30000);
      await waitFor('Player on observation platform', () => adapter.control('position.get') as Promise<any>, value => value.x === 0.5 && value.y === 150 && value.z === 0.5 && value.onGround, 30000);
    }
    record.before = { inventory: await adapter.control('inventory.get'), entities: await adapter.control('entity.list', { radius: 32 }),
      position: await adapter.control('position.get'), status: await adapter.control('status.all') };
    if (!denied) record.before.block = await adapter.control('block.get', { x: 0, y: 149, z: 0 });
    await adapter.control('chat.clear');
    for (let i = 0; i < requests.length; i++) {
      await command('craftatlas observe ' + requests[i]);
      if (denied) {
        const response = await waitFor('Observation permission denied', () => adapter.control('chat.history', { last: 20 }),
          value => /Unknown or incomplete command|Incorrect argument|permission/i.test(JSON.stringify(value)), 30000);
        record[`denied-${labels[i]}`] = response;
        assert.equal(existsSync(join(observationRoot, labels[i], 'completion.json')), false);
        await adapter.control('chat.clear');
      } else await waitFor('Player observation published', () => existsSync(join(observationRoot, labels[i], 'completion.json')), Boolean, 180000);
    }
    record.after = { inventory: await adapter.control('inventory.get'), entities: await adapter.control('entity.list', { radius: 32 }),
      position: await adapter.control('position.get'), status: await adapter.control('status.all') };
    if (!denied) { record.after.block = await adapter.control('block.get', { x: 0, y: 149, z: 0 }); assert.deepEqual(record.after.block, record.before.block, 'Sampling must not break the actual block'); }
    assert.deepEqual(record.after.inventory, record.before.inventory, 'Sampling must not grant inventory items');
    const existingEntities = new Map(record.before.entities.entities.map((entity: any) => [entity.uuid, entity.type]));
    for (const entity of record.after.entities.entities) {
      // In the denied world, natural animals can walk into the query radius while
      // commands are rejected. Check the requested entity and dropped-item types.
      // The enabled world uses an isolated platform and checks every nearby type.
      if (!denied || ['minecraft:zombie', 'minecraft:item'].includes(entity.type))
        assert.equal(existingEntities.get(entity.uuid), entity.type, 'Sampling must not spawn entities');
    }
    const label = denied ? 'permission_denied' : 'player_observations'; await dump(label);
    const path = join(clientDir, 'craftatlas', label);
    await waitFor('Player observation viewer dump', () => existsSync(join(path, 'completion.json')), Boolean, 180000);
    const snapshot = readSnapshot(path); assert.equal(snapshot.completion.status, 'complete'); assert.ok(snapshot.viewer);
    assert.equal(snapshot.viewer.session, snapshot.session); assert.equal(snapshot.viewer.generation, snapshot.generation);
    assert.equal(snapshot.world?.observations?.length, denied ? 0 : 4);
    record.capture = { id: snapshot.id, session: snapshot.session, generation: snapshot.generation, viewer: snapshot.viewer.kind };
    if (!denied) {
      const observations = labels.map(label => readObservation1201(join(observationRoot, label), snapshot)); record.observations = observations;
      for (const observation of observations) {
        assert.ok(observation.player?.uuid); assert.equal(observation.player.gameMode, 'creative'); assert.equal(observation.player.luck, 2);
        assert.equal(observation.dimension, 'minecraft:overworld'); assert.deepEqual(observation.position, [0.5, 150, 0.5]);
        assert.deepEqual(observation.position, [record.before.position.x, record.before.position.y, record.before.position.z]);
        assert.equal(observation.dimension, record.before.status.world.dimension);
        assert.equal(observation.player.gameMode, record.before.status.gamemode.gameMode);
        assert.deepEqual(snapshot.world!.observations!.find((value: any) => value.id === observation.id), observation);
      }
      const [block, silk, entity] = observations;
      assert.equal(block.context.tool.id, 'minecraft:diamond_pickaxe'); assert.equal(block.totals['minecraft:cobblestone'], 5);
      assert.equal(block.context.breakPerformed, false); assert.equal(silk.totals['minecraft:stone'], 1);
      assert.match(JSON.stringify(silk.context.tool.tag), /minecraft:silk_touch/);
      assert.equal(entity.context.lastDamagePlayer, entity.player.uuid); assert.equal(entity.context.damageSource, 'player'); assert.equal(entity.context.lootLuck, 2);
      assert.equal(entity.context.entitySpawned, false); assert.equal(entity.context.deathPerformed, false);
      assert.equal(entity.context.tool.id, 'minecraft:diamond_pickaxe'); assert.match(JSON.stringify(entity.context.tool.tag), /minecraft:silk_touch/);
      await command('data get entity @s UUID');
      record.playerUuid = await waitFor('Actual player UUID feedback', () => adapter.control('chat.history', { last: 20 }), value => /\[I;/.test(JSON.stringify(value)), 30000);
      const integers = JSON.stringify(record.playerUuid).match(/\[I;\s*(-?\d+),\s*(-?\d+),\s*(-?\d+),\s*(-?\d+)\]/);
      assert.ok(integers); const uuidBytes = Buffer.alloc(16); integers.slice(1).forEach((value, index) => uuidBytes.writeInt32BE(Number(value), index * 4));
      assert.equal(entity.player.uuid.replaceAll('-', ''), uuidBytes.toString('hex'));
    }
    return record;
  } finally { writeFileSync(join(session, 'player-observation-evidence.json'), JSON.stringify(record, null, 2)); }
}
