import { msg, value, localize, initializeLocale, errorMessage, edgeLabel, nodeLabel } from './localization.js';
import { graphViewport } from './graph-viewport.js';
const $ = id => document.getElementById(id);
const state = { id: null, kind: '', offset: 0, limit: 30, evidence: [], searchRevision: 0, graphRevision: 0 };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) localize(node, text); if (className) node.className = className; return node; };
initializeLocale($('language'));
async function api(endpoint, params = {}) {
  const response = await fetch(`/api/${endpoint}?${new URLSearchParams(params)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? body.limitations?.join('; ') ?? response.statusText);
  return body;
}
function error(err) { localize($('status'), errorMessage(err)); }
function jsonDetails(parent, label, data) { const details = el('details'); details.append(el('summary', label), el('pre', JSON.stringify(data, null, 2))); parent.append(details); }
function detail(node, evidence = state.evidence) {
  const container = $('details'); container.replaceChildren();
  container.append(el('h3', node.id ?? node.target ?? msg('analysisResult')));
  if (node.unknown?.length) container.append(el('p', msg('unknownDetail', { reasons: node.unknown.join(' · ') }), 'notice'));
  if (node.execution) container.append(el('span', msg('executionSummary', { execution: value(node.execution), interpretation: value(node.interpretation) }), `badge ${node.interpretation === 'opaque' ? 'unknown' : ''}`));
  if (node.inputs) jsonDetails(container, msg('inputDetails'), node.inputs);
  if (node.outputs) jsonDetails(container, msg('outputDetails'), node.outputs);
  if (node.requirements) jsonDetails(container, msg('requirementDetails'), node.requirements);
  if (node.costs) jsonDetails(container, msg('costDetails'), node.costs);
  if (node.fieldEvidence) jsonDetails(container, msg('fieldEvidence'), node.fieldEvidence);
  jsonDetails(container, msg('sourceEvidence'), evidence.filter(e => node.evidence?.includes(e.id)));
  jsonDetails(container, msg('allFields'), node);
}
function diagram(data, root) {
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, value]) => n.setAttribute(k, value)); return n; };
  const inputs = new Set(data.edges.filter(e => !e.from.startsWith('process:')).map(e => e.from));
  const lanes = [data.nodes.filter(n => n.kind !== 'process' && inputs.has(n.id)), data.nodes.filter(n => n.kind === 'process'), data.nodes.filter(n => n.kind === 'resource' && !inputs.has(n.id))];
  const height = Math.max(230, ...lanes.map(lane => lane.length * 82 + 55));
  const toolbar = el('div', undefined, 'graph-toolbar'); toolbar.setAttribute('role', 'group'); localize(toolbar, msg('graphControls'), 'aria-label');
  const hint = el('small', msg('graphHint'), 'graph-hint'); hint.id = 'graph-hint';
  const svg = svgEl('svg', { class: 'diagram', tabindex: '0', 'aria-describedby': hint.id });
  localize(svg, msg('graphName'), 'aria-label');
  const content = svgEl('g', { class: 'diagram-content' });
  const defs = svgEl('defs'), marker = svgEl('marker', { id: 'arrow', markerWidth: '8', markerHeight: '8', refX: '7', refY: '3', orient: 'auto', markerUnits: 'strokeWidth' }); marker.append(svgEl('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#71948b' })); defs.append(marker); svg.append(defs);
  svg.append(content);
  const positions = new Map();
  lanes.forEach((lane, index) => lane.forEach((node, row) => positions.set(node.id, { x: 20 + index * 300, y: 40 + row * 82, node })));
  [msg('inputLane'), msg('processLane'), msg('outputLane')].forEach((label, index) => { const text = svgEl('text', { x: 20 + index * 300, y: 17, class: 'diagram-caption' }); localize(text, label); content.append(text); });
  data.edges.forEach(edge => {
    const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return;
    const right = b.x >= a.x, x1 = a.x + (right ? 225 : 0), x2 = b.x + (right ? 0 : 225), y1 = a.y + 26, y2 = b.y + 26, mid = (x1 + x2) / 2;
    const path = svgEl('path', { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, class: 'diagram-edge', 'marker-end': 'url(#arrow)' }); const title = svgEl('title'); localize(title, edgeLabel(edge)); path.append(title); content.append(path);
  });
  positions.forEach(({ x, y, node }) => {
    const group = svgEl('g', { transform: `translate(${x},${y})`, role: 'button', tabindex: '0', class: `diagram-node ${node.kind}` });
    localize(group, msg('nodeName', { label: nodeLabel(node), id: node.data.id }), 'aria-label');
    group.append(svgEl('rect', { width: '225', height: '56', rx: '6' }));
    const label = svgEl('text', { x: '12', y: '23' }); localize(label, nodeLabel(node), 'textContent', 26); group.append(label);
    const sub = svgEl('text', { x: '12', y: '42', class: 'diagram-caption' }); localize(sub, node.kind === 'process' ? msg('processSummary', { slots: node.data.inputs.length, requirements: node.data.requirements.length, unknown: node.data.unknown.length ? msg('unknownSuffix') : '' }) : node.data.id.length > 30 ? node.data.id.slice(0, 28) + '…' : node.data.id, 'textContent', 40); group.append(sub);
    const title = svgEl('title'); localize(title, msg('nodeName', { label: nodeLabel(node), id: node.data.id })); group.append(title);
    const activate = () => node.kind === 'resource' ? select(node.data.id) : detail(node.data);
    group.addEventListener('focus', () => {
      const nodeBounds = group.getBoundingClientRect(), viewport = svg.getBoundingClientRect();
      if (nodeBounds.left < viewport.left || nodeBounds.right > viewport.right || nodeBounds.top < viewport.top || nodeBounds.bottom > viewport.bottom) group.dispatchEvent(new CustomEvent('reveal-node', { bubbles: true }));
    });
    group.addEventListener('click', activate); group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }); content.append(group);
  }); root.append(toolbar, hint, svg);
  state.disposeDiagram = graphViewport(svg, content, toolbar, 850, height);
}
async function search() {
  const revision = ++state.searchRevision;
  try {
    const body = await api('search', { q: $('search').value, mod: $('mod').value, limit: state.limit, offset: state.offset });
    if (revision !== state.searchRevision) return;
    const page = body.result; localize($('count'), page.total ? msg('resourceCount', { total: page.total, start: page.offset + 1, end: Math.min(page.offset + page.items.length, page.total) }) : msg('zeroResources'));
    $('previous').disabled = !state.offset; $('next').disabled = state.offset + state.limit >= page.total;
    const results = $('results'); results.replaceChildren();
    page.items.forEach(r => { const button = el('button', r.name, `result ${state.id === r.id ? 'active' : ''}`); button.append(el('span', r.id)); button.onclick = () => select(r.id); results.append(button); });
    if (!page.items.length) results.append(el('p', msg('noResources'), 'muted'));
  } catch (err) { error(err); }
}
async function select(id, kind = '') {
  state.id = id; state.kind = kind; localize($('selected'), id); $('analysis').replaceChildren();
  setView('graph'); await Promise.all([graph(), search()]);
  try { const body = await api('inspect', { id, limit: 10 }); detail(kind === 'process' ? body.result.process : body.result.resource ?? body.result.process, body.evidence); if (body.result.tags.length) jsonDetails($('details'), msg('memberTags'), body.result.tags); } catch (err) { error(err); }
}
async function graph() {
  if (!state.id) return;
  const revision = ++state.graphRevision;
  const started = performance.now();
  try {
    const params = { id: state.id, depth: $('depth').value, direction: $('direction').value, limit: 100 }; if (state.kind) params.kind = state.kind;
    const body = await api('graph', params);
    const received = performance.now();
    if (revision !== state.graphRevision) return;
    state.disposeDiagram?.();
    state.evidence = body.evidence; const data = body.result, root = $('graph'); root.replaceChildren();
    const byId = new Map(data.nodes.map(n => [n.id, n])); diagram(data, root);
    const nodeList = el('details'); nodeList.append(el('summary', msg('nodeCount', { count: data.nodes.length }))); root.append(nodeList);
    for (const kind of ['resource', 'process', 'predicate']) {
      const section = el('section', undefined, 'graph-section'); section.append(el('h3', kind === 'resource' ? msg('resourceNodes') : kind === 'process' ? msg('processNodes') : msg('predicateNodes')));
      const nodes = el('div', undefined, 'nodes');
      data.nodes.filter(n => n.kind === kind).forEach(n => {
        const button = el('button', nodeLabel(n), `node ${kind}`); button.append(el('small', n.data.id));
        if (kind === 'process') button.append(el('small', msg('processListSummary', { slots: n.data.inputs.length, requirements: n.data.requirements.length, unknown: n.data.unknown.length ? msg('unknownSuffix') : '' })));
        button.onclick = () => kind === 'resource' ? select(n.data.id) : detail(n.data); nodes.append(button);
      }); section.append(nodes); nodeList.append(section);
    }
    const relations = el('details'); relations.open = true; relations.append(el('summary', msg('edgeCount', { count: data.edges.length })));
    data.edges.forEach(e => { const row = el('div', undefined, 'edge'); [e.from, e.to].forEach((key, i) => {
      if (i) row.append(el('span', msg('edgeRelation', { label: edgeLabel(e) }), 'edge-label'));
      const node = byId.get(key); const button = el('button', node?.data.id ?? key); button.onclick = () => node && detail(node.data); row.append(button);
    }); relations.append(row); }); root.append(relations);
    if (data.truncated) root.append(el('p', msg('graphTruncated'), 'notice'));
    const built = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (revision !== state.graphRevision) return;
      const measurement = { nodes: data.nodes.length, edges: data.edges.length, apiMs: received - started, domBuildMs: built - received, frameReadyMs: performance.now() - built };
      root.dataset.performance = JSON.stringify(measurement);
      root.append(el('small', msg('graphMetrics', { nodes: measurement.nodes, api: measurement.apiMs.toFixed(1), dom: measurement.domBuildMs.toFixed(1), frame: measurement.frameReadyMs.toFixed(1) }), 'render-metrics'));
    }));
    localize($('status'), '');
  } catch (err) { error(err); }
}
function setView(view) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  ['graph', 'cost', 'diagnostics', 'diff', 'coverage'].forEach(key => $(`${key}-view`).hidden = key !== view);
}
function diagnosticCard(diagnostic, evidence) {
  const card = el('article', undefined, 'card'); card.append(el('span', msg('diagnosticStatus', { severity: value(diagnostic.severity), status: value(diagnostic.status) }), `badge ${diagnostic.status === 'unknown' ? 'unknown' : ''}`), el('h3', diagnostic.target), el('p', diagnostic.message));
  const open = el('button', msg('openGraph')); open.onclick = () => select(diagnostic.target, ['required-recipe', 'unsupported-recipe', 'source-conflict', 'ambiguous-viewer-match'].includes(diagnostic.rule) ? 'process' : ''); card.append(open);
  const details = el('button', msg('viewEvidence')); details.onclick = () => detail(diagnostic, evidence); card.append(details); return card;
}
async function loadView(view, offset = 0) {
  setView(view); if (view === 'graph' || view === 'cost') return;
  const root = $(view); root.replaceChildren(el('p', msg('loading'), 'muted'));
  try {
    const body = await api(view, { limit: 30, offset }); root.replaceChildren();
    if (view === 'diagnostics') {
      body.result.items.forEach(d => root.append(diagnosticCard(d, body.evidence)));
      if (!body.result.total) root.append(el('p', msg('noDiagnostics'), 'muted'));
    } else if (view === 'coverage') {
      const table = el('table'), head = el('tr'); [msg('datasetType'), msg('captureStatus'), msg('interpretationCount'), msg('reasons')].forEach(label => head.append(el('th', label))); table.append(head);
      body.result.items.forEach(c => { const row = el('tr'); [`${c.dataset} / ${c.type}`, value(c.status), `${c.interpreted ?? '?'} / ${c.enumerated ?? '?'}`, c.reasons.join(' · ')].forEach(value => row.append(el('td', value))); table.append(row); }); root.append(table);
    } else {
      const changes = body.result.changes.items ?? body.result.changes;
      changes.forEach(c => { const card = el('article', undefined, 'card'); card.append(el('span', value(c.kind), 'badge'), el('h3', c.id), el('p', c.fields.join(' · '))); if (['resource', 'process'].includes(c.kind)) { const button = el('button', msg('openGraph')); button.onclick = () => select(c.id, c.kind); card.append(button); } jsonDetails(card, msg('changeDetails'), c); root.append(card); });
      jsonDetails(root, msg('provenanceChanges'), body.result.provenance);
      jsonDetails(root, msg('impact'), body.result.impact);
      if (!changes.length) root.append(el('p', msg('noChanges'), 'muted'));
    }
    const pageData = view === 'diff' ? body.result.changes : body.result;
    if (pageData?.items) {
      root.append(el('p', msg('pageCount', { total: pageData.total, count: pageData.items.length, truncated: pageData.truncated ? msg('truncatedSuffix') : '' }), 'muted'));
      if (offset > 0) { const previous = el('button', msg('previousRecords')); previous.onclick = () => loadView(view, Math.max(0, offset - 30)); root.append(previous); }
      if (offset + 30 < pageData.total) { const next = el('button', msg('nextRecords')); next.onclick = () => loadView(view, offset + 30); root.append(next); }
    }
    localize($('status'), '');
  } catch (err) { root.replaceChildren(el('p', errorMessage(err), 'notice')); }
}
$('search-form').onsubmit = event => { event.preventDefault(); state.offset = 0; search(); };
$('previous').onclick = () => { state.offset = Math.max(0, state.offset - state.limit); search(); };
$('next').onclick = () => { state.offset += state.limit; search(); };
$('direction').onchange = graph; $('depth').onchange = graph;
document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => loadView(tab.dataset.view));
$('explain').onclick = async () => {
  if (!state.id) return;
  try { const body = await api('explain', { id: state.id }); const root = $('analysis'); root.replaceChildren(); const analysis = body.result; root.append(el('h3', msg('reachability', { status: value(analysis.status) }))); jsonDetails(root, msg('analysisDetails'), analysis); detail(analysis, body.evidence); } catch (err) { error(err); }
};
$('cost-template').onclick = async () => {
  if (!state.id || state.kind === 'process') { localize($('status'), msg('selectForPlan')); return; }
  try {
    const body = await api('sources', { id: state.id, limit: 30 });
    const source = body.result.items.find(p => p.execution === 'executable') ?? body.result.items[0];
    const output = source?.outputs.findIndex(o => o.resource === state.id) ?? -1;
    const selections = {};
    if (source) {
      selections[source.id] = {};
      source.inputs.forEach((slot, index) => {
        const alternative = slot.alternatives.find(a => a.resource || a.members?.length);
        const selected = alternative?.resource ?? alternative?.members?.[0];
        if (selected) selections[source.id][index] = selected;
      });
    }
    const request = { schemaVersion: 1, id: 'ui-selected-plan', target: { resource: state.id, amount: 1, unit: source?.outputs[output]?.unit ?? 'item' }, routes: source ? { [state.id]: { process: source.id, output } } : {}, selections, mode: 'deterministic', probabilityModels: {}, durability: {} };
    $('cost-request').value = JSON.stringify(request, null, 2);
    localize($('status'), msg('reviewPlan'));
  } catch (err) { error(err); }
};
function costTable(root, title, headers, rows) {
  root.append(el('h3', title));
  if (!rows.length) { root.append(el('p', msg('noPlanItems'), 'muted')); return; }
  const table = el('table'), head = el('tr'); headers.forEach(h => head.append(el('th', h))); table.append(head);
  rows.forEach(values => { const row = el('tr'); values.forEach(value => row.append(el('td', value))); table.append(row); }); root.append(table);
}
$('cost-calculate').onclick = async () => {
  try {
    let request;
    try { request = JSON.parse($('cost-request').value); } catch (err) { localize($('status'), msg('invalidPlanJson', { message: err.message })); return; }
    const body = await api('cost', { request: JSON.stringify(request), limit: 100 });
    const result = body.result, root = $('cost-result'); root.replaceChildren();
    root.append(el('h3', msg('costSummary', { status: value(result.status), resource: result.target.resource, amount: result.target.amount, unit: result.target.unit })));
    ['setup', 'recurring'].forEach(phase => costTable(root, phase === 'setup' ? msg('setupMaterials') : msg('recurringMaterials'), [msg('resources'), msg('amountUnit'), msg('inventory'), msg('externalInput'), msg('basis')], result.materials[phase].items.map(m => [m.resource, `${m.amount} ${m.unit}`, m.fromInventory ?? '?', m.external ?? '?', value(m.basis)])));
    costTable(root, msg('totalCosts'), [msg('type'), msg('unit'), msg('totalCost'), msg('knownSubtotal')], result.costs.total.items.map(c => [c.kind, c.unit, c.amount ?? value('unknown'), c.knownSubtotal]));
    costTable(root, msg('steps'), [msg('processPhase'), msg('batches'), msg('basis'), msg('batchVariance')], result.steps.items.map(s => [msg('processPhaseValue', { process: s.process, phase: value(s.phase) }), s.batches, value(s.batchBasis), s.batchVariance ?? '?']));
    costTable(root, msg('outputs'), [msg('resourceRole'), msg('amountUnit'), msg('probability'), msg('basis')], result.outputs.items.map(o => [msg('resourceRoleValue', { resource: o.resource, role: value(o.role) }), `${o.amount ?? '?'} ${o.unit}`, o.probability ?? '?', value(o.basis)]));
    jsonDetails(root, msg('durabilityDetails'), { durability: result.durability, catalysts: result.catalysts });
    jsonDetails(root, msg('costEvidence'), { evidence: body.evidence, diagnostics: result.diagnostics, limitations: body.limitations });
    if ([result.steps, result.outputs, result.materials.setup, result.materials.recurring, result.costs.total].some(page => page.truncated)) root.append(el('p', msg('costTruncated'), 'notice'));
    localize($('status'), '');
  } catch (err) { error(err); }
};
try {
  const { result: meta } = await api('meta'); localize($('identity'), msg('identity', { snapshot: meta.snapshotId, generation: meta.generation, hash: meta.contentHash.slice(0, 10) }));
  localize($('scenario'), meta.scenario ? JSON.stringify(meta.scenario, null, 2) : msg('noScenario'));
  $('explain').disabled = !meta.scenario; await search();
  $('cost-calculate').disabled = !meta.scenario;
  if (meta.costRequest) $('cost-request').value = JSON.stringify(meta.costRequest, null, 2);
} catch (err) { error(err); }
