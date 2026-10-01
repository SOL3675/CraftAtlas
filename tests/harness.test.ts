import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalize } from '../packages/core/src/normalize.ts';
import { evaluate } from '../packages/harness/src/evaluate.ts';
import { fixture } from './helpers.ts';
import type { Expectations } from '../packages/core/src/types.ts';
const empty = (): Expectations => ({ schemaVersion: 1, recipes: [], nonemptyTags: [], supportedTypes: [], reachable: [], unreachable: [] });
test('mandatory unknown coverage is unsupported; evaluated omissions fail; no expectations cannot pass', () => {
  const m = normalize(fixture()); assert.equal(evaluate(m, empty()).status, 'unsupported');
  assert.equal(evaluate(m, { ...empty(), supportedTypes: ['minecraft:crafting_special_repairitem'] }).status, 'unsupported');
  assert.equal(evaluate(m, { ...empty(), supportedTypes: ['mekanism:enriching'] }).status, 'unsupported');
  assert.equal(evaluate(m, { ...empty(), recipes: ['missing:recipe'] }).status, 'failed');
  assert.equal(evaluate(m, { ...empty(), recipes: ['atlas:diamond'] }).status, 'passed');
  m.coverage.find(c => c.dataset === 'recipes')!.status = 'failed'; assert.equal(evaluate(m, { ...empty(), recipes: ['missing:recipe'] }).status, 'unsupported');
});
