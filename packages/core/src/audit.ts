import { analyze, uninterpretedConstraints } from './analyze.ts';
import { diagnostic } from './normalize.ts';
import { hash } from './hash.ts';
import { validate } from './validate.ts';
import type { Diagnostic, Expectations, Model, Process, Scenario } from './types.ts';

function unparsedFields(p: Process): string[] {
  return [
    ...p.unknown,
    ...p.conflicts,
    ...uninterpretedConstraints(p),
    ...(p.interpretation !== 'supported' ? ['Process interpreter is unavailable'] : []),
    ...(p.execution !== 'executable' ? [`Execution is ${p.execution}`] : []),
    ...p.requirements.filter(r => r.kind === 'opaque').map(r => `Opaque requirement: ${r.id}`),
    ...p.inputs.flatMap((s, index) => s.alternatives.some(a => a.predicate !== undefined || a.components !== undefined) ? [`Unevaluated ingredient predicate or components at slot ${index}`] : []),
    ...p.outputs.filter(o => o.probability === null).map(o => `Unacquired output probability: ${o.resource}`),
    ...p.costs.filter(c => c.amount === null).map(c => `Unacquired ${c.kind} cost (${c.unit})`),
  ];
}

/** Report violations and unknown required checks. An empty result means every requested check was evaluated. */
export function audit(model: Model, expectations: Expectations, scenario?: Scenario): Diagnostic[] {
  const e = validate<Expectations>('expectations', expectations);
  const results: Diagnostic[] = [];
  const complete = (dataset: string) => { const rows = model.coverage.filter(c => c.dataset === dataset); return rows.length > 0 && rows.every(c => c.status === 'complete' && c.enumerated !== null); };
  const add = (rule: string, target: string, message: string, known: boolean, evidence: string[] = []) => results.push(diagnostic(model, rule, target, message, known ? 'error' : 'warning', known ? 'confirmed' : 'unknown', evidence));
  const provenance = new Map(model.evidence.map(e => [e.id, e]));
  const hasRuntimeRecipe = (p: Process) => p.evidence.some(id => { const e = provenance.get(id); return e?.kind === 'runtime' && (e.pointer === 'recipes' || e.pointer.startsWith('recipes/')); });
  const hasDefinitionAddition = (p: Process) => p.evidence.some(id => { const e = provenance.get(id); return e?.kind === 'definition' && e.pointer.startsWith('additions/'); });
  for (const id of e.recipes) if (!model.processes.some(p => hasRuntimeRecipe(p) && (p.id === id || p.sourceId === id) || hasDefinitionAddition(p) && p.id === id)) add('required-recipe', id, 'Required runtime recipe or explicit definition process was not found', complete('recipes'));
  for (const tag of e.nonemptyTags) if (!(model.tags[tag]?.length)) add('required-tag', tag, tag in model.tags ? 'Required tag has no members' : 'Required tag was not acquired', tag in model.tags || complete('tags'));
  for (const type of e.supportedTypes) {
    const ps = model.processes.filter(p => p.type === type && p.enabled);
    const cov = model.coverage.filter(c => c.dataset === 'normalization' && c.type === type);
    if (!ps.length || !cov.length || cov.some(c => c.status !== 'complete' || c.enumerated === null || c.interpreted !== c.enumerated) || ps.some(p => unparsedFields(p).length > 0)) {
      const d = diagnostic(model, 'required-supported-type', type, ps.length ? 'Required type has incomplete interpretation' : 'No recipes were evaluated for the required type', 'warning', 'unknown', [...new Set(ps.flatMap(p => p.evidence))]);
      d.unknown = [...new Set([...ps.flatMap(unparsedFields), ...cov.flatMap(c => c.reasons)])]; results.push(d);
    }
  }
  const resources = new Set(model.resources.map(r => r.id)), evidence = new Set(model.evidence.map(e => e.id));
  for (const p of model.processes) {
    const references = [...p.outputs.map(o => o.resource), ...p.inputs.flatMap(slot => slot.alternatives.flatMap(a => a.resource ? [a.resource] : a.members ?? []))];
    for (const id of [...new Set(references)].sort()) if (!resources.has(id)) add('missing-resource-reference', `${p.id}/${id}`, `Process refers to unregistered resource ${id}`, complete('resources') || complete('registry') || complete('registries'), p.evidence);
    for (const a of p.inputs.flatMap(s => s.alternatives)) if (a.tag && !(a.tag in model.tags)) add('missing-tag-reference', `${p.id}/${a.tag}`, 'Process refers to a tag which was not acquired', complete('tags'), p.evidence);
    const refs = [...p.evidence, ...Object.values(p.fieldEvidence).flat(), ...p.inputs.flatMap(i => i.evidence), ...p.outputs.flatMap(o => o.evidence), ...p.requirements.flatMap(r => r.evidence)];
    for (const id of [...new Set(refs)].sort()) if (!evidence.has(id)) add('missing-evidence-reference', `${p.id}/${id}`, `Missing provenance evidence ${id}`, true);
  }
  for (const [tag, ids] of Object.entries(model.tags)) for (const id of ids) if (!resources.has(id)) add('missing-tag-member', `${tag}/${id}`, 'Tag member is absent from the resource registry', complete('resources') || complete('registry') || complete('registries'));
  for (const [expected, targets] of [['reachable', e.reachable], ['unreachable', e.unreachable]] as const) for (const target of targets) {
    if (!scenario) { add('required-reachability', `${expected}/${target}`, 'A scenario is required to evaluate reachability expectations', false); continue; }
    const result = analyze(model, scenario, target);
    if (result.status !== expected) {
      const d = diagnostic(model, 'expected-reachability', `${expected}/${target}`, result.status === 'unknown' ? `Required ${expected} check could not be evaluated` : `Expected ${expected}, observed ${result.status}`, result.status === 'unknown' ? 'warning' : 'error', result.status === 'unknown' ? 'unknown' : 'confirmed', result.evidence);
      d.scenario = scenario.id; d.id = hash({ rule: d.rule, target: d.target, scenario: scenario.id }).slice(0, 24); d.path = result.path; d.unknown = result.unknown; results.push(d);
    }
    results.push(...result.diagnostics.filter(d => d.rule === 'equipment-cycle-candidate'));
  }
  for (const c of model.coverage) if (c.status !== 'complete') {
    const d = diagnostic(model, 'incomplete-coverage', `${c.dataset}/${c.type}`, `Acquisition or interpretation coverage is ${c.status}`, 'info', 'unknown'); d.unknown = c.reasons; results.push(d);
  }
  const deduped = new Map(results.map(d => [d.id, d]));
  return [...deduped.values()].sort((a, b) => a.id.localeCompare(b.id));
}
