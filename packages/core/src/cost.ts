import { hash } from './hash.ts';
import { diagnostic } from './normalize.ts';
import { contextRequirement, uninterpretedConstraints } from './analyze.ts';
import { validate } from './validate.ts';
import type { CostRequest, Diagnostic, Model, Process, Scenario } from './types.ts';

type Phase = 'setup' | 'recurring';
export interface MaterialCost { resource: string; unit: string; amount: number; fromInventory: number | null; external: number | null; basis: 'deterministic' | 'expectation' | 'mean-flow' }
export interface CostTotal { kind: string; unit: string; amount: number | null; knownSubtotal: number; unknown: string[] }
export interface CostOutput { process: string; resource: string; unit: string; role: string; amount: number | null; probability: number | null; basis: 'deterministic' | 'expectation' | 'unknown'; reused: number | null }
export interface CostStep { process: string; phase: Phase; batches: number; batchBasis: 'deterministic' | 'expectation' | 'mean-flow'; batchVariance: number | null; inputs: { resource: string; amount: number; unit: string; consumption: string }[]; evidence: string[] }
export interface CostAnalysis {
  schemaVersion: 1; snapshotId: string; request: string; requestHash: string; scenario: string; scenarioHash: string; status: 'complete' | 'unknown' | 'invalid';
  target: CostRequest['target']; steps: CostStep[]; materials: { setup: MaterialCost[]; recurring: MaterialCost[] };
  catalysts: { resource: string; unit: string; amount: number; phase: Phase }[];
  durability: { resource: string; unit: string; wear: number; toolsRequired: number | null; replacementTools: number | null; remaining: number | null; phase: Phase }[];
  outputs: CostOutput[]; costs: { setup: CostTotal[]; recurring: CostTotal[]; total: CostTotal[] };
  evidence: string[]; diagnostics: Diagnostic[]; limitations: string[];
}
interface Demand { mean: number; variance: number | null; random: boolean; quantum: number; offset: number; approximate: boolean }
const fixed = (mean: number): Demand => ({ mean, variance: 0, random: false, quantum: 0, offset: mean, approximate: false });
const key = (resource: string, unit: string) => JSON.stringify([resource, unit]);
const divisible = (a: number, b: number) => Math.abs(a / b - Math.round(a / b)) < 1e-9;
const BOUND = 1e12, MAX_STEPS = 1000, MAX_DEPTH = 100;

/** Accumulate the caller's selected acyclic plan, without selecting or optimizing alternative routes. */
export function calculateCost(model: Model, input: CostRequest, scenario: Scenario): CostAnalysis {
  const request = validate<CostRequest>('cost-request', input), s = validate<Scenario>('scenario', scenario);
  const result: CostAnalysis = { schemaVersion: 1, snapshotId: model.snapshotId, request: request.id, requestHash: hash(request), scenario: s.id, scenarioHash: hash(s), status: 'complete', target: request.target, steps: [], materials: { setup: [], recurring: [] }, catalysts: [], durability: [], outputs: [], costs: { setup: [], recurring: [], total: [] }, evidence: [], diagnostics: [], limitations: [
    'This evaluates an explicitly selected plan; it does not optimize alternatives, credit random byproducts as supplies, or diagnose duplication exploits',
    'Process time totals describe summed processing time; parallel wall-clock completion time is not computed',
    'Costs with different units remain separate; no implicit fluid, energy or time conversions are performed',
    'IID Bernoulli declarations assume stationary independent trial streams for each selected process; cross-output independence requires an explicit declaration',
    'Random upstream batch rounding, finite inventory allocation and tool replacement may require an additional distribution; mean-flow estimates are marked unknown',
    'Per-step batch variance is reported; joint material and total cost variance is not inferred without covariance information',
    'Empty cost lists mean no costs were declared; they are not evidence of zero elapsed time or free energy',
  ] };
  const processes = new Map(model.processes.map(p => [p.id, p])), resources = new Map(model.resources.map(r => [r.id, r]));
  const stock = new Map<string, number>(), initialStock = new Map<string, number>(), materialMaps = { setup: new Map<string, MaterialCost>(), recurring: new Map<string, MaterialCost>() };
  const costMaps = { setup: new Map<string, CostTotal>(), recurring: new Map<string, CostTotal>() };
  const installed = new Set([...s.equipment.map(id => `equipment:${id}`), ...s.stages.map(id => `stage:${id}`), ...s.dimensions.map(id => `dimension:${id}`)]);
  const reusable = new Map<string, number>(), toolState = new Map<string, { remaining: number; lifetime: number; active: boolean }>();
  const report = (rule: string, target: string, message: string, invalid = false, evidence: string[] = [], path: string[] = []) => {
    if (invalid) result.status = 'invalid'; else if (result.status === 'complete') result.status = 'unknown';
    const d = diagnostic(model, `cost-${rule}`, target, message, invalid ? 'error' : 'warning', invalid ? 'confirmed' : 'unknown', evidence);
    d.id = hash({ rule: d.rule, target, request: request.id, scenario: s.id }).slice(0, 24); d.scenario = s.id; d.path = path; if (!invalid) d.unknown = [message]; result.diagnostics.push(d);
  };
  const bounded = (amount: number, target: string) => { if (!Number.isFinite(amount) || amount < 0 || amount > BOUND) { report('limit', target, 'Quantity or arithmetic exceeds the calculation bound'); return false; } return true; };
  const unitFor = (id: string) => {
    if (request.inventoryUnits?.[id]) return request.inventoryUnits[id]!;
    const r = resources.get(id); if (r?.kind === 'item') return 'item'; if (['capability', 'equipment', 'dimension', 'stage'].includes(r?.kind ?? '')) return 'capability';
    const units = new Set(model.processes.flatMap(p => [...p.outputs.filter(o => o.resource === id).map(o => o.unit), ...p.inputs.filter(i => i.consumption !== 'durability' && i.alternatives.some(a => a.resource === id || a.members?.includes(id))).map(i => i.unit)]));
    if (units.size === 1) return [...units][0]!;
    if (units.size > 1) { report('inventory-unit', id, 'Inventory resource has ambiguous units; set inventoryUnits explicitly'); return undefined; }
    return r?.kind === 'fluid' ? 'mB' : 'item';
  };
  for (const [id, amount] of Object.entries(s.inventory)) if (amount > 0) { const unit = unitFor(id); if (unit) { stock.set(key(id, unit), amount); initialStock.set(key(id, unit), amount); } }
  const addStock = (id: string, unit: string, amount: number) => { const total = (stock.get(key(id, unit)) ?? 0) + amount; if (bounded(total, id)) stock.set(key(id, unit), total); };
  const addMaterial = (id: string, unit: string, amount: number, fromInventory: number | null, external: number | null, phase: Phase, demand: Demand) => {
    const k = key(id, unit), old = materialMaps[phase].get(k), basis = demand.approximate ? 'mean-flow' : demand.random ? 'expectation' : 'deterministic';
    if (old) { if (!bounded(old.amount + amount, id)) return; old.amount += amount; old.fromInventory = old.fromInventory === null || fromInventory === null ? null : old.fromInventory + fromInventory; old.external = old.external === null || external === null ? null : old.external + external; if (basis === 'mean-flow' || old.basis === 'deterministic' && basis === 'expectation') old.basis = basis; }
    else materialMaps[phase].set(k, { resource: id, unit, amount, fromInventory, external, basis });
  };
  const addCost = (p: Process, batches: Demand, phase: Phase) => {
    for (const c of p.costs) {
      const k = key(c.kind, c.unit), value = costMaps[phase].get(k) ?? { kind: c.kind, unit: c.unit, amount: 0, knownSubtotal: 0, unknown: [] };
      if (c.amount === null || batches.approximate) { value.amount = null; value.unknown.push(c.amount === null ? `${p.id}: ${c.kind} amount not acquired (${c.basis})` : `${p.id}: stochastic batch rounding was not resolved`); report('unknown-cost', `${p.id}/${c.kind}/${c.unit}`, value.unknown.at(-1)!, false, p.evidence); }
      else { const amount = c.amount * batches.mean; if (bounded(amount, p.id) && bounded(value.knownSubtotal + amount, p.id)) { value.knownSubtotal += amount; if (value.amount !== null) value.amount += amount; } else value.amount = null; }
      costMaps[phase].set(k, value);
    }
  };
  let expansions = 0;
  const ensureCapability = (id: string, kind: string, path: string[]) => {
    if (installed.has(`${kind}:${id}`)) return;
    const r = resources.get(id), acceptable = kind === 'equipment' ? ['capability', 'equipment'] : [kind];
    if (!r || !acceptable.includes(r.kind)) { report('requirement', id, `Missing modeled ${kind} capability; an ordinary item does not prove installation or access`, false, [], path); return; }
    const ok = need(id, fixed(1), 'capability', 'setup', path); if (ok) installed.add(`${kind}:${id}`);
  };
  const needTool = (id: string, wear: Demand, phase: Phase, path: string[], unit: string) => {
    const specification = request.durability[id];
    if (!specification) { report('durability', id, 'Tool durability and lifetime were not supplied', false, [], path); result.durability.push({ resource: id, unit, wear: wear.mean, toolsRequired: null, replacementTools: null, remaining: null, phase }); return; }
    const state = toolState.get(id) ?? { ...specification, active: false };
    if (wear.random) {
      report('durability-distribution', id, 'Expected wear does not determine expected replacement count or sufficient remaining durability', false, [], path);
      result.durability.push({ resource: id, unit, wear: wear.mean, toolsRequired: null, replacementTools: null, remaining: null, phase }); return;
    }
    let remainingWear = wear.mean, tools = 0, replacements = 0;
    if (!state.active && remainingWear > 0) { need(id, fixed(1), unitFor(id) ?? 'item', phase, path); state.active = true; tools++; if (state.remaining <= 0) { state.remaining = state.lifetime; replacements++; } }
    if (remainingWear > state.remaining) {
      remainingWear -= state.remaining; const fresh = Math.ceil(remainingWear / state.lifetime);
      need(id, fixed(fresh), unitFor(id) ?? 'item', phase, path); tools += fresh; replacements += fresh; state.remaining = fresh * state.lifetime - remainingWear;
    } else state.remaining -= remainingWear;
    toolState.set(id, state); result.durability.push({ resource: id, unit, wear: wear.mean, toolsRequired: tools, replacementTools: replacements, remaining: state.remaining, phase });
  };
  const need = (id: string, demand: Demand, unit: string, phase: Phase, path: string[]): boolean => {
    if (demand.mean <= 1e-12) return true;
    if (!bounded(demand.mean, id)) return false;
    if (path.length > MAX_DEPTH || ++expansions > MAX_STEPS) { report('limit', id, 'Selected plan exceeds the depth or expansion bound', false, [], path); return false; }
    const k = key(id, unit), route = request.routes[id], available = stock.get(k) ?? 0;
    if (demand.random && !route && s.supply === 'renewable' && (s.inventory[id] ?? 0) > 0) {
      // The bill reports gross flow from the declared renewable source, not E[min(D, initial stock)].
      addMaterial(id, unit, demand.mean, 0, demand.mean, phase, demand); return true;
    }
    let consumedStock = 0, suppliedInitial = 0;
    if (!demand.random) {
      consumedStock = Math.min(available, demand.mean); stock.set(k, available - consumedStock);
      suppliedInitial = Math.min(initialStock.get(k) ?? 0, consumedStock); initialStock.set(k, (initialStock.get(k) ?? 0) - suppliedInitial);
      if (!route || suppliedInitial > 0) addMaterial(id, unit, suppliedInitial, suppliedInitial, 0, phase, fixed(suppliedInitial));
      if (consumedStock >= demand.mean - 1e-12) return true;
      demand = fixed(demand.mean - consumedStock);
    } else if (available > 0) {
      // E[max(D-stock,0)] cannot be reconstructed from E[D] and Var[D].
      report('inventory-distribution', id, 'Random demand with finite stock needs its full distribution for exact allocation', false, [], path); demand = { ...demand, approximate: true };
    }
    if (!route) {
      const renewable = s.supply === 'renewable' && (s.inventory[id] ?? 0) > 0;
      addMaterial(id, unit, demand.mean, demand.random && available > 0 ? null : 0, demand.random && available > 0 ? null : demand.mean, phase, demand);
      if (!renewable) report('supply', id, s.supply === 'finite' ? 'Finite initial supply is insufficient and no producer was selected' : 'No known renewable supply or producer was selected', false, [], path);
      return renewable;
    }
    const p = processes.get(route.process), output = p?.outputs[route.output];
    if (!p || !output || output.resource !== id) { report('route', id, 'Selected process/output does not produce the requested resource', true, p?.evidence ?? [], path); return false; }
    if (output.unit !== unit) { report('unit', id, `Selected output unit ${output.unit} does not match requested ${unit}`, true, p.evidence, path); return false; }
    if (path.includes(p.id)) { report('cycle', p.id, 'Selected route contains a dependency cycle; no self-amplification or cyclic schedule is inferred', true, p.evidence, [...path, p.id]); return false; }
    const next = [...path, p.id];
    if (p.inputs.length > 10000 || p.outputs.length > 10000 || p.requirements.length > 10000) { report('limit', p.id, 'Selected process exceeds the field expansion bound', false, p.evidence, next); return false; }
    if (p.outputs.some(o => !bounded(o.amount, p.id))) return false;
    if (!p.enabled || s.forbiddenProcesses.includes(p.id) || s.allowedTypes !== null && !s.allowedTypes.includes(p.type) || p.execution === 'display') { report('forbidden', p.id, 'Selected process is disabled, display-only or forbidden by the scenario', true, p.evidence, next); return false; }
    if (p.interpretation !== 'supported' || p.execution !== 'executable' || p.unknown.length || p.conflicts.length || uninterpretedConstraints(p).length) report('interpretation', p.id, [...p.unknown, ...p.conflicts, ...uninterpretedConstraints(p), ...(p.interpretation !== 'supported' ? ['Interpreter unavailable'] : []), ...(p.execution !== 'executable' ? ['Execution unconfirmed'] : [])].join('; '), false, p.evidence, next);
    if (output.probability === 0) { report('zero-output', p.id, 'Selected output has zero probability', true, p.evidence, next); return false; }
    if (output.probability === null) { report('probability', p.id, 'Selected output probability was not acquired', false, p.evidence, next); return false; }
    if (output.probability !== 1 && (request.mode !== 'expectation' || !request.probabilityModels[p.id])) { report('probability-model', p.id, 'A stationary IID Bernoulli model is required for stochastic output accumulation', false, p.evidence, next); return false; }
    const stochastic = output.probability !== 1;
    if (stochastic && s.supply === 'finite') report('finite-probability', p.id, 'Until-success expectation cannot prove completion before finite supplies are exhausted', false, p.evidence, next);
    let successes = demand.random ? demand.mean / output.amount : Math.ceil(demand.mean / output.amount), approximate = demand.approximate;
    if (demand.random && (!divisible(demand.quantum, output.amount) || !divisible(demand.offset, output.amount))) { approximate = true; report('batch-distribution', p.id, 'Expected upstream batch rounding requires the full demand distribution; only mean flow is shown', false, p.evidence, next); }
    const batches: Demand = { mean: successes / output.probability, variance: approximate || demand.variance === null ? null : successes * (1 - output.probability) / output.probability ** 2 + (demand.random ? demand.variance / output.amount ** 2 / output.probability ** 2 : 0), random: stochastic || demand.random, quantum: 1, offset: 0, approximate };
    if (!bounded(batches.mean, p.id)) return false;
    for (const r of p.requirements) {
      if (r.kind === 'context') { const status = contextRequirement(r, s); if (status !== 'met') report('context', `${p.id}/${r.id}`, status === 'unknown' ? 'Required loot or world context was not supplied or interpreted' : 'Selected process conflicts with the supplied context', status === 'unmet', r.evidence, next); }
      else if (r.kind === 'opaque') report('requirement', `${p.id}/${r.id}`, `Uninterpreted operational requirement: ${r.id}`, false, r.evidence, next);
      else ensureCapability(r.id, r.kind, next);
    }
    const selected = new Map<string, { resource: string; unit: string; amount: number; consumption: string }>();
    for (const [index, slot] of p.inputs.entries()) {
      const candidates = [...new Set(slot.alternatives.flatMap(a => a.resource ? [a.resource] : a.members ?? []))];
      const choice = request.selections[p.id]?.[String(index)] ?? (candidates.length === 1 ? candidates[0] : undefined);
      if (!choice) { report('selection', `${p.id}/inputs/${index}`, 'Select one resource explicitly for this OR input slot', false, slot.evidence, next); continue; }
      const matches = slot.alternatives.filter(a => a.resource === choice || a.members?.includes(choice));
      if (!matches.length) { report('selection', `${p.id}/inputs/${index}`, 'Selected resource is outside this input slot', true, slot.evidence, next); continue; }
      if (!matches.some(a => a.predicate === undefined && a.components === undefined)) { report('predicate', `${p.id}/inputs/${index}`, 'Selected ingredient still has an uninterpreted predicate or stack constraint', false, slot.evidence, next); continue; }
      const grouping = key(choice, `${slot.unit}/${slot.consumption}`), old = selected.get(grouping);
      if (old) old.amount += slot.amount; else selected.set(grouping, { resource: choice, unit: slot.unit, amount: slot.amount, consumption: slot.consumption });
    }
    const stepInputs: CostStep['inputs'] = [];
    const reused = new Map<string, number>();
    for (const item of selected.values()) {
      const total = item.amount * batches.mean; if (!bounded(total, p.id)) continue; stepInputs.push({ ...item, amount: total });
      if (item.consumption === 'catalyst') {
        const reuseKey = key(item.resource, item.unit), already = reusable.get(reuseKey) ?? 0;
        if (item.amount > already) { need(item.resource, fixed(item.amount - already), item.unit, phase, next); reusable.set(reuseKey, item.amount); }
        result.catalysts.push({ resource: item.resource, unit: item.unit, amount: item.amount, phase });
        for (const o of p.outputs.filter(o => o.role === 'returned' && o.resource === item.resource)) reused.set(key(o.resource, o.unit), (reused.get(key(o.resource, o.unit)) ?? 0) + batches.mean * o.amount);
      } else if (item.consumption === 'durability') {
        needTool(item.resource, { mean: total, variance: batches.variance === null ? null : batches.variance * item.amount ** 2, random: batches.random, quantum: item.amount, offset: 0, approximate }, phase, next, item.unit);
        // A returned nonconsumed tool is the same physical tool, not a new item per use.
        for (const o of p.outputs.filter(o => o.role === 'returned' && o.resource === item.resource)) reused.set(key(o.resource, o.unit), (reused.get(key(o.resource, o.unit)) ?? 0) + batches.mean * o.amount);
      }
      else {
        const returned = p.outputs.filter(o => o.role === 'returned' && o.resource === item.resource && o.unit === item.unit && o.probability === 1).reduce((sum, o) => sum + o.amount, 0);
        const delta = Math.max(0, item.amount - returned), needed = returned > 0 ? item.amount + Math.max(0, batches.mean - 1) * delta : total;
        const materialDemand: Demand = returned >= item.amount ? fixed(item.amount) : { mean: needed, variance: batches.variance === null ? null : batches.variance * delta ** 2, random: batches.random, quantum: returned > 0 ? delta : item.amount, offset: returned > 0 ? Math.min(returned, item.amount) : 0, approximate };
        need(item.resource, materialDemand, item.unit, phase, next);
        if (returned > 0) {
          const availableReturn = batches.random ? Math.min(returned, item.amount) : needed - total + batches.mean * returned;
          addStock(item.resource, item.unit, availableReturn); reused.set(key(item.resource, item.unit), batches.mean * returned - availableReturn);
        }
      }
    }
    addCost(p, batches, phase);
    result.steps.push({ process: p.id, phase, batches: batches.mean, batchBasis: approximate ? 'mean-flow' : batches.random ? 'expectation' : 'deterministic', batchVariance: batches.variance, inputs: stepInputs, evidence: [...p.evidence] });
    for (const [index, o] of p.outputs.entries()) {
      const independent = request.probabilityModels[p.id]?.independentOutputs === true;
      let known = o.probability !== null && (!batches.random || o.probability === 1 || index === route.output || independent);
      let amount = known ? index === route.output ? successes * o.amount : batches.mean * o.amount * o.probability! : null;
      if (amount !== null && !bounded(amount, `${p.id}/outputs/${index}`)) { known = false; amount = null; }
      if (!known) report('byproduct-model', `${p.id}/outputs/${index}`, 'Byproduct expectation is unknown without probability and a declared joint independence model', false, o.evidence, next);
      const returnedTotal = p.outputs.filter(other => other.role === 'returned' && other.resource === o.resource && other.unit === o.unit).reduce((sum, other) => sum + other.amount, 0);
      const recycled = o.role === 'returned' ? (reused.get(key(o.resource, o.unit)) ?? 0) * o.amount / returnedTotal : 0;
      result.outputs.push({ process: p.id, resource: o.resource, unit: o.unit, role: o.role, probability: o.probability, amount: approximate ? null : amount, basis: !known || approximate ? 'unknown' : batches.random || o.probability !== 1 ? 'expectation' : 'deterministic', reused: bounded(recycled, p.id) ? recycled : null });
      // Random byproducts cannot be substituted for guaranteed stock, even when their mean is known.
      if (!batches.random && o.probability === 1 && !(o.role === 'returned' && reused.has(key(o.resource, o.unit)))) addStock(o.resource, o.unit, batches.mean * o.amount);
    }
    if (!batches.random) stock.set(k, Math.max(0, (stock.get(k) ?? 0) - demand.mean));
    else if (!demand.random) addStock(id, unit, Math.max(0, successes * output.amount - demand.mean));
    return result.status !== 'invalid';
  };
  need(request.target.resource, fixed(request.target.amount), request.target.unit, 'recurring', []);
  const totals = new Map<string, CostTotal>();
  for (const phase of ['setup', 'recurring'] as const) {
    result.materials[phase] = [...materialMaps[phase].values()].sort((a, b) => key(a.resource, a.unit).localeCompare(key(b.resource, b.unit)));
    result.costs[phase] = [...costMaps[phase].values()].sort((a, b) => key(a.kind, a.unit).localeCompare(key(b.kind, b.unit)));
    for (const c of result.costs[phase]) {
      const k = key(c.kind, c.unit), existing = totals.get(k);
      if (!existing) totals.set(k, structuredClone(c));
      else { if (!bounded(existing.knownSubtotal + c.knownSubtotal, c.kind)) { existing.amount = null; existing.unknown.push('Accumulated total exceeds the calculation bound'); } else { existing.knownSubtotal += c.knownSubtotal; existing.amount = existing.amount === null || c.amount === null ? null : existing.amount + c.amount; } existing.unknown.push(...c.unknown); }
    }
  }
  result.costs.total = [...totals.values()];
  if (result.status !== 'complete') for (const c of result.costs.total) { c.amount = null; c.unknown = [...new Set([...c.unknown, 'Selected plan has unresolved execution, quantity, probability or cost information'])]; }
  result.evidence = [...new Set(result.steps.flatMap(s => s.evidence))].sort();
  result.diagnostics = [...new Map(result.diagnostics.map(d => [d.id, d])).values()].sort((a, b) => a.id.localeCompare(b.id));
  return result;
}
