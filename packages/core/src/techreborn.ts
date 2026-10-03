import type { Alternative, Process, RawRecipe, Snapshot } from './types.ts';

/** RebornCore 5.11.19 RebornRecipe/SizedIngredient codecs; every unsupported shape fails closed. */
export const techRebornAdapter = {
  id: 'techreborn-grinder', version: '1', minecraft: ['1.21.1'], loaders: ['fabric'],
  mod: 'techreborn', versions: ['5.11.19'], types: ['techreborn:grinder'],
  limitations: ['other TechReborn machine types', 'actual upgrades and power availability', 'components and custom ingredients'],
};
export function normalizeTechReborn(p: Process, recipe: RawRecipe, snapshot: Snapshot, evidence: string): void {
  if (recipe.type !== 'techreborn:grinder') throw new Error('Unsupported TechReborn machine type');
  if (snapshot.minecraft !== '1.21.1' || snapshot.loader !== 'fabric' || !snapshot.mods.some(m => m.id === 'techreborn' && m.version === '5.11.19') || !snapshot.mods.some(m => m.id === 'reborncore' && m.version === '5.11.19')) throw new Error('Unsupported TechReborn/RebornCore target');
  const data = recipe.data as Record<string, any> | null;
  if (!data || !Array.isArray(data.ingredients) || !data.ingredients.length || !Array.isArray(data.outputs) || !data.outputs.length) throw new Error('Invalid grinder ingredients/outputs');
  const positive = (n: unknown): n is number => Number.isSafeInteger(n) && Number(n) > 0;
  const alternatives = (value: any): Alternative[] => {
    if (Array.isArray(value)) return value.flatMap(alternatives);
    if (!value || typeof value !== 'object' || Object.keys(value).some(k => !['item', 'tag', 'count'].includes(k))) throw new Error('Unsupported grinder ingredient predicate/components');
    if (typeof value.item === 'string' && !value.tag) return [{ resource: value.item }];
    if (typeof value.tag === 'string' && !value.item) return [{ tag: value.tag, members: snapshot.tags[value.tag] ?? [] }];
    throw new Error('Missing grinder ingredient selector');
  };
  for (const ingredient of data.ingredients) {
    const amount = ingredient.count ?? 1;
    if (!positive(amount)) throw new Error('Invalid grinder input quantity');
    const choices = alternatives(ingredient); if (!choices.length) throw new Error('Empty grinder alternatives');
    p.inputs.push({ alternatives: choices, amount, unit: 'item', consumption: 'consumed', evidence: [evidence] });
  }
  for (const [index, result] of data.outputs.entries()) {
    if (!result || typeof result.id !== 'string' || !positive(result.count ?? 1) || Object.keys(result).some(k => !['id', 'count', 'components'].includes(k))) throw new Error('Invalid grinder output');
    if (result.components && Object.keys(result.components).length) throw new Error('Output component matching is unsupported');
    p.outputs.push({ resource: result.id, amount: result.count ?? 1, unit: 'item', role: index === 0 ? 'primary' : 'byproduct', probability: 1, evidence: [evidence] });
  }
  if (!positive(data.power) || !positive(data.time)) throw new Error('Invalid grinder power/time');
  if (!positive(data.power * data.time)) throw new Error('Grinder base energy exceeds exact numeric range');
  p.requirements.push({ kind: 'equipment', id: 'techreborn:grinder', evidence: [evidence] }, { kind: 'opaque', id: 'TechReborn power availability, machine upgrades and configuration', evidence: [evidence] });
  // RecipeCrafter invokes getEuPerTick(recipe.power()) then increments one tick only after tryUseExact.
  // Upgrades alter both rate and needed ticks, so only the base recipe figures are exact here.
  p.costs.push({ kind: 'base-energy', amount: data.power * data.time, unit: 'EU', basis: 'RebornCore5.11.19 recipe.power() EU/tick * recipe.time() ticks; complete recipe before upgrades' },
    { kind: 'base-time', amount: data.time, unit: 'tick', basis: 'RebornCore5.11.19 recipe.time(); before speed multiplier' },
    { kind: 'energy', amount: null, unit: 'EU', basis: 'Operating upgrades/configuration and supplied power not acquired' },
    { kind: 'time', amount: null, unit: 'tick', basis: 'Operating upgrades and power interruptions not acquired' });
}
