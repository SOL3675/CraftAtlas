import type { Model, Process } from './types.ts';

export interface GraphNode { id: string; target: string; kind: 'resource' | 'process' | 'predicate'; label: string; unknown: string[]; evidence: string[] }
export interface GraphEdge { source: string; target: string; role: 'input' | 'output' | 'equipment'; slot?: number; alternative?: number; amount?: number; unit?: string; consumption?: string; tag?: string; probability?: number | null }
export interface LocalGraph { target: string; nodes: GraphNode[]; edges: GraphEdge[]; truncated: boolean; depth: number; limit: number; direction: string }

/** View-only filters never alter reachability scenarios. Slots retain their AND/OR identifiers. */
export function localGraph(model: Model, target: string, options: { depth?: number; limit?: number; direction?: 'sources' | 'uses' | 'both'; types?: string[]; rootKind?: 'resource' | 'process' } = {}): LocalGraph {
  const depth = Math.max(0, Math.min(8, options.depth ?? 2)), limit = Math.max(1, Math.min(1000, options.limit ?? 200)), direction = options.direction ?? 'both';
  const nodes = new Map<string, GraphNode>(), edges: GraphEdge[] = [], expanded = new Set<string>(); let truncated = false;
  const resourceNode = (id: string): GraphNode => { const r = model.resources.find(r => r.id === id); return { id: `resource:${id}`, target: id, kind: 'resource', label: r?.name ?? id, unknown: r ? [] : ['Resource was not acquired'], evidence: r?.evidence ?? [] }; };
  const addNode = (node: GraphNode) => { if (nodes.has(node.id)) return true; if (nodes.size >= limit) { truncated = true; return false; } nodes.set(node.id, node); return true; };
  const explicitProcess = options.rootKind === 'process' || target.startsWith('process:');
  const rootId = target.startsWith('process:') ? target.slice('process:'.length) : target;
  const rootProcess = model.processes.find(p => p.id === rootId && (explicitProcess || options.rootKind !== 'resource' && !model.resources.some(r => r.id === rootId)));
  const queue: { id: string; level: number }[] = [];
  const includeProcess = (p: Process, level: number) => {
    if (!addNode({ id: `process:${p.id}`, target: p.id, kind: 'process', label: p.id, unknown: [...p.unknown, ...(p.execution === 'executable' ? [] : [p.execution])], evidence: p.evidence })) return;
    if (expanded.has(p.id)) return; expanded.add(p.id);
    const input = (id: string, edge: Omit<GraphEdge, 'source' | 'target'>) => {
      if (addNode(resourceNode(id))) { edges.push({ source: `resource:${id}`, target: `process:${p.id}`, ...edge }); queue.push({ id, level: level + 1 }); }
    };
    for (const [slot, value] of p.inputs.entries()) for (const [alternative, a] of value.alternatives.entries()) {
      const ids = a.resource ? [a.resource] : a.members ?? [];
      for (const id of ids) input(id, { role: 'input', slot, alternative, amount: value.amount, unit: value.unit, consumption: value.consumption, ...(a.tag ? { tag: a.tag } : {}) });
      if (a.predicate !== undefined || a.components !== undefined || !ids.length) {
        const id = `predicate:${p.id}:${slot}:${alternative}`;
        if (addNode({ id, target: `${p.id}/inputs/${slot}/${alternative}`, kind: 'predicate', label: a.tag ? `#${a.tag}` : 'uninterpreted ingredient', unknown: ['No proven matching stack'], evidence: value.evidence })) edges.push({ source: id, target: `process:${p.id}`, role: 'input', slot, alternative, amount: value.amount, unit: value.unit });
      }
    }
    for (const r of p.requirements) if (r.kind === 'equipment') input(r.id, { role: 'equipment' });
    for (const o of p.outputs) if (addNode(resourceNode(o.resource))) { edges.push({ source: `process:${p.id}`, target: `resource:${o.resource}`, role: 'output', amount: o.amount, unit: o.unit, probability: o.probability }); queue.push({ id: o.resource, level: level + 1 }); }
  };
  if (rootProcess) {
    if (depth > 0) includeProcess(rootProcess, 0);
    else { addNode({ id: `process:${rootProcess.id}`, target: rootProcess.id, kind: 'process', label: rootProcess.id, unknown: rootProcess.unknown, evidence: rootProcess.evidence }); truncated = rootProcess.inputs.length > 0 || rootProcess.outputs.length > 0 || rootProcess.requirements.length > 0; }
  } else { addNode(resourceNode(rootId)); queue.push({ id: rootId, level: 0 }); }
  const visited = new Map<string, number>();
  while (queue.length) {
    const { id, level } = queue.shift()!;
    if ((visited.get(id) ?? Infinity) <= level) continue; visited.set(id, level);
    const ps = model.processes.filter(p => (!options.types || options.types.includes(p.type)) && ((direction !== 'uses' && p.outputs.some(o => o.resource === id)) || (direction !== 'sources' && (p.inputs.some(i => i.alternatives.some(a => a.resource === id || a.members?.includes(id))) || p.requirements.some(r => r.kind === 'equipment' && r.id === id))))).sort((a, b) => a.id.localeCompare(b.id));
    if (level >= depth) { if (ps.some(p => !expanded.has(p.id))) truncated = true; continue; }
    for (const p of ps) includeProcess(p, level);
  }
  return { target, nodes: [...nodes.values()], edges, truncated, depth, limit, direction };
}
