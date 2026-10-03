import type { Snapshot, Scenario } from '../packages/core/src/types.ts';
export function fixture(): Snapshot {
  return {
    schemaVersion: 1, id: 'fixture', session: 'test-session', generation: 0, mode: 'dedicated', minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.252', collectorVersion: '0.1.0', mods: [{ id: 'minecraft', version: '1.21.1' }, { id: 'mekanism', version: '10.7.14' }], environment: { datapacks: ['vanilla', 'fixture'] },
    resources: ['dirt', 'cobblestone', 'stick', 'diamond', 'iron_ingot', 'gold_ingot'].map(id => ({ id: `minecraft:${id}`, kind: 'item', name: id, evidence: [] })).concat([{ id: 'mekanism:enrichment_chamber', kind: 'item', name: 'Enrichment chamber', evidence: [] }]),
    tags: { 'atlas:materials': ['minecraft:dirt', 'minecraft:cobblestone'], 'atlas:empty': [] },
    recipes: [
      { id: 'atlas:diamond', type: 'minecraft:crafting_shapeless', data: { type: 'minecraft:crafting_shapeless', ingredients: [{ tag: 'atlas:materials' }, { item: 'minecraft:stick' }], result: { id: 'minecraft:diamond', count: 2 } } },
      { id: 'mekanism:enriching/fixture', type: 'mekanism:enriching', data: { input: { item: 'minecraft:iron_ingot', count: 2 }, output: { id: 'minecraft:gold_ingot', count: 3 } } },
      { id: 'atlas:dynamic', type: 'minecraft:crafting_special_repairitem', data: { type: 'minecraft:crafting_special_repairitem' } },
    ],
    coverage: [{ dataset: 'recipes', type: '*', status: 'complete', enumerated: 3, interpreted: null, reasons: [] }, { dataset: 'loot', type: '*', status: 'unsupported', enumerated: null, interpreted: null, reasons: ['Phase 5'] }], completion: { status: 'complete', errors: [] },
  };
}
export function scenario(): Scenario { return { schemaVersion: 1, id: 'fixture-start', inventory: { 'minecraft:dirt': 8, 'minecraft:stick': 8 }, equipment: [], stages: [], dimensions: ['minecraft:overworld'], forbiddenProcesses: [], allowedTypes: null, supply: 'renewable', closed: false, closedResources: [], gameRules: {} }; }
