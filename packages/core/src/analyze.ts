import { diagnostic } from './normalize.ts';
import { hash } from './hash.ts';
import { validate } from './validate.ts';
import type { Alternative, Diagnostic, Model, Process, Scenario } from './types.ts';

export interface StopReason { process: string; kind: string; target: string; message: string; evidence: string[] }
export interface Analysis {
  schemaVersion: 1; target: string; status: 'reachable' | 'unreachable' | 'unknown'; scenario: string; scenarioHash: string;
  reachable: string[]; path: string[]; evidence: string[]; stopReasons: StopReason[]; unknown: string[];
  diagnostics: Diagnostic[]; limitations: string[];
}
type Witness = { path: string[]; evidence: string[] };
const unique = (values: string[]) => [...new Set(values)];
const members = (a: Alternative) => a.resource ? [a.resource] : a.tag ? a.members ?? [] : [];
const permitted = (p: Process, s: Scenario) => p.enabled && !s.forbiddenProcesses.includes(p.id) && (s.allowedTypes === null || s.allowedTypes.includes(p.type));
/** Only explicitly declared, typed loot context values satisfy context-sensitive conditions. */
export function contextRequirement(r: Process['requirements'][number], s: Scenario): 'met' | 'unmet' | 'unknown' {
  if (r.kind !== 'context') return 'unknown';
  const rules = s.gameRules;
  if (!rules || typeof rules !== 'object' || Array.isArray(rules)) return 'unknown';
  const context = rules.lootContext;
  if (!context || typeof context !== 'object' || Array.isArray(context) || !Object.hasOwn(context, r.id)) return 'unknown';
  const actual = context[r.id], expected = r.predicate ?? true;
  if (r.id === 'tool' && typeof actual === 'string' && expected && typeof expected === 'object' && !Array.isArray(expected) && Object.keys(expected).length === 1 && Array.isArray(expected.anyOf) && expected.anyOf.every(v => typeof v === 'string')) return expected.anyOf.includes(actual) ? 'met' : 'unmet';
  if (!['boolean', 'number', 'string'].includes(typeof actual) || typeof actual !== typeof expected) return 'unknown';
  return actual === expected ? 'met' : 'unmet';
}

/** Only the independent slot placement emitted by the vanilla shaped adapter is interpreted. */
export function uninterpretedConstraints(p: Process): string[] {
  if (p.constraints === undefined || p.constraints === null) return [];
  const value = p.constraints;
  if (typeof value !== 'object' || Array.isArray(value) || value.kind !== 'shaped-grid' || p.type !== 'minecraft:crafting_shaped' || Object.keys(value).some(key => key !== 'kind' && key !== 'layout')) return ['Process contains an uninterpreted linked or custom constraint'];
  const layout = value.layout;
  if (!Array.isArray(layout) || layout.length < 1 || layout.length > 3 || !Array.isArray(layout[0]) || layout[0].length < 1 || layout[0].length > 3 || !layout.every(row => Array.isArray(row) && row.length === (layout[0] as unknown[]).length)) return ['Shaped grid constraint has an invalid layout'];
  const indices = layout.flat().filter(index => index !== null);
  if (indices.length !== p.inputs.length || new Set(indices).size !== indices.length || indices.some(index => typeof index !== 'number' || !Number.isInteger(index) || index < 0 || index >= p.inputs.length)) return ['Shaped grid constraint does not map each input slot exactly once'];
  return [];
}

/** Qualitative least fixed point over AND slots and OR alternatives. It does not schedule finite stock. */
export function analyze(model: Model, scenario: Scenario, target: string): Analysis {
  const s = validate<Scenario>('scenario', scenario);
  const known = new Map<string, Witness>(), possible = new Set<string>();
  for (const [id, amount] of Object.entries(s.inventory)) if (amount > 0) known.set(id, { path: [id], evidence: [] });
  for (const id of s.equipment) known.set(id, { path: [id], evidence: [] });
  for (const id of [...s.stages, ...s.dimensions]) known.set(id, { path: [id], evidence: [] });
  for (const id of known.keys()) possible.add(id);
  const closed = s.closed && s.closedResources.includes(target) && model.coverage.length > 0 && model.coverage.every(c => c.status === 'complete' && c.enumerated !== null && (c.dataset !== 'normalization' || c.interpreted !== null && c.enumerated === c.interpreted)) && !model.processes.some(p => permitted(p, s) && p.execution !== 'display' && p.interpretation === 'opaque' && !p.outputs.length);
  // Outside the explicitly closed domain a missing supply is unknown, not impossible.
  const externalPossible = (id: string) => !s.closed || !s.closedResources.includes(id);
  const alternativeKnown = (a: Alternative) => a.predicate === undefined && a.components === undefined ? members(a).find(id => known.has(id)) : undefined;
  const alternativePossible = (a: Alternative) => a.predicate !== undefined || members(a).some(id => possible.has(id) || externalPossible(id));
  const capability = (id: string) => model.resources.some(r => r.id === id && ['capability', 'equipment'].includes(r.kind));
  const unlock = (id: string, kind: string) => model.resources.some(r => r.id === id && r.kind === kind);
  const requirementKnown = (r: Process['requirements'][number]) => r.kind === 'equipment' ? s.equipment.includes(r.id) || capability(r.id) && known.has(r.id) : r.kind === 'stage' ? s.stages.includes(r.id) || unlock(r.id, 'stage') && known.has(r.id) : r.kind === 'dimension' ? s.dimensions.includes(r.id) || unlock(r.id, 'dimension') && known.has(r.id) : r.kind === 'context' ? contextRequirement(r, s) === 'met' : false;
  const requirementPossible = (r: Process['requirements'][number]) => r.kind === 'equipment' ? s.equipment.includes(r.id) || capability(r.id) && possible.has(r.id) || externalPossible(r.id) : r.kind === 'stage' || r.kind === 'dimension' ? requirementKnown(r) || unlock(r.id, r.kind) && possible.has(r.id) : r.kind === 'context' ? contextRequirement(r, s) !== 'unmet' : r.kind === 'opaque';
  const sorted = [...model.processes].sort((a, b) => a.id.localeCompare(b.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of sorted) {
      if (!permitted(p, s) || p.execution === 'display') continue;
      const chosen = p.inputs.map(slot => slot.alternatives.map(alternativeKnown).find(Boolean));
      const sure = p.interpretation === 'supported' && p.execution === 'executable' && !p.unknown.length && !p.conflicts.length && !uninterpretedConstraints(p).length && chosen.every(Boolean) && p.requirements.every(requirementKnown);
      const maybe = (p.interpretation === 'opaque' || p.inputs.every(slot => slot.alternatives.some(alternativePossible))) && p.requirements.every(requirementPossible);
      for (const output of p.outputs) {
        if (output.probability === 0) continue;
        if (sure && output.probability !== null && !known.has(output.resource)) {
          const dependencies = [...chosen.filter((id): id is string => !!id), ...p.requirements.filter(r => ['equipment', 'stage', 'dimension'].includes(r.kind)).map(r => r.id)];
          const witnesses = dependencies.map(id => known.get(id)!);
          known.set(output.resource, { path: unique([...witnesses.flatMap(w => w.path), p.id, output.resource]), evidence: unique([...witnesses.flatMap(w => w.evidence), ...p.evidence, ...output.evidence, ...p.inputs.flatMap(i => i.evidence), ...p.requirements.flatMap(r => r.evidence)]) });
          changed = true;
        }
        if ((sure || maybe) && !possible.has(output.resource)) { possible.add(output.resource); changed = true; }
      }
    }
  }
  const relatedResources = new Set<string>([target]), relatedProcesses = new Set<string>();
  const queue = [target];
  while (queue.length) {
    const id = queue.shift()!;
    for (const p of sorted.filter(p => p.outputs.some(o => o.resource === id && o.probability !== 0))) {
      if (relatedProcesses.has(p.id)) continue;
      relatedProcesses.add(p.id);
      for (const dep of [...p.inputs.flatMap(slot => slot.alternatives.flatMap(members)), ...p.requirements.filter(r => r.kind === 'equipment' || (r.kind === 'stage' || r.kind === 'dimension') && unlock(r.id, r.kind)).map(r => r.id)]) {
        if (!relatedResources.has(dep)) { relatedResources.add(dep); queue.push(dep); }
      }
    }
  }
  const stopReasons: StopReason[] = [];
  const stop = (p: Process, kind: string, id: string, message: string) => stopReasons.push({ process: p.id, kind, target: id, message, evidence: unique([...p.evidence, ...p.inputs.flatMap(i => i.evidence), ...p.requirements.flatMap(r => r.evidence)]) });
  for (const p of sorted.filter(p => relatedProcesses.has(p.id))) {
    if (!p.enabled) stop(p, 'disabled', p.id, 'Process is disabled');
    else if (s.forbiddenProcesses.includes(p.id) || (s.allowedTypes !== null && !s.allowedTypes.includes(p.type))) stop(p, 'forbidden', p.id, 'Scenario excludes this acquisition method');
    if (p.execution !== 'executable') stop(p, p.execution, p.id, p.execution === 'display' ? 'Display-only process cannot prove execution' : 'Execution has not been confirmed');
    if (p.interpretation === 'opaque' || p.unknown.length || p.conflicts.length) stop(p, 'uninterpreted', p.id, [...p.unknown, ...p.conflicts, ...(p.interpretation === 'opaque' ? ['Opaque process'] : [])].join('; '));
    for (const reason of uninterpretedConstraints(p)) stop(p, 'constraints', p.id, reason);
    for (const [index, slot] of p.inputs.entries()) if (!slot.alternatives.some(alternativeKnown)) {
      const opaque = slot.alternatives.some(a => a.predicate !== undefined || a.components !== undefined);
      stop(p, opaque ? 'opaque-ingredient' : 'input', `${p.id}/inputs/${index}`, opaque ? 'Ingredient predicate or stack components are not evaluated' : `No available candidate: ${slot.alternatives.flatMap(members).join(', ') || 'empty alternatives'}`);
    }
    for (const r of p.requirements) if (!requirementKnown(r)) stop(p, r.kind === 'context' && contextRequirement(r, s) === 'unknown' ? 'unknown-context' : r.kind, r.id, r.kind === 'opaque' ? 'Requirement has no interpreter' : `Missing ${r.kind}: ${r.id}`);
    for (const o of p.outputs) if (o.resource === target && o.probability === null) stop(p, 'probability', target, 'Output probability was not acquired');
  }
  const witness = known.get(target);
  const finiteUnproven = s.supply === 'finite' && !!witness && !(s.inventory[target] > 0 || s.equipment.includes(target));
  let status: Analysis['status'] = witness && !finiteUnproven ? 'reachable' : closed && !possible.has(target) && !externalPossible(target) ? 'unreachable' : 'unknown';
  // Closed declarations do not establish closure over dependencies or missing coverage.
  if (status === 'unreachable' && [...relatedResources].some(id => !s.closedResources.includes(id))) status = 'unknown';
  const unknown = unique([
    ...stopReasons.filter(r => ['opaque', 'opaque-ingredient', 'uninterpreted', 'unconfirmed', 'probability', 'constraints', 'unknown-context'].includes(r.kind)).map(r => r.message),
    ...(!closed && !witness ? ['Acquisition coverage or the declared resource scope is not closed'] : []),
    ...(finiteUnproven ? ['Finite inventory quantities and competing consumption have not been scheduled'] : []),
  ]);
  const diagnostics = equipmentCycles(model, s, relatedProcesses, known);
  const evidence = witness?.evidence ?? unique(stopReasons.flatMap(r => r.evidence));
  const d = diagnostic(model, 'reachability', target, status === 'reachable' ? 'Reachable within the qualitative model' : status === 'unreachable' ? 'Unreachable in the declared closed scope' : 'Reachability cannot be proven from the available information', status === 'unreachable' ? 'error' : 'info', status === 'unknown' ? 'unknown' : 'confirmed', evidence);
  d.scenario = s.id; d.id = hash({ rule: d.rule, target, scenario: s.id }).slice(0, 24); d.path = witness?.path ?? []; d.unknown = unknown;
  diagnostics.push(d);
  return { schemaVersion: 1, target, status, scenario: s.id, scenarioHash: hash(s), reachable: [...known.keys()].sort(), path: witness?.path ?? [], evidence, stopReasons, unknown, diagnostics, limitations: ['Targets describe resource types; exact output stack components are not proven', 'Qualitative reachability does not prove a quantity-feasible execution schedule or sufficient tool durability', 'Nonzero probabilities establish possible acquisition, not guaranteed results or independent draws', 'World generation configuration and finite observations do not prove unlimited natural supply; opaque code and unmodeled state changes remain unknown'] };
}

function equipmentCycles(model: Model, scenario: Scenario, related: Set<string>, known: Map<string, Witness>): Diagnostic[] {
  const edges = new Map<string, Set<string>>();
  const edge = (a: string, b: string) => { if (!edges.has(a)) edges.set(a, new Set()); edges.get(a)!.add(b); if (!edges.has(b)) edges.set(b, new Set()); };
  const eligible = model.processes.filter(p => related.has(p.id) && permitted(p, scenario) && p.execution !== 'display');
  for (const p of eligible) for (const o of p.outputs.filter(o => o.probability !== 0)) {
    for (const dep of [...p.inputs.flatMap(i => i.alternatives.flatMap(members)), ...p.requirements.filter(r => r.kind === 'equipment').map(r => r.id)]) edge(dep, o.resource);
  }
  let next = 0; const index = new Map<string, number>(), low = new Map<string, number>(), stack: string[] = [], active = new Set<string>(), components: string[][] = [];
  const visit = (v: string) => {
    index.set(v, next); low.set(v, next++); stack.push(v); active.add(v);
    for (const w of edges.get(v) ?? []) { if (!index.has(w)) { visit(w); low.set(v, Math.min(low.get(v)!, low.get(w)!)); } else if (active.has(w)) low.set(v, Math.min(low.get(v)!, index.get(w)!)); }
    if (low.get(v) === index.get(v)) { const group: string[] = []; let w: string; do { w = stack.pop()!; active.delete(w); group.push(w); } while (w !== v); components.push(group); }
  };
  for (const id of [...edges.keys()].sort()) if (!index.has(id)) visit(id);
  return components.filter(c => (c.length > 1 || edges.get(c[0]!)?.has(c[0]!)) && !c.some(id => known.has(id)) && eligible.some(p => p.requirements.some(r => r.kind === 'equipment' && c.includes(r.id)) && p.outputs.some(o => c.includes(o.resource)))).map(c => {
    c.sort(); const ps = eligible.filter(p => p.outputs.some(o => c.includes(o.resource)));
    const d = diagnostic(model, 'equipment-cycle-candidate', c.join('|'), 'Equipment and its construction inputs form a cycle with no proven initial or external supply', 'warning', 'unknown', unique(ps.flatMap(p => p.evidence)));
    d.scenario = scenario.id; d.id = hash({ rule: d.rule, target: d.target, scenario: scenario.id }).slice(0, 24); d.path = c; d.unknown = ['A cycle alone is not proof of a defect']; return d;
  });
}
