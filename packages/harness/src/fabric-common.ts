import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { normalize } from '../../core/src/normalize.ts';
import { audit } from '../../core/src/audit.ts';
import { hash } from '../../core/src/hash.ts';
import type { Snapshot, Process } from '../../core/src/types.ts';
function meaning(p: Process) {
  return { type: p.type, inputs: p.inputs.map(({ evidence, ...slot }) => slot), outputs: p.outputs.map(({ evidence, ...output }) => output), requirements: p.requirements.map(({ evidence, ...r }) => r), interpretation: p.interpretation, execution: p.execution, unknown: p.unknown, constraints: p.constraints ?? null };
}
/** The same checked-in datapack has identical meaning across loaders, without loader-specific Mods. */
export function verifyCommonFixture(snapshot: Snapshot, root: string) {
  const data = JSON.parse(readFileSync(join(root,'fixtures/datapack/data/atlas/recipe/added.json'),'utf8'));
  const scope = { ...structuredClone(snapshot), viewer:undefined, world:undefined,
    coverage: snapshot.coverage.filter(c=>['registry','tags','recipes'].includes(c.dataset)),
    recipes:snapshot.recipes.filter(r=>r.id==='atlas:added') };
  const expectedModel = normalize({ ...scope, recipes:[{id:'atlas:added',type:data.type,data}] });
  const actualModel = normalize(scope);
  const expected = expectedModel.processes.find(p => p.id==='atlas:added')!;
  const actual = actualModel.processes.find(p => p.id==='atlas:added'); assert.ok(actual);
  assert.equal(actual.interpretation,'supported'); assert.deepEqual(meaning(actual),meaning(expected));
  const tag = JSON.parse(readFileSync(join(root,'fixtures/datapack/data/atlas/tags/item/alternatives.json'),'utf8'));
  assert.deepEqual([...snapshot.tags['atlas:alternatives']].sort(),[...tag.values].sort());
  const checks = {schemaVersion:1 as const,recipes:['atlas:added','atlas:missing_contract'],nonemptyTags:['atlas:alternatives','atlas:missing_tag_contract'],supportedTypes:[],reachable:[],unreachable:[]};
  const diagnostics = audit(actualModel,checks);
  assert.deepEqual(diagnostics,audit(expectedModel,checks));
  assert.ok(diagnostics.some(d=>d.rule==='required-recipe' && d.target==='atlas:missing_contract' && d.status==='confirmed'));
  const common = {recipe:'atlas:added',semantic:meaning(actual),tag:snapshot.tags['atlas:alternatives'],
    diagnostics:diagnostics.map(({snapshotId,evidence,...diagnostic})=>diagnostic)};
  return { ...common,contentHash:hash(common) };
}
