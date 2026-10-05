import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync, gunzipSync } from 'node:zlib';
import { configureObservationWorld } from '../packages/harness/src/player-observation-1.20.1.ts';

test('disposable integrated-world permission changes touch only Data/allowCommands', () => {
  const directory = mkdtempSync(join(tmpdir(), 'atlas-player-world-'));
  try {
    const path = join(directory, 'level.dat');
    const named = (type: number, name: string, bytes: Buffer) => { const size = Buffer.alloc(2); size.writeUInt16BE(Buffer.byteLength(name)); return Buffer.concat([Buffer.from([type]), size, Buffer.from(name), bytes]); };
    const data = named(10, '', Buffer.concat([named(10, 'Data', Buffer.concat([
      named(1, 'allowCommands', Buffer.from([0])), named(10, 'other', Buffer.concat([named(1, 'allowCommands', Buffer.from([0])), Buffer.from([0])])),
      named(8, 'LevelName', Buffer.from([0, 5, ...Buffer.from('atlas')])), Buffer.from([0]),
    ])), Buffer.from([0])]));
    writeFileSync(path, gzipSync(data));
    const configured = configureObservationWorld(path, true), updated = gunzipSync(readFileSync(path));
    assert.equal(configured.previous, 0); assert.equal(configured.commandsAllowed, true);
    assert.equal(updated.length, data.length);
    assert.equal([...updated].filter((byte, index) => byte !== data[index]).length, 1);
    configureObservationWorld(path, false); assert.deepEqual(gunzipSync(readFileSync(path)), data);
    writeFileSync(path, gzipSync(named(10, '', Buffer.from([0]))));
    assert.throws(() => configureObservationWorld(path, true), /command flag missing/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
