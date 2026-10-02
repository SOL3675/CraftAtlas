import { canonical, hash } from './hash.ts';
import type { Model, Process } from './types.ts';

export interface Change { kind: 'process' | 'tag' | 'resource' | 'coverage'; id: string; fields: string[]; before: unknown; after: unknown; evidence: string[] }
export interface ModelDiff {
  schemaVersion: 1; before: string; after: string; changes: Change[];
  impact: { resources: string[]; processes: string[]; truncated: boolean };
  provenance: { normalizerChanged: boolean; environmentChanged: boolean; modsChanged: boolean; definitionsChanged: boolean };
}
const sorted = (values: unknown[]) => [...values].sort((a, b) => canonical(a).localeCompare(canonical(b)));
function opaqueMeaning(p: Process): unknown {
  if (p.type !== 'minecraft:observation' || !p.raw || typeof p.raw !== 'object' || Array.isArray(p.raw)) return p.raw;
  // Observer execution metadata changes on a repeated sample; trial conditions and results do not.
  const acquisition = new Set(['timestamp', 'capturedAt', 'createdAt', 'session', 'generation']);
  return Object.fromEntries(Object.entries(p.raw).filter(([key]) => !acquisition.has(key)));
}
export function processMeaning(p: Process): Record<string, unknown> {
  const inputs = p.inputs.map(({ evidence, alternatives, ...s }) => ({ ...s, alternatives: sorted(alternatives.map(a => ({ ...a, ...(a.members ? { members: [...a.members].sort() } : {}) }))) }));
  return { id: p.id, type: p.type, inputs: p.constraints ? inputs : sorted(inputs), outputs: sorted(p.outputs.map(({ evidence, ...o }) => o)), requirements: sorted(p.requirements.map(({ evidence, ...r }) => r)), interpretation: p.interpretation, execution: p.execution, enabled: p.enabled, unknown: [...p.unknown].sort(), costs: sorted(p.costs), conflicts: [...p.conflicts].sort(), constraints: p.constraints ?? null, opaqueRawHash: p.interpretation === 'opaque' ? hash(opaqueMeaning(p)) : null, viewerSources: sorted((p.viewerSources ?? []).map(v => ({ recipeId: v.recipeId, category: v.category, inputs: v.inputs.map(({ evidence, ...s }) => s), outputs: v.outputs.map(({ evidence, ...o }) => o), equipment: [...v.equipment].sort(), execution: v.execution, unknown: [...v.unknown].sort() }))) };
}
/** Compare meaning, independent of acquisition IDs, order, raw data, and timestamps. */
export function diff(before: Model, after: Model, options: { limit?: number } = {}): ModelDiff {
  const changes: Change[] = [];
  const compare = (kind: Change['kind'], a: Map<string, Record<string, unknown>>, b: Map<string, Record<string, unknown>>, evidence: (id: string) => string[] = () => []) => {
    for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      const left = a.get(id), right = b.get(id);
      if (hash(left ?? null) === hash(right ?? null)) continue;
      const fields = !left ? ['added'] : !right ? ['removed'] : [...new Set([...Object.keys(left), ...Object.keys(right)])].filter(field => hash({ value: left[field] }) !== hash({ value: right[field] })).sort();
      changes.push({ kind, id, fields, before: left ?? null, after: right ?? null, evidence: [...new Set(evidence(id))].sort() });
    }
  };
  compare('process', new Map(before.processes.map(p => [p.id, processMeaning(p)])), new Map(after.processes.map(p => [p.id, processMeaning(p)])), id => [...before.processes, ...after.processes].filter(p => p.id === id).flatMap(p => p.evidence));
  compare('tag', new Map(Object.entries(before.tags).map(([id, members]) => [id, { members: [...members].sort() }])), new Map(Object.entries(after.tags).map(([id, members]) => [id, { members: [...members].sort() }])));
  compare('resource', new Map(before.resources.map(({ evidence, ...r }) => [r.id, r])), new Map(after.resources.map(({ evidence, ...r }) => [r.id, r])), id => [...before.resources, ...after.resources].filter(r => r.id === id).flatMap(r => r.evidence));
  compare('coverage', new Map(before.coverage.map(c => [`${c.dataset}/${c.type}`, { ...c, reasons: [...c.reasons].sort() }])), new Map(after.coverage.map(c => [`${c.dataset}/${c.type}`, { ...c, reasons: [...c.reasons].sort() }])));
  const limit = Math.max(1, Math.min(100_000, options.limit ?? 1000)), resources = new Set<string>(), processes = new Set<string>(); let truncated = false;
  const enqueueResource = (id: string) => { if (resources.has(id)) return; if (resources.size + processes.size >= limit) { truncated = true; return; } resources.add(id); queue.push(id); };
  const enqueueProcess = (p: Process) => { if (!processes.has(p.id)) { if (resources.size + processes.size >= limit) { truncated = true; return; } processes.add(p.id); } for (const o of p.outputs) enqueueResource(o.resource); };
  const queue: string[] = [], all = [...before.processes, ...after.processes];
  for (const c of changes) {
    if (c.kind === 'resource') enqueueResource(c.id);
    else if (c.kind === 'process') for (const p of all.filter(p => p.id === c.id)) enqueueProcess(p);
    else if (c.kind === 'tag') for (const p of all.filter(p => p.inputs.some(i => i.alternatives.some(a => a.tag === c.id)))) enqueueProcess(p);
  }
  while (queue.length) {
    const id = queue.shift()!;
    for (const p of all) if (p.inputs.some(i => i.alternatives.some(a => a.resource === id || a.members?.includes(id))) || p.requirements.some(r => ['equipment', 'stage', 'dimension'].includes(r.kind) && r.id === id)) enqueueProcess(p);
  }
  const definitionVersions = (m: Model) => [...new Set(m.evidence.filter(e => e.kind === 'definition').map(e => e.source))].sort();
  return { schemaVersion: 1, before: before.snapshotId, after: after.snapshotId, changes, impact: { resources: [...resources].sort(), processes: [...processes].sort(), truncated }, provenance: { normalizerChanged: before.normalizerVersion !== after.normalizerVersion, environmentChanged: hash(before.environment) !== hash(after.environment), modsChanged: hash(sorted(before.mods)) !== hash(sorted(after.mods)), definitionsChanged: hash(definitionVersions(before)) !== hash(definitionVersions(after)) } };
}
