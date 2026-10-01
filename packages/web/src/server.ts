import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { readFileSync } from 'node:fs';
import type { Model, Scenario, Expectations, Process } from '../../core/src/types.ts';
import { analyze } from '../../core/src/analyze.ts';
import { audit } from '../../core/src/audit.ts';
import { diff } from '../../core/src/diff.ts';
import { localGraph as coreGraph } from '../../core/src/graph.ts';

export interface WebOptions { model: Model; scenario?: Scenario; expectations?: Expectations; before?: Model }
export function bounds(value: string | undefined | null, fallback: number, maximum: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if (!/^\d+$/.test(value) || Number(value) > maximum) throw new Error(`${name} must be an integer between 0 and ${maximum}`);
  return Number(value);
}
export function envelope(query: unknown, result: unknown, model: Model, limitations: string[] = []) {
  const refs = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === 'evidence' && Array.isArray(child)) child.forEach(id => { if (typeof id === 'string') refs.add(id); });
      else visit(child);
    }
  };
  visit(result);
  const evidence = model.evidence.filter(e => refs.has(e.id));
  return { schemaVersion: 1, query, result, evidence: evidence.slice(0, 100), limitations: [...limitations, ...(evidence.length > 100 ? ['Evidence truncated at 100 records'] : [])] };
}
function page<T>(items: T[], limit: number, offset: number) { return { items: items.slice(offset, offset + limit), total: items.length, limit, offset, truncated: offset > 0 || offset + limit < items.length }; }
function related(model: Model, id: string, direction: string): Process[] {
  return model.processes.filter(p => direction === 'uses'
    ? p.inputs.some(s => s.alternatives.some(a => a.resource === id || a.members?.includes(id))) || p.requirements.some(r => r.kind === 'equipment' && r.id === id)
    : p.outputs.some(o => o.resource === id));
}
export function localGraph(model: Model, id: string, depth: number, limit: number, direction = 'sources', rootKind?: 'resource' | 'process') {
  const graph = coreGraph(model, id, { depth, limit: Math.max(1, limit), direction: direction as 'sources' | 'uses', rootKind });
  const nodes = graph.nodes.map(node => {
    const original = node.kind === 'process' ? model.processes.find(p => p.id === node.target) : node.kind === 'resource' ? model.resources.find(r => r.id === node.target) : undefined;
    return { ...node, data: { ...original, id: node.target, unknown: node.unknown, evidence: node.evidence, ...(node.kind === 'process' ? { raw: undefined } : {}) } };
  });
  const edges = graph.edges.map(edge => ({ ...edge, from: edge.source, to: edge.target,
    label: edge.role === 'equipment' ? '設備 (非消費)' : edge.role === 'output' ? `×${edge.amount} ${edge.unit} · p=${edge.probability ?? '?'}` : `AND slot ${(edge.slot ?? 0) + 1} / OR ${(edge.alternative ?? 0) + 1} ×${edge.amount} ${edge.unit}${edge.tag ? ` #${edge.tag}` : ''}${edge.consumption ? ` (${edge.consumption})` : ''}` }));
  return { ...graph, root: id, nodes: limit === 0 ? [] : nodes, edges: limit === 0 ? [] : edges, limit, truncated: graph.truncated || limit === 0 };
}
export function createAtlasServer(options: WebOptions): Server {
  const { model } = options;
  const assets = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
    ['/style.css', ['style.css', 'text/css; charset=utf-8']],
  ]);
  return createServer((req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    try {
      if (req.method !== 'GET') { json(405, { error: 'Only GET is supported' }); return; }
      const host = req.headers.host ? new URL(`http://${req.headers.host}`).hostname : '';
      if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { json(403, { error: 'Loopback host required' }); return; }
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host) { json(403, { error: 'Same origin required' }); return; }
      }
      const url = new URL(req.url ?? '/', 'http://localhost');
      const asset = assets.get(url.pathname);
      if (asset) { res.writeHead(200, { 'Content-Type': asset[1] }); res.end(readFileSync(new URL(`../public/${asset[0]}`, import.meta.url))); return; }
      const q = url.searchParams;
      const limit = bounds(q.get('limit'), 30, 100, 'limit'), offset = bounds(q.get('offset'), 0, 1_000_000, 'offset'), depth = bounds(q.get('depth'), 1, 5, 'depth');
      const id = q.get('id') ?? '', direction = q.get('direction') ?? 'sources', rootKind = q.get('kind') ?? undefined;
      if (!['sources', 'uses'].includes(direction)) throw new Error('Invalid graph direction');
      if (rootKind !== undefined && !['resource', 'process'].includes(rootKind)) throw new Error('Invalid root kind');
      let result: unknown; const limitations: string[] = [];
      switch (url.pathname) {
        case '/api/meta': result = { snapshotId: model.snapshotId, contentHash: model.contentHash, generation: model.generation, resources: model.resources.length, processes: model.processes.length, scenario: options.scenario ?? null }; break;
        case '/api/search': {
          const text = (q.get('q') ?? '').toLowerCase(), mod = q.get('mod');
          result = page(model.resources.filter(r => (!mod || r.id.startsWith(`${mod}:`)) && (r.id.toLowerCase().includes(text) || r.name.toLowerCase().includes(text))), limit, offset); break;
        }
        case '/api/inspect': {
          const resource = model.resources.find(r => r.id === id), process = model.processes.find(p => p.id === id);
          if (!resource && !process) { json(404, { error: 'Unknown target' }); return; }
          result = { resource, process, tags: Object.entries(model.tags).filter(([, members]) => members.includes(id)).map(([tag]) => tag), sources: page(related(model, id, 'sources'), limit, offset), uses: page(related(model, id, 'uses'), limit, offset) }; break;
        }
        case '/api/sources': case '/api/uses': result = page(related(model, id, url.pathname.slice(5)), limit, offset); break;
        case '/api/graph':
          if (!id) throw new Error('Graph id required');
          result = localGraph(model, id, depth, limit, direction, rootKind as 'resource' | 'process' | undefined); limitations.push('Local graph is a display view; it does not alter scenario restrictions'); break;
        case '/api/coverage': result = page(model.coverage, limit, offset); break;
        case '/api/diagnostics': result = page(options.expectations ? audit(model, options.expectations, options.scenario) : model.diagnostics, limit, offset); break;
        case '/api/diff':
          if (!options.before) { json(409, { error: 'Start serve with --before to view a diff' }); return; }
          { const comparison = diff(options.before, model, { limit: 100 });
            result = { ...comparison, changes: page(comparison.changes, limit, offset), impact: { ...comparison.impact, resources: page(comparison.impact.resources, limit, offset), processes: page(comparison.impact.processes, limit, offset) } }; } break;
        case '/api/explain':
          if (!options.scenario) { json(409, { error: 'Start serve with --scenario to analyze reachability' }); return; }
          if (!id) throw new Error('Explain id required');
          { const analysis = analyze(model, options.scenario, id);
            result = { ...analysis, reachable: page(analysis.reachable, limit, offset), path: analysis.path.slice(0, limit * depth), stopReasons: page(analysis.stopReasons, limit, offset), unknown: page(analysis.unknown, limit, offset), diagnostics: page(analysis.diagnostics, limit, offset) };
            if (analysis.path.length > limit * depth) limitations.push('Path truncated by depth × limit; analysis evaluates the full model');
            limitations.push(...analysis.limitations); } break;
        default: json(404, { error: 'Unknown endpoint' }); return;
      }
      json(200, envelope({ endpoint: url.pathname, ...Object.fromEntries(q), limit, offset, depth, snapshotId: model.snapshotId }, result, model, limitations));
    } catch (error) { json(400, { schemaVersion: 1, query: req.url, result: null, evidence: [], limitations: [error instanceof Error ? error.message : String(error)] }); }
  });
}
