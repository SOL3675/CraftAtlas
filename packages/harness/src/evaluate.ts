import type { Model, Scenario, Expectations } from '../../core/src/types.ts';
import { audit } from '../../core/src/audit.ts';
import type { Case } from './common.ts';
/** Unknown mandatory checks are unsupported, evaluated violations are failed. */
export function evaluate(model: Model, expectations: Expectations, scenario?: Scenario): Case {
  const count = expectations.recipes.length + expectations.nonemptyTags.length + expectations.supportedTypes.length + expectations.reachable.length + expectations.unreachable.length;
  if (!count) return { id: 'atlas.expectations', status: 'unsupported', message: 'No mandatory expectations were declared' };
  const diagnostics = audit(model, expectations, scenario), violations = diagnostics.filter(d => d.severity === 'error');
  if (violations.length) return { id: 'atlas.expectations', status: 'failed', message: violations.map(d => `${d.rule}: ${d.target}`).join('; ') };
  const unknown = diagnostics.filter(d => d.status === 'unknown' && d.severity === 'warning');
  return { id: 'atlas.expectations', status: unknown.length ? 'unsupported' : 'passed', message: unknown.length ? unknown.map(d => `${d.rule}: ${d.target}`).join('; ') : 'All mandatory expectations evaluated' };
}
