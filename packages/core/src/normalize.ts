import { hash } from './hash.ts';
import { processMeaning } from './diff.ts';
import { normalizeWorld } from './world.ts';
import { normalizeTechReborn, techRebornAdapter } from './techreborn.ts';
import { validateSnapshot, validateModel } from './validate.ts';
import { capturedRecipes, datapackRecipeId } from './datapack.ts';
import type { Alternative, Diagnostic, Json, Model, Process, RawRecipe, Slot, Snapshot } from './types.ts';
export const NORMALIZER_VERSION = '0.4.0';
export const adapters = [
  techRebornAdapter,
  { id: 'vanilla', version: '2', minecraft: ['1.21.1'], loaders: ['neoforge', 'fabric'], types: ['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking', 'minecraft:campfire_cooking', 'minecraft:stonecutting', 'minecraft:smithing_transform'], limitations: ['dynamic recipes', 'custom predicates'] },
  { id: 'vanilla', version: '2', minecraft: ['1.20.1'], loaders: ['forge', 'fabric'], types: ['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking', 'minecraft:campfire_cooking', 'minecraft:stonecutting', 'minecraft:smithing_transform'], limitations: ['dynamic recipes', 'custom predicates'] },
  { id: 'mekanism-enriching', version: '1', minecraft: ['1.21.1'], loaders: ['neoforge'], mod: 'mekanism', versions: ['10.7.14'], types: ['mekanism:enriching'], limitations: ['energy depends on machine upgrades/configuration', 'other Mekanism recipe types', 'chemical ingredients'] },
];
export function diagnostic(m: Pick<Model, 'snapshotId'>, rule: string, target: string, message: string, severity: Diagnostic['severity'] = 'warning', status: Diagnostic['status'] = 'confirmed', evidence: string[] = []): Diagnostic {
  return { id: hash({ rule, target }).slice(0, 24), rule, target, severity, status, scenario: null, message, evidence, path: [], unknown: [], snapshotId: m.snapshotId };
}
function alternatives(value: any, tags: Record<string, string[]>): Alternative[] {
  if (Array.isArray(value)) return value.flatMap(v => alternatives(v, tags));
  if (typeof value === 'string') return [{ resource: value }];
  if (value && typeof value === 'object') {
    if (value.type && !['minecraft:item', 'minecraft:tag'].includes(value.type)) return [{ predicate: value }];
    if (value.item) return [{ resource: value.item, ...(value.components ? { components: value.components } : {}), ...(value.nbt ? { components: { nbt: value.nbt } } : {}) }];
    if (value.tag) return [{ tag: value.tag, members: tags[value.tag] ?? [] }];
  }
  return [{ predicate: value ?? { unknown: true } }];
}
export function normalize(snapshot: Snapshot): Model {
  const s = validateSnapshot(snapshot);
  const m: Model = { schemaVersion: 1, snapshotId: s.id, session: s.session, generation: s.generation, normalizerVersion: NORMALIZER_VERSION, environment: s.environment, mods: s.mods, resources: structuredClone(s.resources), tags: structuredClone(s.tags), processes: [], evidence: [], coverage: structuredClone(s.coverage), diagnostics: [], contentHash: '' };
  if (s.datapack) m.datapack = structuredClone(s.datapack);
  const { recipes, sources, dataOnly } = capturedRecipes(s);
  const customResources = (s.datapack?.resources ?? []).filter(r => !datapackRecipeId(r, s.minecraft));
  if (customResources.length) m.coverage.push({ dataset: 'datapackInterpretation', type: 'custom-directories', status: 'unsupported', enumerated: customResources.length, interpreted: 0, reasons: ['Custom resource APIs and acquisition semantics have no adapter; raw capture cannot close acquisition coverage'] });
  for (const resource of s.datapack?.resources ?? []) {
    if (resource.effective.error) m.diagnostics.push(diagnostic(m, 'datapack-resource-error', resource.id, resource.effective.error, 'warning', 'unknown'));
    for (const [index, variant] of resource.stack.entries()) if (variant.error) m.diagnostics.push(diagnostic(m, 'datapack-resource-error', `${resource.id}/stack/${index}`, `${variant.source}: ${variant.error}`, 'warning', 'unknown'));
  }
  for (const kind of new Set(['item', 'fluid', ...s.resources.map(r => r.kind)])) m.evidence.push({ id: `runtime:registry:${kind}`, kind: 'runtime', source: s.id, adapter: `${s.loader}-registry-${s.minecraft}`, pointer: `resources/${kind}` });
  m.evidence.push({ id: 'runtime:tags', kind: 'runtime', source: s.id, adapter: `${s.loader}-tags-${s.minecraft}`, pointer: 'tags' });
  for (const r of recipes.sort((a, b) => a.id.localeCompare(b.id))) {
    const ev = dataOnly.has(r.id) ? `datapack:${r.id}` : `runtime:${r.id}`;
    const p: Process = { id: r.id, sourceId: r.id, type: r.type, inputs: [], outputs: [], requirements: [], evidence: [ev], interpretation: 'supported', execution: 'executable', unknown: [], enabled: true, costs: [], raw: r.serialization ? { data: r.data, serialization: { ...r.serialization } } : r.data, fieldEvidence: {}, conflicts: [] };
    const adapter = adapters.find(a => a.types.includes(r.type) && a.minecraft.includes(s.minecraft) && a.loaders.includes(s.loader) && (!('mod' in a) || s.mods.some(mod => mod.id === a.mod && a.versions?.includes(mod.version))));
    m.evidence.push({ id: ev, kind: 'runtime', source: s.id, adapter: dataOnly.has(r.id) ? `datapack-resource-${s.minecraft}` : adapter?.id ?? 'opaque', pointer: dataOnly.has(r.id) ? `datapack/resources/${sources.get(r.id)!.id}/effective` : `recipes/${r.id}` });
    if (sources.has(r.id) && !dataOnly.has(r.id)) {
      const source = sources.get(r.id)!;
      const sourceEvidence = `datapack:${r.id}`;
      m.evidence.push({ id: sourceEvidence, kind: 'runtime', source: s.id, adapter: `datapack-resource-${s.minecraft}`, pointer: `datapack/resources/${source.id}/effective` });
      p.evidence.push(sourceEvidence); p.fieldEvidence.datapack = [sourceEvidence];
      if (source.effective.error) p.unknown.push(`Datapack resource error: ${source.effective.error}`);
      const sourceData = source.effective.data;
      if (sourceData && typeof sourceData === 'object' && !Array.isArray(sourceData) && typeof sourceData.type === 'string' && sourceData.type !== r.type) {
        p.conflicts.push('Datapack serializer differs from RecipeManager; runtime mutations or resource loading semantics are unknown');
        p.unknown.push(p.conflicts.at(-1)!);
        m.diagnostics.push(diagnostic(m, 'datapack-runtime-conflict', r.id, p.conflicts.at(-1)!, 'warning', 'unknown', p.evidence));
      }
    } else if (!dataOnly.has(r.id) && s.datapack) {
      m.diagnostics.push(diagnostic(m, 'recipe-resource-missing', r.id, 'RecipeManager entry has no captured recipe resource; may be runtime-only or outside the captured directories', 'info', 'unknown', [ev]));
    }
    try {
      if (dataOnly.has(r.id)) {
        p.execution = 'unconfirmed';
        m.diagnostics.push(diagnostic(m, 'recipe-runtime-missing', r.id, 'Captured recipe resource is absent from RecipeManager; registration and execution remain unconfirmed', 'info', 'unknown', [ev]));
        throw new Error('Resource is absent from RecipeManager; conditions, rejection or a custom recipe API may apply. Executability is unconfirmed');
      }
      if (!adapter || !r.data || r.error || r.serialization?.error) throw new Error(r.error ?? r.serialization?.error ?? 'Unsupported recipe type/version');
      const data = r.data as any;
      const add = (ingredient: any, amount = 1) => {
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid ingredient amount');
        p.inputs.push({ alternatives: alternatives(ingredient, s.tags), amount, unit: 'item', consumption: 'consumed', evidence: [ev] });
      };
      if (adapter.id === 'techreborn-grinder') normalizeTechReborn(p, r, s, ev);
      else if (r.type === 'minecraft:crafting_shaped') {
        if (!Array.isArray(data.pattern) || data.pattern.length < 1 || data.pattern.length > 3 || !data.pattern.every((row: unknown) => typeof row === 'string' && row.length >= 1 && row.length <= 3 && row.length === data.pattern[0].length) || !data.pattern.some((row: string) => row.trim())) throw new Error('Invalid crafting grid');
        let slotIndex = 0;
        p.constraints = { kind: 'shaped-grid', layout: data.pattern.map((row: string) => [...row].map(symbol => symbol === ' ' ? null : slotIndex++)) };
        for (const row of data.pattern) for (const symbol of row) if (symbol !== ' ') {
          if (!(symbol in data.key)) throw new Error(`Missing shaped key ${symbol}`); add(data.key[symbol]);
        }
      } else if (r.type === 'minecraft:crafting_shapeless') { if (!Array.isArray(data.ingredients) || data.ingredients.length < 1 || data.ingredients.length > 9) throw new Error('Invalid shapeless ingredients'); for (const ingredient of data.ingredients) add(ingredient); }
      else if (r.type === 'minecraft:smithing_transform') { add(data.template); add(data.base); add(data.addition); p.unknown.push(s.minecraft === '1.20.1' ? 'Output inherits base NBT' : 'Output inherits base components'); }
      else if (r.type === 'mekanism:enriching') {
        add(data.input.ingredient ?? data.input, data.input.count ?? data.input.amount ?? 1);
        p.requirements.push({ kind: 'equipment', id: 'mekanism:enrichment_chamber', evidence: [ev] }, { kind: 'opaque', id: 'Mekanism power supply and configured energy demand', evidence: [ev] });
        p.costs.push({ kind: 'energy', amount: null, unit: 'J', basis: 'unacquired configuration and upgrades' });
      }
      else add(data.ingredient);
      if (adapter.id !== 'techreborn-grinder') {
        const result = data.result ?? data.output;
        const resource = typeof result === 'string' ? result : result?.id ?? result?.item;
        if (!resource || !Number.isFinite(result?.count ?? data.count ?? 1) || (result?.count ?? data.count ?? 1) <= 0) throw new Error('Missing or invalid result');
        p.outputs.push({ resource, amount: result?.count ?? data.count ?? 1, unit: 'item', role: 'primary', probability: 1, evidence: [ev], ...(result?.components ? { components: result.components } : {}), ...(result?.nbt ? { components: { nbt: result.nbt } } : {}) });
      }
      const machine: Record<string, string> = { 'minecraft:smelting': 'minecraft:furnace', 'minecraft:blasting': 'minecraft:blast_furnace', 'minecraft:smoking': 'minecraft:smoker', 'minecraft:campfire_cooking': 'minecraft:campfire', 'minecraft:stonecutting': 'minecraft:stonecutter', 'minecraft:smithing_transform': 'minecraft:smithing_table', 'minecraft:crafting_shaped': 'minecraft:crafting_table', 'minecraft:crafting_shapeless': 'minecraft:crafting_table' };
      const smallCraft = r.type === 'minecraft:crafting_shapeless' && p.inputs.length <= 4 || r.type === 'minecraft:crafting_shaped' && data.pattern.length <= 2 && data.pattern.every((row: string) => row.length <= 2);
      if (machine[r.type] && !smallCraft) p.requirements.push({ kind: 'equipment', id: machine[r.type], evidence: [ev] });
      if (data.cookingtime) {
        p.costs.push({ kind: 'time', amount: data.cookingtime, unit: 'tick', basis: 'runtime-definition' });
        if (r.type !== 'minecraft:campfire_cooking') p.requirements.push({ kind: 'opaque', id: 'fuel supply and burn duration', evidence: [ev] });
      }
      const conditionKeys = ['neoforge:conditions', 'forge:conditions', 'fabric:load_conditions'];
      if (s.minecraft === '1.20.1' && s.loader === 'forge') conditionKeys.push('conditions');
      for (const key of conditionKeys) if (data[key]) p.requirements.push({ kind: 'opaque', id: JSON.stringify(data[key]), evidence: [ev] });
      if (s.minecraft === '1.20.1' && (data.result?.nbt || data.output?.nbt)) p.unknown.push('Output NBT is retained; NBT matching and mutations are not interpreted');
      for (const input of p.inputs) for (const a of input.alternatives) {
        if (a.predicate) p.unknown.push('Custom ingredient predicate');
        if (s.minecraft === '1.20.1' && a.components) p.unknown.push('Ingredient NBT/components matching is not interpreted');
        if (a.tag && !(a.tag in s.tags)) p.unknown.push(`Tag not acquired: ${a.tag}`);
        if (a.tag && !input.evidence.includes('runtime:tags')) input.evidence.push('runtime:tags');
      }
      // Remainders are retained as uncertainty until acquired from the item runtime API.
      if (p.inputs.some(i => i.alternatives.some(a => a.resource?.endsWith('_bucket')))) p.unknown.push('Container remainder not acquired');
    } catch (error) { p.interpretation = 'opaque'; p.execution = 'unconfirmed'; p.unknown.push(String(error)); p.inputs = []; p.outputs = []; }
    for (const key of ['inputs', 'outputs', 'requirements', 'costs']) p.fieldEvidence[key] = [ev];
    m.processes.push(p);
    if (p.interpretation === 'opaque' || p.unknown.length) m.diagnostics.push(diagnostic(m, 'unsupported-recipe', p.id, p.unknown.join('; '), 'warning', 'unknown', p.evidence));
  }
  m.coverage = m.coverage.filter(c => c.dataset !== 'normalization');
  for (const type of [...new Set(recipes.map(r => r.type))].sort()) {
    const processes = m.processes.filter(p => p.type === type);
    const missing = (p: Process) => [...p.unknown, ...p.requirements.filter(r => r.kind === 'opaque').map(r => `Opaque requirement: ${r.id}`), ...p.costs.filter(c => c.amount === null).map(c => `Cost not acquired: ${c.kind}`)];
    const interpreted = processes.filter(p => p.interpretation === 'supported' && !missing(p).length).length;
    m.coverage.push({ dataset: 'normalization', type, status: interpreted === processes.length ? 'complete' : 'partial', enumerated: processes.length, interpreted, reasons: [...new Set(processes.flatMap(missing))] });
  }
  normalizeWorld(m, s);
  if (s.viewer) mergeViewer(m, s);
  m.contentHash = semanticHash(m); return validateModel(m);
}
export function semanticHash(m: Model): string {
  return hash({ version: m.normalizerVersion, ...(m.datapack ? { datapack: m.datapack } : {}), environment: m.environment, mods: [...m.mods].sort((a, b) => a.id.localeCompare(b.id)), resources: [...m.resources].sort((a, b) => a.id.localeCompare(b.id)).map(({ evidence, ...r }) => r), tags: Object.fromEntries(Object.entries(m.tags).sort().map(([k, v]) => [k, [...v].sort()])), processes: [...m.processes].sort((a, b) => a.id.localeCompare(b.id)).map(processMeaning), coverage: [...m.coverage].sort((a, b) => (a.dataset + a.type).localeCompare(b.dataset + b.type)) });
}
function mergeViewer(m: Model, s: Snapshot) {
  const viewer = s.viewer!;
  const viewerKind = viewer.kind ?? 'jei';
  const serverProcesses = [...m.processes], byId = new Map(serverProcesses.map(p => [p.sourceId, p]));
  const byOutput = new Map<string, string[]>();
  for (const p of serverProcesses) {
    const key = hash(p.outputs.map(o => [o.resource, o.amount]));
    const values = byOutput.get(key) ?? []; values.push(p.id); byOutput.set(key, values);
  }
  for (const v of viewer.recipes) {
    const ev = `viewer:${v.id}`; m.evidence.push({ id: ev, kind: 'viewer', source: s.id, adapter: `${viewerKind}-${viewer.version ?? (viewerKind === 'jei' ? '19.22.1.316' : 'unrecorded')}`, pointer: `viewer/${v.id}` });
    const p = v.recipeId && !v.unknown.some(u => /correspondence is ambiguous/.test(u)) ? byId.get(v.recipeId) : undefined;
    if (p) {
      (p.viewerSources ??= []).push(structuredClone(v));
      p.evidence.push(ev); p.fieldEvidence.viewer = [ev];
      const expected = p.outputs.map(o => [o.resource, o.amount]).sort(), actual = v.outputs.map(o => [o.resource, o.amount]).sort();
      if (hash(expected) !== hash(actual)) { p.conflicts.push('Viewer output differs from runtime'); m.diagnostics.push(diagnostic(m, 'source-conflict', p.id, p.conflicts.at(-1)!, 'warning', 'confirmed', [ev, ...p.evidence])); }
      // Category catalysts are candidates; never promote them to runtime requirements.
      p.fieldEvidence.equipmentCandidates = [ev];
    } else {
      const id = `${viewerKind}:${v.id}`;
      m.processes.push({ id, sourceId: v.id, type: v.category, inputs: v.inputs.map(i => ({ ...i, evidence: [ev] })), outputs: v.outputs.map(o => ({ ...o, evidence: [ev] })), requirements: v.equipment.map(id => ({ kind: 'opaque', id: `equipment-candidate:${id}`, evidence: [ev] })), evidence: [ev], interpretation: 'opaque', execution: v.execution, unknown: ['Viewer-only executability is unconfirmed', ...v.unknown], enabled: true, costs: [], raw: v.raw, viewerSources: [structuredClone(v)], fieldEvidence: { inputs: [ev], outputs: [ev] }, conflicts: [] });
      const candidates = byOutput.get(hash(v.outputs.map(o => [o.resource, o.amount]))) ?? [];
      if (candidates.length) m.diagnostics.push(diagnostic(m, 'ambiguous-viewer-match', id, `Possible matches: ${candidates.join(', ')}`, 'info', 'unknown', [ev]));
    }
  }
  m.coverage.push(...viewer.coverage);
}
