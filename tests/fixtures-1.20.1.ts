import { fixture } from './helpers.ts';
import { bytesHash } from '../packages/core/src/hash.ts';
import type { DatapackVariant, Json, Snapshot } from '../packages/core/src/types.ts';

export function snapshot1201(loader: 'forge' | 'fabric'): Snapshot {
  const s = fixture(); s.id = `fixture-${loader}-1.20.1`; s.minecraft = '1.20.1'; s.loader = loader;
  s.loaderVersion = loader === 'forge' ? '47.3.0' : '0.16.14';
  s.mods = [{ id: 'atlasfixture', version: '1.0.0' }];
  const data = { type: 'minecraft:crafting_shapeless', ingredients: [{ item: 'minecraft:dirt' }], result: { item: 'minecraft:diamond', count: 2 } };
  const serialization = { encoding: 'recipe-network-1.20.1' as const, bytesBase64: 'AAEC', sha256: bytesHash(Buffer.from([0, 1, 2])), limitations: ['Synthetic serializer bytes; not a Minecraft execution'] };
  s.recipes = [{ id: 'atlas:diamond', type: data.type, data, serialization },
    { id: 'atlas:runtime_only', type: 'atlas:custom', data: null, serialization }];
  const variant = (source: string, data: Json): DatapackVariant => { const text = JSON.stringify(data); return { source, text, data: structuredClone(data), sha256: bytesHash(Buffer.from(text)) }; };
  const low = variant('mod/embedded', { ...data, result: { item: 'minecraft:diamond', count: 1 } });
  const high = variant('file/override', data);
  const custom = variant('mod/embedded', { type: 'atlas:opaque', inputs: ['minecraft:dirt'], result: { item: 'minecraft:diamond' } });
  const conditional = variant('mod/embedded', { ...data, 'forge:conditions': [{ type: 'forge:false' }] });
  s.datapack = { directories: ['recipes', 'machines'], selectedPacks: ['vanilla', 'mod:atlasfixture', 'file/override'], loadedPacks: ['vanilla', 'mod/embedded', 'file/override'], disabledPacks: ['file/disabled'], resources: [
    { id: 'atlas:recipes/diamond.json', effective: high, stack: [low, high] },
    { id: 'atlas:recipes/source_only.json', effective: custom, stack: [custom] },
    { id: 'atlas:recipes/conditional.json', effective: conditional, stack: [conditional] },
    { id: 'atlas:machines/press.json', effective: custom, stack: [custom] },
  ], limitations: ['Offline contract fixture; no universal acquisition proof'] };
  s.coverage = [{ dataset: 'recipes', type: '*', status: 'complete', enumerated: 2, interpreted: null, reasons: [] },
    { dataset: 'datapack', type: 'recipes,machines', status: 'complete', enumerated: 4, interpreted: null, reasons: [] },
    { dataset: 'recipeSerialization', type: 'atlas:runtime_only', status: 'unsupported', enumerated: 1, interpreted: null, reasons: ['Custom runtime JSON encoder unavailable; network bytes retained'] }];
  return s;
}
