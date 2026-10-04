import { bytesHash, hash } from './hash.ts';
import type { DatapackData, DatapackResource, RawRecipe, Snapshot } from './types.ts';

/** Explicit supported version boundaries; custom directories have no guessed ID convention. */
export function recipeDirectory(minecraft: string): string | undefined {
  return minecraft === "1.20.1" ? "recipes" : minecraft === "1.21.1" ? "recipe" : undefined;
}
export function datapackRecipeId(resource: DatapackResource, minecraft = '1.21.1'): string | undefined {
  const directory = recipeDirectory(minecraft);
  if (!directory) return undefined;
  const match = new RegExp(`^([^:]+):${directory}/(.+)\\.json$`).exec(resource.id);
  return match ? `${match[1]}:${match[2]}` : undefined;
}
export function validateDatapack(data: DatapackData | undefined) {
  if (!data) return;
  if (new Set(data.resources.map(r => r.id)).size !== data.resources.length) throw new Error('Duplicate datapack resource ID');
  if (data.disabledPacks.some(id => data.selectedPacks.includes(id))) throw new Error('Datapack selected/disabled overlap');
  for (const resource of data.resources) for (const variant of [resource.effective, ...resource.stack]) {
    if (variant.text !== undefined && variant.bytesBase64 !== undefined) throw new Error('Ambiguous datapack bytes');
    const bytes = variant.text !== undefined ? Buffer.from(variant.text, 'utf8') : variant.bytesBase64 !== undefined ? Buffer.from(variant.bytesBase64, 'base64') : undefined;
    if (bytes && bytesHash(bytes) !== variant.sha256) throw new Error(`Datapack checksum mismatch: ${resource.id}`);
    if (!bytes && !variant.error) throw new Error(`Missing datapack bytes: ${resource.id}`);
    if (variant.error) { if (variant.data !== null) throw new Error(`Failed datapack parse has data: ${resource.id}`); continue; }
    if (variant.text === undefined || hash(JSON.parse(variant.text.replace(/^\uFEFF/, ''))) !== hash(variant.data)) throw new Error(`Datapack JSON mismatch: ${resource.id}`);
  }
}
export function capturedRecipes(s: Snapshot): { recipes: RawRecipe[]; sources: Map<string, DatapackResource>; dataOnly: Set<string> } {
  const recipes = [...s.recipes], ids = new Set(recipes.map(r => r.id));
  const sources = new Map<string, DatapackResource>(), dataOnly = new Set<string>();
  for (const resource of s.datapack?.resources ?? []) {
    const id = datapackRecipeId(resource, s.minecraft); if (!id) continue;
    sources.set(id, resource);
    if (ids.has(id)) continue;
    const variant = resource.effective;
    const type = variant.data && typeof variant.data === 'object' && !Array.isArray(variant.data) && typeof variant.data.type === 'string' && variant.data.type.length ? variant.data.type : 'craftatlas:uninterpretable';
    recipes.push({ id, type, data: variant.data, ...(variant.error ? { error: variant.error } : {}) });
    ids.add(id); dataOnly.add(id);
  }
  return { recipes, sources, dataOnly };
}
