import assert from 'node:assert/strict';
import { hash } from '../../core/src/hash.ts';
import type { Json, Snapshot } from '../../core/src/types.ts';

/** Required server-suite assertions; these only run after a real game dump. */
export function verifyDatapackFixture(snapshot: Snapshot, expectedStick: Json, embeddedMod: string) {
  const data = snapshot.datapack; assert.ok(data, 'Server collector must publish raw datapack.json');
  assert.ok(data.directories.includes('recipe'));
  assert.ok(data.resources.length > 100, 'Active recipes must be enumerated independently of a viewer');
  const stick = data.resources.find(r => r.id === 'minecraft:recipe/stick.json'); assert.ok(stick);
  assert.deepEqual(stick.effective.data, expectedStick);
  assert.ok(stick.stack.length >= 2, 'Vanilla and world override must both retain provenance');
  assert.ok(stick.stack.some(v => v.sha256 !== stick.effective.sha256));
  const embedded = data.resources.filter(r => r.id.startsWith(`${embeddedMod}:recipe/`));
  assert.ok(embedded.length > 0, `Raw embedded ${embeddedMod} recipe resources are required`);
  assert.ok(embedded.some(r => r.effective.source !== stick.effective.source), 'Mod pack provenance must survive a world override');
  assert.ok(snapshot.coverage.some(c => c.dataset === 'datapack' && c.status === 'complete'));
  return { resources: data.resources.length, embeddedResources: embedded.length, embeddedMod, selectedPacks: data.selectedPacks,
    loadedPacks: data.loadedPacks, disabledPacks: data.disabledPacks, stick: { source: stick.effective.source, sha256: stick.effective.sha256,
      stack: stick.stack.map(v => ({ source: v.source, sha256: v.sha256 })) }, rawDatasetHash: hash(data) };
}
