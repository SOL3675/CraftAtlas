import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesHash, hash } from '../../core/src/hash.ts';
import { validate } from '../../core/src/validate.ts';
import type { Snapshot } from '../../core/src/types.ts';

/** Publication checks against real game output; offline fixtures only test the reader. */
export function readObservation1201(directory: string, snapshot: Snapshot) {
  const bytes = readFileSync(join(directory, 'observation.json'));
  const manifestBytes = readFileSync(join(directory, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes.toString());
  const completion = JSON.parse(readFileSync(join(directory, 'completion.json'), 'utf8'));
  const observation = validate<any>('observation-1.20.1', JSON.parse(bytes.toString()));
  assert.equal(completion.status, 'complete'); assert.deepEqual(completion.errors, []);
  assert.equal(completion.manifestHash, bytesHash(manifestBytes));
  assert.equal(manifest.schemaVersion, 1);
  assert.deepEqual(Object.keys(manifest.files), ['observation.json']);
  assert.equal(manifest.files['observation.json'], bytesHash(bytes));
  assert.equal(manifest.contentHash, hash(observation));
  for (const key of ['id', 'session', 'generation']) {
    assert.equal(manifest[key], observation[key], `Manifest ${key}`);
  }
  assert.equal(completion.id, observation.id);
  for (const key of ['session', 'generation', 'minecraft', 'loader', 'loaderVersion']) {
    assert.equal(observation[key], snapshot[key as keyof Snapshot], `Observation ${key}`);
  }
  assert.equal(observation.environmentHash, hash(snapshot.environment));
  const totals: Record<string, number> = {};
  const add = (id: string, amount: number) => { totals[id] = (totals[id] ?? 0) + amount; };
  if (observation.kind === 'loot') {
    assert.equal(observation.samples.length, observation.trials);
    observation.samples.forEach((sample: any, trial: number) => {
      assert.equal(sample.trial, trial); assert.notEqual(BigInt(sample.randomSeed), 0n);
      sample.outputs.forEach((output: any) => add(output.resource, output.amount));
    });
  } else {
    assert.equal(observation.chunks.length, observation.trials);
    assert.equal(new Set(observation.chunks.map((chunk: any) => `${chunk.x},${chunk.z}`)).size, observation.trials);
    for (const chunk of observation.chunks) {
      const height = chunk.maxY - chunk.minY + 1;
      assert.ok(height > 0 && height <= 64);
      assert.equal(Object.values(chunk.blockCounts).reduce((sum: number, value) => sum + Number(value), 0), height * 256);
      Object.entries(chunk.blockCounts).forEach(([id, amount]) => add(id, Number(amount)));
    }
  }
  assert.deepEqual(observation.totals, totals, 'Totals must equal recorded trial/chunk results');
  return observation;
}
