import assert from 'node:assert/strict';
import { normalize } from '../../core/src/normalize.ts';
import type { Snapshot } from '../../core/src/types.ts';

/** These assertions require a real game capture; offline tests do not execute this boundary. */
export function verify1201(snapshot: Snapshot) {
  assert.equal(snapshot.minecraft, '1.20.1');
  const data = snapshot.datapack; assert.ok(data); assert.ok(data.directories.includes('recipes'));
  assert.ok(data.resources.length > 100);
  const embedded = data.resources.find(r => r.id === 'atlasfixture:recipes/embedded.json'); assert.ok(embedded);
  assert.equal((embedded.effective.data as any).result.count, 4);
  assert.ok(embedded.stack.some(v => (v.data as any)?.result?.count === 2 && v.source !== embedded.effective.source), 'Mod-embedded lower variant must survive world override');
  assert.ok(data.resources.some(r => r.id === 'atlasfixture:machines/press.json'));
  const model = normalize(snapshot);
  assert.equal(model.processes.find(p => p.id === 'atlasfixture:source_only')?.execution, 'unconfirmed');
  assert.equal(model.processes.find(p => p.id === 'atlasfixture:source_only')?.interpretation, 'opaque');
  assert.deepEqual(model.processes.find(p => p.id === 'atlasfixture:source_only')?.outputs, [], 'Unknown serializer source fields must not become executable outputs');
  assert.ok(!snapshot.recipes.some(r => r.id === 'atlasfixture:source_only'));
  assert.ok(snapshot.recipes.some(r => r.id === 'craftatlas:runtime_only' && r.serialization?.sha256));
  assert.ok(model.diagnostics.some(d => d.rule === 'recipe-resource-missing' && d.target === 'craftatlas:runtime_only'));
  assert.ok(snapshot.coverage.some(c => c.dataset === 'datapack' && c.status === 'complete'));
  assert.ok(snapshot.coverage.some(c => c.dataset === 'recipeSerialization' && c.status === 'unsupported'), 'Dynamic vanilla serializers must not acquire invented JSON');
  const observation = snapshot.coverage.find(c => c.dataset === 'observation' && c.type === 'commands');
  assert.equal(observation?.status, 'unsupported', '1.20.1 finite observations must stay explicitly unsupported');
  assert.ok(observation.reasons.some(reason => reason.includes('not implemented')));
  assert.deepEqual(snapshot.world?.observations, [], 'Unsupported observation commands must not produce simulated evidence');
  const conditional = model.processes.find(p => p.id === 'atlasfixture:conditional'); assert.ok(conditional);
  if (snapshot.loader === 'forge') assert.equal(conditional.execution, 'unconfirmed', 'Forge false condition is source-only');
  return { resources: data.resources.length, recipes: snapshot.recipes.length, selectedPacks: data.selectedPacks,
    loadedPacks: data.loadedPacks, disabledPacks: data.disabledPacks,
    embedded: { source: embedded.effective.source, stack: embedded.stack.map(v => ({ source: v.source, sha256: v.sha256 })) },
    runtimeOnly: 'craftatlas:runtime_only', sourceOnly: 'atlasfixture:source_only', conditionalExecution: conditional.execution,
    observation };
}

/** Check quantity and correspondence against the actual fixture, independently of viewer display hints. */
export function verify1201Viewer(snapshot: Snapshot) {
  const viewer = snapshot.viewer; assert.ok(viewer);
  assert.equal(new Set(viewer.recipes.map(recipe => recipe.id)).size, viewer.recipes.length, 'Viewer entry identities must be unique');
  const quantities = ['minecraft:stick', 'atlasfixture:embedded'].map(id => {
    const runtime = snapshot.recipes.find(recipe => recipe.id === id); assert.ok(runtime);
    const process = normalize(snapshot).processes.find(process => process.id === id); assert.ok(process);
    const entries = viewer.recipes.filter(recipe => recipe.recipeId === id); assert.ok(entries.length > 0, `Viewer must retain backing runtime identity ${id}`);
    for (const entry of entries) {
      assert.equal(entry.execution, 'unconfirmed');
      assert.ok(entry.inputs.some(input => input.amount === 1 && input.unit === 'item' && input.alternatives.some(alternative => alternative.resource === 'minecraft:dirt')));
      assert.ok(entry.outputs.some(output => output.resource === 'minecraft:stick' && output.unit === 'item' && output.amount === process.outputs[0].amount && output.probability === null), 'Viewer must retain actual quantity without inferring probability');
    }
    return { recipeId: id, entryIds: entries.map(entry => entry.id), amount: process.outputs[0].amount, unit: 'item', execution: 'unconfirmed' };
  });
  return { kind: viewer.kind, recipes: viewer.recipes.length, quantities };
}
