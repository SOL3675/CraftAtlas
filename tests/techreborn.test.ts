import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../packages/core/src/normalize.ts';
import { normalizeTechReborn } from '../packages/core/src/techreborn.ts';
import { fixture } from './helpers.ts';
import { readFileSync } from 'node:fs';
import { applyDefinitions } from '../packages/core/src/definitions.ts';
import type { DefinitionPack } from '../packages/core/src/types.ts';
import type { Process, RawRecipe } from '../packages/core/src/types.ts';
const recipe: RawRecipe = { id:'techreborn:grinder/andesite_dust',type:'techreborn:grinder',data:{ ingredients:[{item:'minecraft:andesite',count:3}],outputs:[{id:'techreborn:andesite_dust',count:2}],power:4,time:270 } };
const snapshot = () => ({ ...fixture(),loader:'fabric',loaderVersion:'0.16.14',mods:[{id:'techreborn',version:'5.11.19'},{id:'reborncore',version:'5.11.19'}],recipes:[recipe] });
test('TechReborn fixed codec preserves quantities and base cost without claiming operating power',() => {
  const s = snapshot(); const p = normalize(s).processes.find(p=>p.id===recipe.id)!;
  assert.equal(p.interpretation,'supported'); assert.equal(p.inputs[0]!.amount,3); assert.equal(p.outputs[0]!.amount,2);
  assert.ok(p.costs.some(c=>c.kind==='base-energy' && c.amount===1080 && c.unit==='EU'));
  assert.ok(p.costs.some(c=>c.kind==='base-time' && c.amount===270));
  assert.ok(p.costs.some(c=>c.kind==='energy' && c.amount===null)); assert.ok(p.requirements.some(r=>r.kind==='opaque'));
});
test('TechReborn rejects unverified dependencies, predicates and invalid quantities',() => {
  const fresh = () => ({inputs:[],outputs:[],requirements:[],costs:[]} as unknown as Process);
  assert.throws(()=>normalizeTechReborn(fresh(),recipe,{...snapshot(),mods:[{id:'techreborn',version:'5.11.19'}]},'runtime:x'),/target/);
  assert.throws(()=>normalizeTechReborn(fresh(),{...recipe,data:{...recipe.data as object,ingredients:[{item:'minecraft:andesite',count:0}]}},snapshot(),'runtime:x'),/quantity/);
  assert.throws(()=>normalizeTechReborn(fresh(),{...recipe,data:{...recipe.data as object,ingredients:[{type:'custom:predicate'}]}},snapshot(),'runtime:x'),/predicate/);
  assert.equal(normalize({...snapshot(),mods:[{id:'techreborn',version:'5.11.20'}]}).processes.find(p=>p.id===recipe.id)!.interpretation,'opaque');
});
test('recorded real grinder codec and bundled definition keep raw facts and provenance',() => {
  const acquired = JSON.parse(readFileSync(new URL('../fixtures/techreborn-runtime.json',import.meta.url),'utf8'));
  const s = {...snapshot(),recipes:[acquired.recipe]};
  const base = normalize(s), p = base.processes.find(p=>p.id===recipe.id)!;
  assert.equal(p.inputs[0]!.amount,1); assert.equal(p.outputs[0]!.amount,2); assert.equal(p.costs.find(c=>c.kind==='base-energy')!.amount,1080);
  const pack = JSON.parse(readFileSync(new URL('../definitions/techreborn-5.11.19-fabric.json',import.meta.url),'utf8')) as DefinitionPack;
  const supplemented = applyDefinitions(base,[pack],{minecraft:'1.21.1',loader:'fabric'}).processes.find(p=>p.id===recipe.id)!;
  assert.deepEqual(supplemented.raw,acquired.recipe.data);
  assert.ok(supplemented.requirements.some(r=>r.id.includes('output inventory capacity') && r.evidence.some(e=>e.startsWith('definition:'))));
  assert.ok(supplemented.fieldHistory?.requirements?.length);
});
