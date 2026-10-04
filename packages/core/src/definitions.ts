import { diagnostic, semanticHash } from './normalize.ts';
import { hash } from './hash.ts';
import { uninterpretedConstraints } from './analyze.ts';
import { validate, validateModel } from './validate.ts';
import type { DefinitionPack, Json, Model, Process } from './types.ts';

/** Capability marker for consumers requiring validated references and interpretation patches. */
export const definitionContractVersion = 2;

export interface DefinitionEnvironment { minecraft: string; loader: string }
type Operation = DefinitionPack['operations'][number];
type Proposal = { pack: DefinitionPack; op: Operation; key: string; evidence: string };
const fields = ['inputs', 'outputs', 'requirements', 'costs', 'unknown', 'execution', 'interpretation'] as const;
const unique = (values: string[]) => [...new Set(values)];

/** Apply a deterministic overlay. Original runtime raw values are never rewritten. */
export function applyDefinitions(model: Model, packs: DefinitionPack[], environment: DefinitionEnvironment): Model {
  const m = structuredClone(model);
  const all = packs.map(p => validate<DefinitionPack>('definitions', p)).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  const report = (rule: string, target: string, message: string, evidence: string[] = [], status: 'confirmed' | 'unknown' = 'confirmed') => m.diagnostics.push(diagnostic(m, rule, target, message, 'warning', status, evidence));
  const duplicates = new Set(all.filter(p => all.filter(other => p.id === other.id).length > 1).map(p => p.id));
  for (const id of [...duplicates].sort()) report('definition-duplicate', id, 'Definition pack ID occurs more than once; all copies are excluded');
  const eligible: DefinitionPack[] = [];
  for (const pack of all) {
    if (duplicates.has(pack.id)) continue;
    if (pack.targets.minecraft !== environment.minecraft || pack.targets.loader !== environment.loader) { report('definition-environment-mismatch', pack.id, `Expected ${pack.targets.loader}/${pack.targets.minecraft}, found ${environment.loader}/${environment.minecraft}`); continue; }
    let valid = true;
    for (const target of pack.targets.mods) {
      const mod = m.mods.find(mod => mod.id === target.id);
      if (!mod) { report('definition-mod-missing', `${pack.id}/${target.id}`, 'Target Mod is absent'); valid = false; }
      else if (!target.versions.includes(mod.version)) { report('definition-version-mismatch', `${pack.id}/${target.id}`, `Mod version ${mod.version} is outside the explicitly supported versions`); valid = false; }
    }
    if (new Set(pack.operations.map(o => o.id)).size !== pack.operations.length) { report('definition-operation-duplicate', pack.id, 'Operation IDs must be unique within a pack'); valid = false; }
    if (new Set(pack.additions.map(p => p.id)).size !== pack.additions.length) { report('definition-addition-duplicate', pack.id, 'Added process IDs must be unique within a pack'); valid = false; }
    if (valid) eligible.push(pack);
  }
  const proposals = new Map<string, Proposal[]>();
  const operationIndex = eligible.flatMap(pack => pack.operations.map(op => ({ pack, op, key: `${pack.id}:${op.id}` })));
  const addEvidence = (id: string, pack: DefinitionPack, pointer: string) => {
    if (m.evidence.some(e => e.id === id)) { report('definition-evidence-conflict', id, 'Definition evidence ID already exists'); return false; }
    m.evidence.push({ id, kind: 'definition', source: `${pack.id}@${pack.version}`, adapter: 'definition-overlay-v1', pointer }); return true;
  };
  for (const pack of eligible) for (const op of pack.operations) {
    const key = `${pack.id}:${op.id}`, ev = `definition:${pack.id}@${pack.version}:${op.id}`;
    if (op.selector.id === undefined && op.selector.type === undefined) { report('definition-selector-missing', key, 'Selector must explicitly name an ID or type'); continue; }
    if (op.override.some(id => { const matches = operationIndex.filter(v => v.key === id || v.op.id === id); return matches.length !== 1 || matches[0]!.pack.priority >= pack.priority; })) {
      report('definition-invalid-override', key, 'Override must identify exactly one operation with lower priority'); continue;
    }
    const targets = m.processes.filter(p => (op.selector.id === undefined || p.id === op.selector.id) && (op.selector.type === undefined || p.type === op.selector.type));
    if (!targets.length) { report('definition-selector-empty', key, 'Selector matched no existing process'); continue; }
    if (op.action === 'append' && (op.patch.execution !== undefined || op.patch.interpretation !== undefined)) { report('definition-invalid-append', key, 'Scalar execution/interpretation state requires replace'); continue; }
    if (op.action === 'disable' && Object.keys(op.patch).length) { report('definition-invalid-disable', key, 'Disable operations cannot contain a field patch'); continue; }
    if (!addEvidence(ev, pack, `${op.evidence}; operations/${op.id}; verified: ${pack.verified.join(', ') || 'none'}`)) continue;
    for (const target of targets) { const values = proposals.get(target.id) ?? []; values.push({ pack, op, key, evidence: ev }); proposals.set(target.id, values); }
  }
  const overrides = (later: Proposal, earlier: Proposal) => later.pack.priority > earlier.pack.priority && (later.op.override.includes(earlier.key) || later.op.override.includes(earlier.op.id));
  const patchValue = (proposal: Proposal, field: typeof fields[number]) => {
    const value = structuredClone(proposal.op.patch[field]);
    if (['inputs', 'outputs', 'requirements'].includes(field)) for (const fact of value as { evidence: string[] }[]) fact.evidence = unique([...fact.evidence, proposal.evidence]);
    return value;
  };
  for (const p of m.processes) {
    const values = proposals.get(p.id) ?? [];
    for (const field of [...fields, 'enabled'] as const) {
      const candidates = values.filter(v => field === 'enabled' ? v.op.action === 'disable' : v.op.action !== 'disable' && v.op.patch[field] !== undefined);
      if (!candidates.length) continue;
      const active = candidates.filter(v => !candidates.some(later => overrides(later, v)));
      const replace = active.filter(v => v.op.action !== 'append');
      // Multiple replacements or append plus replacement must be resolved explicitly, even when priorities differ.
      if (replace.length > 1 || (replace.length && active.length > 1)) {
        const message = `Conflicting overlays for ${field}: ${active.map(v => v.key).sort().join(', ')}`;
        p.conflicts.push(message); report('definition-conflict', `${p.id}/${field}`, message, active.map(v => v.evidence)); continue;
      }
      const previous = p[field];
      p.fieldHistory ??= {};
      (p.fieldHistory[field] ??= []).push({ value: structuredClone(previous) as Json, evidence: [...(p.fieldEvidence[field] ?? p.evidence)] });
      if (replace.length) {
        const proposal = replace[0]!;
        if (field === 'enabled') p.enabled = false;
        else (p as unknown as Record<string, unknown>)[field] = patchValue(proposal, field);
        if (field !== 'enabled' && hash(previous) !== hash(p[field])) report('definition-runtime-contradiction', `${p.id}/${field}`, 'Definition replaces a recorded field; original raw data and evidence remain available', unique([...(p.fieldEvidence[field] ?? p.evidence), proposal.evidence]));
      } else if (field !== 'enabled') {
        const current = previous as unknown[];
        const added = active.flatMap(v => patchValue(v, field) as unknown[]);
        const seen = new Set<string>();
        (p as unknown as Record<string, unknown>)[field] = [...current, ...structuredClone(added)].filter(value => { const key = hash(value); if (seen.has(key)) return false; seen.add(key); return true; });
      }
      p.fieldEvidence[field] = unique([...(p.fieldEvidence[field] ?? p.evidence), ...active.map(v => v.evidence)]);
      p.evidence = unique([...p.evidence, ...active.map(v => v.evidence)]);
    }
  }
  const additions = new Map<string, { process: Process; pack: DefinitionPack }[]>();
  for (const pack of eligible) for (const process of pack.additions) { const values = additions.get(process.id) ?? []; values.push({ process, pack }); additions.set(process.id, values); }
  for (const [id, values] of [...additions.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (m.processes.some(p => p.id === id) || values.length > 1) { report('definition-addition-conflict', id, 'Added process ID conflicts with an existing process or another definition'); continue; }
    const { process, pack } = values[0]!, ev = `definition:${pack.id}@${pack.version}:addition:${id}`;
    if (!addEvidence(ev, pack, `additions/${id}; verified: ${pack.verified.join(', ') || 'none'}`)) continue;
    const p = structuredClone(process); p.evidence = unique([...p.evidence, ev]);
    for (const field of fields) p.fieldEvidence[field] = unique([...(p.fieldEvidence[field] ?? []), ev]);
    for (const value of [...p.inputs, ...p.outputs, ...p.requirements]) value.evidence = unique([...value.evidence, ev]);
    m.processes.push(p);
  }
  // Definition references are checked against captured registries, never invented.
  const resources = new Set(m.resources.map(r => r.id));
  for (const p of m.processes.filter(p => p.evidence.some(id => id.startsWith('definition:')))) {
    const missing: string[] = [];
    for (const slot of p.inputs) for (const a of slot.alternatives) {
      if ([a.resource, a.tag, a.predicate].filter(v => v !== undefined).length !== 1) missing.push('Alternative must select exactly one resource, tag or predicate');
      if (a.tag) {
        if (!(a.tag in m.tags)) { a.members = []; missing.push(`Tag not acquired: ${a.tag}`); }
        else {
          // Always expand from this capture; author-supplied membership cannot create supply.
          a.members = [...m.tags[a.tag]!].sort();
          slot.evidence = unique([...slot.evidence, 'runtime:tags']);
        }
      }
      for (const id of a.resource ? [a.resource] : a.members ?? []) if (!resources.has(id)) missing.push(`Resource not acquired: ${id}`);
    }
    for (const o of p.outputs) if (!resources.has(o.resource)) missing.push(`Resource not acquired: ${o.resource}`);
    for (const reason of unique(missing)) {
      p.unknown = unique([...p.unknown, reason]);
      report('definition-reference-missing', p.id, reason, p.evidence, 'unknown');
    }
  }
  // Capture coverage remains untouched. Only derived recipe interpretation is rebuilt.
  // The original model, raw values, field histories and unsupported diagnostics remain evidence.
  const reasons = (p: Process) => [
    ...p.unknown, ...p.conflicts, ...uninterpretedConstraints(p),
    ...(p.interpretation === 'opaque' ? ['Opaque process'] : []),
    ...(p.execution !== 'executable' ? [`Execution is ${p.execution}`] : []),
    ...p.requirements.filter(r => r.kind === 'opaque').map(r => `Opaque requirement: ${r.id}`),
    ...p.inputs.flatMap(slot => slot.alternatives.filter(a => a.predicate !== undefined || a.components !== undefined).map(() => 'Uninterpreted ingredient predicate/components')),
    ...p.costs.filter(cost => cost.amount === null).map(cost => `Cost not acquired: ${cost.kind}`),
  ];
  const coverage = (processes: Process[]) => {
    const interpreted = processes.filter(p => !reasons(p).length).length;
    return { status: interpreted === processes.length ? 'complete' as const : 'partial' as const, enumerated: processes.length, interpreted, reasons: unique(processes.flatMap(reasons)) };
  };
  const originalIds = new Set(model.processes.map(p => p.id));
  for (const c of m.coverage.filter(c => c.dataset === 'normalization')) {
    Object.assign(c, coverage(m.processes.filter(p => p.type === c.type && originalIds.has(p.id))));
  }
  const added = m.processes.filter(p => !originalIds.has(p.id));
  if (added.length) m.coverage.push({ dataset: 'definitions', type: '*', ...coverage(added) });
  m.processes.sort((a, b) => a.id.localeCompare(b.id));
  m.diagnostics.sort((a, b) => a.id.localeCompare(b.id));
  m.contentHash = semanticHash(m);
  return validateModel(m);
}
