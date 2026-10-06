import { hash } from './hash.ts';
import type { Json, Model, Output, Process, RawRecipe, Requirement, Snapshot } from './types.ts';

type Tree = Record<string, any>;
interface LootResult { outputs: Output[]; requirements: Requirement[]; unknown: string[]; evidence: string[] }
const object = (value: unknown): Tree => value && typeof value === 'object' && !Array.isArray(value) ? value as Tree : {};
const unique = <T>(values: T[]) => [...new Set(values)];
const chance = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
const constant = (value: unknown, fallback: number): number | null => {
  if (value === undefined) return fallback;
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const v = object(value);
  return v.type === 'minecraft:constant' && typeof v.value === 'number' && Number.isFinite(v.value) && v.value >= 0 ? v.value : null;
};
const fresh = (): LootResult => ({ outputs: [], requirements: [], unknown: [], evidence: [] });
const merge = (target: LootResult, source: LootResult) => { target.outputs.push(...source.outputs); target.requirements.push(...source.requirements); target.unknown.push(...source.unknown); target.evidence.push(...source.evidence); };

/** Applied tables and modifiers are interpreted separately; unknown post-processing blocks proofs. */
export function normalizeWorld(model: Model, snapshot: Snapshot): void {
  const world = snapshot.world;
  if (!world) return;
  const multiplicities = new WeakMap<Output, number>();
  const resourceIds = new Set(model.resources.map(r => r.id));
  const addResource = (id: string, kind: string, evidence: string[]) => {
    if (!resourceIds.has(id)) { model.resources.push({ id, kind, name: id, evidence }); resourceIds.add(id); }
  };
  const evidence = (group: string, record: RawRecipe, kind: 'runtime' | 'observation' = 'runtime') => {
    const id = `${kind}:world:${group}:${record.id}`;
    model.evidence.push({ id, kind, source: snapshot.id, adapter: `${snapshot.loader}-world-${snapshot.minecraft}-v1`, pointer: `world/${group}/${record.id}` });
    return id;
  };
  const tableById = new Map(world.lootTables.map(r => [r.id, r]));
  const tableEvidence = new Map(world.lootTables.map(r => [r.id, evidence('lootTables', r)]));
  const modifiers = world.lootModifiers.map(r => ({ record: r, evidence: evidence('lootModifiers', r) }));
  const sourceEvidence = new Map(world.lootSources.map(r => [r.id, evidence('lootSources', r)]));
  const sourceByTable = new Map<string, RawRecipe[]>();
  for (const source of world.lootSources) {
    const data = object(source.data), table = String(data.lootTable ?? '');
    if (table) { const values = sourceByTable.get(table) ?? []; values.push(source); sourceByTable.set(table, values); }
    if (data.resourceId) addResource(data.resourceId, data.kind === 'entity' ? 'entity' : 'world-block', [sourceEvidence.get(source.id)!]);
  }
  function conditions(values: unknown, result: LootResult, tableId: string): number | null {
    let probability: number | null = 1;
    if (values === undefined) return probability;
    if (!Array.isArray(values)) { result.unknown.push('Malformed loot conditions'); return null; }
    for (const value of values) {
      const c = object(value), name = c.condition;
      if (name === 'minecraft:random_chance') {
        const p = chance(c.chance); probability = probability === null || p === null ? null : probability * p;
        if (p === null) result.unknown.push('Nonconstant random chance');
      } else if (name === 'minecraft:killed_by_player') result.requirements.push({ kind: 'context', id: 'killedByPlayer', predicate: true, evidence: result.evidence });
      else if (name === 'minecraft:weather_check') {
        for (const [field, id] of [['raining', 'raining'], ['thundering', 'thundering']] as const) if (field in c) {
          if (typeof c[field] !== 'boolean') result.unknown.push('Invalid weather context condition');
          else result.requirements.push({ kind: 'context', id, predicate: c[field], evidence: result.evidence });
        }
      } else if (name === 'minecraft:inverted') {
        const nested = fresh(); nested.evidence = result.evidence;
        const p = conditions([c.term], nested, tableId);
        if (!nested.unknown.length && nested.requirements.length === 1 && typeof nested.requirements[0]!.predicate === 'boolean' && p === 1) {
          const r = nested.requirements[0]!; result.requirements.push({ ...r, predicate: !r.predicate });
        } else if (!nested.unknown.length && !nested.requirements.length && p !== null) probability = probability === null ? null : probability * (1 - p);
        else { result.unknown.push('Inverted condition with linked or unknown predicates'); probability = null; }
      } else if (name === 'minecraft:all_of') {
        const p = conditions(c.terms, result, tableId); probability = probability === null || p === null ? null : probability * p;
      } else if (name === 'neoforge:loot_table_id') {
        if (typeof c.loot_table_id !== 'string') { result.unknown.push('Invalid modifier loot table condition'); probability = null; }
        else if (c.loot_table_id !== tableId) return 0;
      } else if (name === 'minecraft:match_tool') {
        const predicate = object(c.predicate), items = predicate.items;
        if (Object.keys(predicate).some(k => k !== 'items') || items === undefined) result.unknown.push('Tool components, enchantments or custom tool predicates are not interpreted');
        else {
          const choices = typeof items === 'string' ? [items] : Array.isArray(items) ? items : [];
          if (!choices.length || choices.some(v => typeof v !== 'string')) result.unknown.push('Invalid tool item predicate');
          else {
            const expanded = choices.flatMap((item: string) => item.startsWith('#') ? model.tags[item.slice(1)] ?? [] : [item]);
            if (choices.some((item: string) => item.startsWith('#') && !(item.slice(1) in model.tags))) result.unknown.push('Tool predicate tag was not acquired');
            result.requirements.push({ kind: 'context', id: 'tool', predicate: { anyOf: expanded }, evidence: result.evidence });
          }
        }
      } else {
        result.unknown.push(`Uninterpreted loot condition: ${String(name)}`);
        result.requirements.push({ kind: 'opaque', id: `loot-condition:${hash(value).slice(0, 16)}`, predicate: value as Json, evidence: result.evidence });
        probability = null;
      }
    }
    return probability;
  }
  function functions(values: unknown, result: LootResult, tableId: string): void {
    if (values === undefined) return;
    if (!Array.isArray(values)) { result.unknown.push('Malformed loot functions'); return; }
    for (const value of values) {
      const f = object(value);
      if (f.conditions?.length) { result.unknown.push('Conditional loot function modifies correlated outputs'); conditions(f.conditions, result, tableId); }
      if (f.function === 'minecraft:set_count') {
        const count = constant(f.count, 1);
        if (count === null || !Number.isInteger(count)) { result.unknown.push('Random/noninteger count distribution is not reduced to a fixed yield'); for (const o of result.outputs) o.probability = null; }
        else {
          for (const o of result.outputs) { const copies = multiplicities.get(o) ?? 1; o.amount = f.add ? o.amount + count * copies : count * copies; }
          result.outputs = result.outputs.filter(o => o.amount > 0);
        }
      } else if (f.function === 'minecraft:limit_count') {
        const limit = typeof f.limit === 'number' ? { min: f.limit, max: f.limit } : object(f.limit);
        if (!Object.keys(limit).length || Object.keys(limit).some(k => !['min', 'max'].includes(k)) || Object.values(limit).some(v => typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) || (limit.min !== undefined && limit.max !== undefined && limit.min > limit.max)) { result.unknown.push('Unknown count clamp'); for (const o of result.outputs) o.probability = null; }
        else { for (const o of result.outputs) { const copies = multiplicities.get(o) ?? 1; o.amount = Math.max(limit.min ?? 0, Math.min(limit.max ?? Infinity, o.amount / copies)) * copies; } result.outputs = result.outputs.filter(o => o.amount > 0); }
      } else if (f.function === 'minecraft:set_components' && Object.keys(f).every(k => ['function', 'components', 'conditions'].includes(k))) {
        for (const o of result.outputs) o.components = f.components;
      } else {
        result.unknown.push(`Uninterpreted loot function: ${String(f.function)}`);
      }
    }
  }
  function table(id: string, stack: string[], inline?: Tree): LootResult {
    const result = fresh(), record = tableById.get(id), ev = tableEvidence.get(id);
    if (ev) result.evidence.push(ev);
    if (stack.includes(id) || stack.length >= 64) { result.unknown.push(`Loot table reference cycle or depth limit: ${id}`); return result; }
    if ((!record && !inline) || record?.error) { result.unknown.push(`Loot table reference unavailable: ${id}${record?.error ? ': ' + record.error : ''}`); return result; }
    const data = inline ?? object(record?.data);
    if (!Array.isArray(data.pools)) { if (Object.keys(data).length && data.pools === undefined) return result; result.unknown.push('Malformed loot pools'); return result; }
    for (const poolValue of data.pools) {
      const pool = object(poolValue), poolResult = fresh(); poolResult.evidence = [...result.evidence];
      const rolls = constant(pool.rolls, 1), bonus = constant(pool.bonus_rolls, 0);
      const poolChance = conditions(pool.conditions, poolResult, id);
      if (rolls === 0 && bonus === 0 || poolChance === 0) { merge(result, poolResult); continue; }
      if (rolls === null || !Number.isInteger(rolls) || rolls > 100000 || bonus !== 0) poolResult.unknown.push('Variable rolls or luck-dependent bonus rolls');
      const entries = Array.isArray(pool.entries) ? pool.entries : [];
      if (!Array.isArray(pool.entries)) poolResult.unknown.push('Malformed loot entries');
      const weights = entries.map(v => { const e = object(v); return constant(e.weight, 1); });
      const validWeights = weights.every(w => w !== null && Number.isSafeInteger(w)) && entries.every(e => constant(object(e).quality, 0) === 0);
      const sum = validWeights ? (weights as number[]).reduce((a, b) => a + b, 0) : 0;
      if (!validWeights) poolResult.unknown.push('Loot weights or quality depend on context');
      const sharedRequirementCount = poolResult.requirements.length;
      entries.forEach((entry, index) => {
        const leaf = entryResult(object(entry), [...stack, id], id), p = validWeights && sum > 0 ? weights[index]! / sum : null;
        // Zero effective weights never produce a candidate, including a pool with no positive weights.
        if (validWeights && (sum === 0 || weights[index] === 0)) return;
        for (const output of leaf.outputs) {
          if (rolls === 1 && bonus === 0) output.probability = p === null || poolChance === null || output.probability === null ? null : p * poolChance * output.probability;
          else if (p === 1 && poolChance === 1 && output.probability === 1 && rolls !== null && Number.isInteger(rolls) && bonus === 0) { output.amount *= rolls; multiplicities.set(output, (multiplicities.get(output) ?? 1) * rolls); }
          else { output.probability = null; leaf.unknown.push('Multiple weighted rolls have a correlated yield distribution'); }
        }
        leaf.outputs = leaf.outputs.filter(o => o.probability !== 0);
        merge(poolResult, leaf);
      });
      // Entry conditions are checked while expanding candidates, before the weighted draw.
      // A fixed denominator cannot describe conditional candidates or branch-local context facts.
      if (entries.length > 1 && (entries.some(e => object(e).conditions !== undefined && (!Array.isArray(object(e).conditions) || object(e).conditions.length > 0)) || poolResult.requirements.length > sharedRequirementCount)) {
        poolResult.unknown.push('Conditional weighted candidates require separate outcome branches');
        for (const o of poolResult.outputs) o.probability = null;
        if (poolResult.requirements.length) poolResult.requirements = [{ kind: 'opaque', id: `linked-entry-context:${id}`, predicate: poolResult.requirements as unknown as Json, evidence: poolResult.evidence }];
      }
      if (entries.some(value => { const e = object(value); return !['minecraft:item', 'minecraft:empty', 'minecraft:loot_table', 'minecraft:tag'].includes(e.type) || e.type === 'minecraft:tag' && e.expand && model.tags[e.name]?.length !== 1; })) {
        poolResult.unknown.push('Composite or expanded entry candidate counts do not have a fixed pool denominator');
        for (const o of poolResult.outputs) o.probability = null;
      }
      functions(pool.functions, poolResult, id); merge(result, poolResult);
    }
    if (data.pools.length > 1 && result.requirements.length) {
      result.unknown.push('Different pool context conditions require separate outcome branches');
      result.requirements = [{ kind: 'opaque', id: `linked-pool-context:${id}`, predicate: result.requirements as unknown as Json, evidence: result.evidence }];
    }
    functions(data.functions, result, id);
    return result;
  }
  function entryResult(entry: Tree, stack: string[], tableId: string): LootResult {
    const result = fresh(); result.evidence = tableEvidence.has(tableId) ? [tableEvidence.get(tableId)!] : [];
    const p = conditions(entry.conditions, result, tableId);
    if (p === 0) return result;
    if (entry.type === 'minecraft:item' && typeof entry.name === 'string') result.outputs.push({ resource: entry.name, amount: 1, unit: 'item', role: 'primary', probability: p, evidence: result.evidence });
    else if (entry.type === 'minecraft:empty') { /* A weighted empty draw contributes to the denominator. */ }
    else if (entry.type === 'minecraft:loot_table') {
      const ref = entry.value ?? entry.name;
      const nested = typeof ref === 'string' ? table(ref, stack) : table(`${tableId}#inline-${hash(ref).slice(0, 16)}`, stack, object(ref));
      for (const o of nested.outputs) o.probability = o.probability === null || p === null ? null : o.probability * p;
      merge(result, nested);
    } else if (entry.type === 'minecraft:tag') {
      const members = model.tags[entry.name];
      if (!members) result.unknown.push(`Loot tag was not acquired: ${entry.name}`);
      else {
        if (entry.expand && members.length !== 1) result.unknown.push('Expanded tag changes the weighted pool denominator');
        for (const id of members) result.outputs.push({ resource: id, amount: 1, unit: 'item', role: 'primary', probability: entry.expand && members.length > 1 ? null : p, evidence: [...result.evidence, 'runtime:tags'] });
      }
    } else if (entry.type === 'minecraft:group') {
      result.unknown.push('Composite group expands weighted candidates; joint outcomes are not interpreted');
      for (const child of Array.isArray(entry.children) ? entry.children : []) merge(result, entryResult(object(child), stack, tableId));
      for (const o of result.outputs) o.probability = null;
      if (result.requirements.length) result.requirements = [{ kind: 'opaque', id: `linked-group-context:${hash(entry).slice(0, 16)}`, predicate: result.requirements as unknown as Json, evidence: result.evidence }];
    } else {
      result.unknown.push(`Uninterpreted loot entry: ${String(entry.type)}`);
      for (const child of entry.children ?? []) { const leaf = entryResult(object(child), stack, tableId); for (const o of leaf.outputs) o.probability = null; merge(result, leaf); }
    }
    functions(entry.functions, result, tableId); return result;
  }
  const baseProcess = (id: string, type: string, raw: Json, refs: string[]): Process => ({ id, sourceId: id, type, raw, inputs: [], outputs: [], requirements: [], evidence: refs, interpretation: 'supported', execution: 'executable', unknown: [], enabled: true, costs: [], fieldEvidence: { inputs: refs, outputs: refs, requirements: refs }, conflicts: [] });
  let interpretedTables = 0;
  for (const record of world.lootTables) {
    const raw = table(record.id, []), sources = sourceByTable.get(record.id) ?? [null];
    let fullyInterpreted = !raw.unknown.length;
    for (const source of sources) {
      const result = structuredClone(raw), data = object(source?.data);
      const eventUnknown: string[] = [];
      if (source && data.defaultMappingOnly) eventUnknown.push('Default block/entity table mapping does not enumerate actual break/death events or per-instance overrides');
      if (source?.error) eventUnknown.push(`Loot event source could not be acquired: ${source.id}`);
      if (snapshot.coverage.some(c => (c.dataset === 'lootModifiers' || c.dataset === 'loot-modifiers' || c.dataset === 'loot' && c.type === 'runtime global modifiers in application order') && c.status !== 'complete')) eventUnknown.push('Post-loot application hooks are not completely acquired by this loader adapter');
      result.unknown.push(...eventUnknown);
      const contextResource = data.resourceId ?? `loot-context:${record.id}`;
      const refs = unique([...result.evidence, ...(source ? [sourceEvidence.get(source.id)!] : [])]);
      addResource(contextResource, source ? data.kind === 'entity' ? 'entity' : 'world-block' : 'loot-context', refs);
      const process = baseProcess(`loot:${record.id}${source ? '@' + source.id : ''}`, 'minecraft:loot', { table: record.data, source: source?.data ?? null, modifiers: modifiers.map(m => ({ id: m.record.id, hash: hash(m.record.data) })) }, refs);
      process.inputs.push({ alternatives: [{ resource: contextResource }], amount: 1, unit: source ? data.kind === 'entity' ? 'entity' : 'block' : 'event', consumption: 'consumed', evidence: refs });
      const postProcesses: Process[] = [];
      for (const modifier of modifiers) {
        const modifierData = object(modifier.record.data), extra = fresh(); extra.evidence = [modifier.evidence];
        const applies = conditions(modifierData.conditions, extra, record.id);
        if (applies === 0) continue;
        result.evidence.push(modifier.evidence);
        if (modifier.record.error) { result.unknown.push(`Post-loot modifier could not be serialized: ${modifier.record.id}`); continue; }
        if (modifierData.type === 'craftatlas:add_item' && typeof modifierData.item === 'string') {
          const amount = constant(modifierData.count, 1);
          if (amount === null || amount <= 0 || !Number.isInteger(amount)) result.unknown.push('Invalid post-loot item count');
          else {
            const post = baseProcess(`${process.id}:modifier:${modifier.record.id}`, 'minecraft:loot-post', { table: record.id, modifier: modifier.record.data }, unique([...refs, modifier.evidence]));
            post.inputs = structuredClone(process.inputs); post.outputs.push({ resource: modifierData.item, amount, unit: 'item', role: 'primary', probability: applies, evidence: [modifier.evidence] });
            post.requirements = extra.requirements; post.unknown = extra.unknown; postProcesses.push(post);
          }
        } else result.unknown.push(`Uninterpreted post-loot code: ${modifier.record.id} (${modifierData.type ?? modifier.record.type})`);
      }
      process.outputs = result.outputs; process.requirements = result.requirements;
      process.evidence = unique([...refs, ...result.evidence]); process.unknown = unique(result.unknown);
      process.interpretation = process.unknown.length ? 'opaque' : 'supported';
      fullyInterpreted &&= process.interpretation === 'supported';
      // Each output retains its marginal probability; table raw preserves joint pool structure.
      process.outputs.forEach((o, i) => { o.role = i === 0 ? 'primary' : 'byproduct'; });
      model.processes.push(process);
      for (const post of postProcesses) { post.unknown = unique([...post.unknown, ...eventUnknown, ...result.unknown.filter(reason => reason.includes('post-loot') || reason.includes('Post-loot'))]); post.interpretation = post.unknown.length ? 'opaque' : 'supported'; model.processes.push(post); }
    }
    if (fullyInterpreted) interpretedTables++;
  }
  model.coverage.push({ dataset: 'normalization', type: 'minecraft:loot', status: interpretedTables === world.lootTables.length ? 'complete' : 'partial', enumerated: world.lootTables.length, interpreted: interpretedTables, reasons: unique(model.processes.filter(p => p.type === 'minecraft:loot').flatMap(p => p.unknown)) });

  const featureById = new Map(world.features.map(r => [r.id, r]));
  const featureEvidence = new Map(world.features.map(r => [r.id, evidence('features', r)]));
  const biomeEvidence = new Map(world.biomes.map(r => [r.id, evidence('biomes', r)]));
  const biomeById = new Map(world.biomes.map(r => [r.id, r]));
  const flattenIds = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(flattenIds) : typeof value === 'string' ? [value] : [];
  let appliedFeatures = 0;
  for (const dimension of world.dimensions) {
    const ev = evidence('dimensions', dimension), data = object(dimension.data); addResource(dimension.id, 'dimension', [ev]);
    const biomeIds = Array.isArray(data.possibleBiomes) ? data.possibleBiomes : [];
    for (const biomeId of biomeIds) {
      const biome = biomeById.get(biomeId), b = object(biome?.data), bev = biomeEvidence.get(biomeId);
      const generation = object(object(data.biomeGeneration)[biomeId] ?? b.generation);
      for (const placedId of unique(flattenIds(generation.features))) {
        const placed = featureById.get(`placed_feature:${placedId}`), placedData = object(placed?.data);
        const configuredId = typeof placedData.feature === 'string' ? placedData.feature : null;
        const configured = configuredId ? featureById.get(`configured_feature:${configuredId}`) : undefined;
        const configuration = configured ? object(configured.data) : object(placedData.feature);
        const refs = unique([ev, ...(bev ? [bev] : []), ...(placed ? [featureEvidence.get(placed.id)!] : []), ...(configured ? [featureEvidence.get(configured.id)!] : [])]);
        const process = baseProcess(`worldgen:${dimension.id}/${biomeId}/${placedId}`, 'minecraft:worldgen', { generator: data.generator ?? null, biome: biomeId, placed: placed?.data ?? null, configured: configured?.data ?? null }, refs);
        process.requirements.push({ kind: 'dimension', id: dimension.id, evidence: [ev] });
        process.inputs.push({ alternatives: [{ resource: `biome:${biomeId}` }], amount: 1, unit: 'chunk-context', consumption: 'catalyst', evidence: refs }); addResource(`biome:${biomeId}`, 'biome', refs);
        process.execution = 'unconfirmed'; process.interpretation = 'opaque';
        process.unknown.push('Feature is applied to the generator and biome; actual placement and accessible supply require conditions or observations', 'Configured size is not a time-based or guaranteed yield');
        if (!placed || placed.error || configured?.error) process.unknown.push('Configured/placed feature codec is unavailable');
        if (configuration.type === 'minecraft:ore' || configuration.type === 'minecraft:scattered_ore') {
          for (const target of object(configuration.config).targets ?? []) {
            const state = object(object(target).state), name = state.Name;
            if (typeof name === 'string') { const id = `block:${name}`; addResource(id, 'world-block', refs); process.outputs.push({ resource: id, amount: 1, unit: 'block', role: 'primary', probability: null, evidence: refs }); }
          }
        }
        model.processes.push(process); appliedFeatures++;
      }
      const spawners = object(object(b.spawns).spawners);
      const spawnOccurrences = new Map<string, number>();
      for (const [category, entries] of Object.entries(spawners)) for (const entry of Array.isArray(entries) ? entries : []) {
        const spawn = object(entry), entity = spawn.type;
        if (typeof entity !== 'string') continue;
        const refs = [ev, ...(bev ? [bev] : [])], id = `entity:${entity}`; addResource(id, 'entity', refs);
        const entryHash = hash({ category, entry }).slice(0, 16), occurrence = spawnOccurrences.get(entryHash) ?? 0; spawnOccurrences.set(entryHash, occurrence + 1);
        const p = baseProcess(`spawn:${dimension.id}/${biomeId}/${category}/${entity}/${entryHash}/${occurrence}`, 'minecraft:spawn', { category, settings: entry as Json }, refs);
        p.inputs.push({ alternatives: [{ resource: `biome:${biomeId}` }], amount: 1, unit: 'chunk-context', consumption: 'catalyst', evidence: refs }); addResource(`biome:${biomeId}`, 'biome', refs);
        p.outputs.push({ resource: id, amount: 1, unit: 'entity', role: 'primary', probability: null, evidence: refs });
        p.requirements.push({ kind: 'dimension', id: dimension.id, evidence: [ev] });
        p.interpretation = 'opaque'; p.execution = 'unconfirmed'; p.unknown.push('Spawn weights are selection settings, not supply rates; light, caps, events and species-specific code remain unknown'); model.processes.push(p);
      }
    }
  }
  // Registry-only entries remain searchable as display records and never prove generation.
  const appliedIds = new Set(model.processes.filter(p => p.type === 'minecraft:worldgen').flatMap(p => p.evidence));
  for (const feature of world.features) if (!appliedIds.has(featureEvidence.get(feature.id)!)) {
    const ev = featureEvidence.get(feature.id)!, p = baseProcess(`registry:${feature.id}`, 'minecraft:worldgen-registration', feature.data, [ev]);
    p.execution = 'display'; p.interpretation = 'opaque'; p.unknown.push('Registered feature; no applied generator/biome relationship was established'); model.processes.push(p);
  }
  const observations = world.observations ?? [];
  observations.forEach((value, index) => {
    const data = object(value), id = String(data.id ?? data.label ?? index), ev = evidence('observations', { id, type: 'observation', data: value }, 'observation');
    const p = baseProcess(`observation:${id}`, 'minecraft:observation', value, [ev]); p.execution = 'display'; p.interpretation = 'opaque';
    p.unknown.push('Finite observation records outcomes, not universal absence or unlimited supply');
    const counts = object(data.totals ?? data.counts ?? data.items ?? data.blocks);
    for (const [resource, amount] of Object.entries(counts)) if (typeof amount === 'number' && amount > 0) {
      addResource(resource, resource.startsWith('block:') ? 'world-block' : 'item', [ev]); p.outputs.push({ resource, amount, unit: resource.startsWith('block:') ? 'block' : 'item', role: 'primary', probability: null, evidence: [ev] });
    }
    model.processes.push(p);
  });
  model.coverage.push({ dataset: 'normalization', type: 'minecraft:worldgen', status: 'partial', enumerated: appliedFeatures, interpreted: 0, reasons: ['Applied generator/biome relationships are retained; arbitrary placement and code conditions are not fully interpreted', ...world.limitations] });
  if (observations.length) model.coverage.push({ dataset: 'observations', type: '*', status: 'complete', enumerated: observations.length, interpreted: observations.length, reasons: ['Finite samples cannot prove absence, renewal rate, or global distribution'] });
}
