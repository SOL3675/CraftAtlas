const $ = id => document.getElementById(id);
const state = { id: null, kind: '', offset: 0, limit: 30, evidence: [], searchRevision: 0, graphRevision: 0 };
const el = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
async function api(endpoint, params = {}) {
  const response = await fetch(`/api/${endpoint}?${new URLSearchParams(params)}`);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? body.limitations?.join('; ') ?? response.statusText);
  return body;
}
function error(err) { $('status').textContent = err.message; }
function jsonDetails(parent, label, data) { const details = el('details'); details.append(el('summary', label), el('pre', JSON.stringify(data, null, 2))); parent.append(details); }
function detail(node, evidence = state.evidence) {
  const container = $('details'); container.replaceChildren();
  container.append(el('h3', node.id ?? node.target ?? '分析結果'));
  if (node.unknown?.length) container.append(el('p', `未解析: ${node.unknown.join(' · ')}`, 'notice'));
  if (node.execution) container.append(el('span', `${node.execution} / ${node.interpretation}`, `badge ${node.interpretation === 'opaque' ? 'unknown' : ''}`));
  if (node.inputs) jsonDetails(container, '材料スロット (AND / OR・数量・消費)', node.inputs);
  if (node.outputs) jsonDetails(container, '出力・確率・返却物', node.outputs);
  if (node.requirements) jsonDetails(container, '設備・進行条件', node.requirements);
  if (node.costs) jsonDetails(container, 'コスト (不明値は null)', node.costs);
  if (node.fieldEvidence) jsonDetails(container, 'フィールド別根拠', node.fieldEvidence);
  jsonDetails(container, '取得元の根拠', evidence.filter(e => node.evidence?.includes(e.id)));
  jsonDetails(container, '全フィールド', node);
}
function diagram(data, root) {
  const ns = 'http://www.w3.org/2000/svg';
  const svgEl = (tag, attrs = {}) => { const n = document.createElementNS(ns, tag); Object.entries(attrs).forEach(([k, value]) => n.setAttribute(k, value)); return n; };
  const inputs = new Set(data.edges.filter(e => !e.from.startsWith('process:')).map(e => e.from));
  const lanes = [data.nodes.filter(n => n.kind !== 'process' && inputs.has(n.id)), data.nodes.filter(n => n.kind === 'process'), data.nodes.filter(n => n.kind === 'resource' && !inputs.has(n.id))];
  const height = Math.max(230, ...lanes.map(lane => lane.length * 82 + 55));
  const svg = svgEl('svg', { viewBox: `0 0 850 ${height}`, class: 'diagram', 'aria-label': '資源と処理の局所グラフ' });
  const defs = svgEl('defs'), marker = svgEl('marker', { id: 'arrow', markerWidth: '8', markerHeight: '8', refX: '7', refY: '3', orient: 'auto', markerUnits: 'strokeWidth' }); marker.append(svgEl('path', { d: 'M0,0 L0,6 L7,3 z', fill: '#71948b' })); defs.append(marker); svg.append(defs);
  const positions = new Map();
  lanes.forEach((lane, index) => lane.forEach((node, row) => positions.set(node.id, { x: 20 + index * 300, y: 40 + row * 82, node })));
  ['入力資源 / 前提条件', '処理 (AND / OR)', '出力資源'].forEach((label, index) => { const text = svgEl('text', { x: 20 + index * 300, y: 17, class: 'diagram-caption' }); text.textContent = label; svg.append(text); });
  data.edges.forEach(edge => {
    const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return;
    const right = b.x >= a.x, x1 = a.x + (right ? 225 : 0), x2 = b.x + (right ? 0 : 225), y1 = a.y + 26, y2 = b.y + 26, mid = (x1 + x2) / 2;
    const path = svgEl('path', { d: `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`, class: 'diagram-edge', 'marker-end': 'url(#arrow)' }); const title = svgEl('title'); title.textContent = edge.label; path.append(title); svg.append(path);
  });
  positions.forEach(({ x, y, node }) => {
    const group = svgEl('g', { transform: `translate(${x},${y})`, role: 'button', tabindex: '0', 'aria-label': node.data.id, class: `diagram-node ${node.kind}` });
    group.append(svgEl('rect', { width: '225', height: '56', rx: '6' }));
    const label = svgEl('text', { x: '12', y: '23' }); label.textContent = node.label.length > 26 ? node.label.slice(0, 24) + '…' : node.label; group.append(label);
    const sub = svgEl('text', { x: '12', y: '42', class: 'diagram-caption' }); sub.textContent = node.kind === 'process' ? `${node.data.inputs.length} スロット · ${node.data.requirements.length} 条件${node.data.unknown.length ? ' · 未解析' : ''}` : node.data.id.length > 30 ? node.data.id.slice(0, 28) + '…' : node.data.id; group.append(sub);
    const title = svgEl('title'); title.textContent = node.data.id; group.append(title);
    const activate = () => node.kind === 'resource' ? select(node.data.id) : detail(node.data);
    group.addEventListener('click', activate); group.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(); } }); svg.append(group);
  }); root.append(svg);
}
async function search() {
  const revision = ++state.searchRevision;
  try {
    const body = await api('search', { q: $('search').value, mod: $('mod').value, limit: state.limit, offset: state.offset });
    if (revision !== state.searchRevision) return;
    const page = body.result; $('count').textContent = page.total ? `${page.total} 資源 · ${page.offset + 1}–${Math.min(page.offset + page.items.length, page.total)}` : '0 資源';
    $('previous').disabled = !state.offset; $('next').disabled = state.offset + state.limit >= page.total;
    const results = $('results'); results.replaceChildren();
    page.items.forEach(r => { const button = el('button', r.name, `result ${state.id === r.id ? 'active' : ''}`); button.append(el('span', r.id)); button.onclick = () => select(r.id); results.append(button); });
    if (!page.items.length) results.append(el('p', '一致する資源はありません。', 'muted'));
  } catch (err) { error(err); }
}
async function select(id, kind = '') {
  state.id = id; state.kind = kind; $('selected').textContent = id; $('analysis').replaceChildren();
  setView('graph'); await Promise.all([graph(), search()]);
  try { const body = await api('inspect', { id, limit: 10 }); detail(kind === 'process' ? body.result.process : body.result.resource ?? body.result.process, body.evidence); if (body.result.tags.length) jsonDetails($('details'), '所属タグ', body.result.tags); } catch (err) { error(err); }
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
    state.evidence = body.evidence; const data = body.result, root = $('graph'); root.replaceChildren();
    const byId = new Map(data.nodes.map(n => [n.id, n])); diagram(data, root);
    const nodeList = el('details'); nodeList.append(el('summary', `ノード一覧 · ${data.nodes.length} 件`)); root.append(nodeList);
    for (const kind of ['resource', 'process', 'predicate']) {
      const section = el('section', undefined, 'graph-section'); section.append(el('h3', kind === 'resource' ? '資源 — 選択して経路を展開' : kind === 'process' ? '処理 — 選択して条件を確認' : '材料・文脈・未解析の条件'));
      const nodes = el('div', undefined, 'nodes');
      data.nodes.filter(n => n.kind === kind).forEach(n => {
        const button = el('button', n.label, `node ${kind}`); button.append(el('small', n.data.id));
        if (kind === 'process') button.append(el('small', `${n.data.inputs.length} AND スロット · ${n.data.requirements.length} 条件${n.data.unknown.length ? ' · 未解析あり' : ''}`));
        button.onclick = () => kind === 'resource' ? select(n.data.id) : detail(n.data); nodes.append(button);
      }); section.append(nodes); nodeList.append(section);
    }
    const relations = el('details'); relations.open = true; relations.append(el('summary', `局所グラフの接続 · ${data.edges.length} 本`));
    data.edges.forEach(e => { const row = el('div', undefined, 'edge'); [e.from, e.to].forEach((key, i) => {
      if (i) row.append(el('span', `→ ${e.label} →`, 'edge-label'));
      const node = byId.get(key); const button = el('button', node?.data.id ?? key); button.onclick = () => node && detail(node.data); row.append(button);
    }); relations.append(row); }); root.append(relations);
    if (data.truncated) root.append(el('p', 'ノード上限または選択した深さで表示を打ち切りました。対象ノードを選び、さらに展開できます。', 'notice'));
    const built = performance.now();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (revision !== state.graphRevision) return;
      const measurement = { nodes: data.nodes.length, edges: data.edges.length, apiMs: received - started, domBuildMs: built - received, frameReadyMs: performance.now() - built };
      root.dataset.performance = JSON.stringify(measurement);
      root.append(el('small', `局所グラフ ${measurement.nodes} ノード · API ${measurement.apiMs.toFixed(1)} ms · DOM ${measurement.domBuildMs.toFixed(1)} ms · 次フレーム ${measurement.frameReadyMs.toFixed(1)} ms`, 'render-metrics'));
    }));
    $('status').textContent = '';
  } catch (err) { error(err); }
}
function setView(view) {
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  ['graph', 'cost', 'diagnostics', 'diff', 'coverage'].forEach(key => $(`${key}-view`).hidden = key !== view);
}
function diagnosticCard(diagnostic, evidence) {
  const card = el('article', undefined, 'card'); card.append(el('span', `${diagnostic.severity} · ${diagnostic.status}`, `badge ${diagnostic.status === 'unknown' ? 'unknown' : ''}`), el('h3', diagnostic.target), el('p', diagnostic.message));
  const open = el('button', '対象グラフへ →'); open.onclick = () => select(diagnostic.target, ['required-recipe', 'unsupported-recipe', 'source-conflict', 'ambiguous-viewer-match'].includes(diagnostic.rule) ? 'process' : ''); card.append(open);
  const details = el('button', '根拠を確認'); details.onclick = () => detail(diagnostic, evidence); card.append(details); return card;
}
async function loadView(view, offset = 0) {
  setView(view); if (view === 'graph' || view === 'cost') return;
  const root = $(view); root.replaceChildren(el('p', '読み込み中…', 'muted'));
  try {
    const body = await api(view, { limit: 30, offset }); root.replaceChildren();
    if (view === 'diagnostics') {
      body.result.items.forEach(d => root.append(diagnosticCard(d, body.evidence)));
      if (!body.result.total) root.append(el('p', '診断はありません。未解析がないことを保証する結果ではありません。', 'muted'));
    } else if (view === 'coverage') {
      const table = el('table'), head = el('tr'); ['データセット / 型', '取得状態', '解釈 / 列挙', '理由'].forEach(label => head.append(el('th', label))); table.append(head);
      body.result.items.forEach(c => { const row = el('tr'); [`${c.dataset} / ${c.type}`, c.status, `${c.interpreted ?? '?'} / ${c.enumerated ?? '?'}`, c.reasons.join(' · ')].forEach(value => row.append(el('td', value))); table.append(row); }); root.append(table);
    } else {
      const changes = body.result.changes.items ?? body.result.changes;
      changes.forEach(c => { const card = el('article', undefined, 'card'); card.append(el('span', c.kind, 'badge'), el('h3', c.id), el('p', c.fields.join(' · '))); if (['resource', 'process'].includes(c.kind)) { const button = el('button', '対象グラフへ →'); button.onclick = () => select(c.id, c.kind); card.append(button); } jsonDetails(card, '変更前 / 変更後・根拠', c); root.append(card); });
      jsonDetails(root, '解析器・環境の変更', body.result.provenance);
      jsonDetails(root, '影響範囲', body.result.impact);
      if (!changes.length) root.append(el('p', '意味上の変更はありません。', 'muted'));
    }
    const pageData = view === 'diff' ? body.result.changes : body.result;
    if (pageData?.items) {
      root.append(el('p', `${pageData.total} 件 · 表示 ${pageData.items.length} 件${pageData.truncated ? ' (一部のみ)' : ''}`, 'muted'));
      if (offset > 0) { const previous = el('button', '← 前の 30 件'); previous.onclick = () => loadView(view, Math.max(0, offset - 30)); root.append(previous); }
      if (offset + 30 < pageData.total) { const next = el('button', '次の 30 件 →'); next.onclick = () => loadView(view, offset + 30); root.append(next); }
    }
    $('status').textContent = '';
  } catch (err) { root.replaceChildren(el('p', err.message, 'notice')); }
}
$('search-form').onsubmit = event => { event.preventDefault(); state.offset = 0; search(); };
$('previous').onclick = () => { state.offset = Math.max(0, state.offset - state.limit); search(); };
$('next').onclick = () => { state.offset += state.limit; search(); };
$('direction').onchange = graph; $('depth').onchange = graph;
document.querySelectorAll('.tab').forEach(tab => tab.onclick = () => loadView(tab.dataset.view));
$('explain').onclick = async () => {
  if (!state.id) return;
  try { const body = await api('explain', { id: state.id }); const root = $('analysis'); root.replaceChildren(); const analysis = body.result; root.append(el('h3', `到達分析: ${analysis.status}`)); jsonDetails(root, '到達経路・停止理由・未知条件・制限', analysis); detail(analysis, body.evidence); } catch (err) { error(err); }
};
$('cost-template').onclick = async () => {
  if (!state.id || state.kind === 'process') { $('status').textContent = '資源を選択してからプランを作成してください。'; return; }
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
    $('status').textContent = '表示した経路と材料選択を確認・編集してから計算してください。候補の先頭をテンプレートに使用しています。';
  } catch (err) { error(err); }
};
function costTable(root, title, headers, rows) {
  root.append(el('h3', title));
  if (!rows.length) { root.append(el('p', 'このプランには項目がありません。', 'muted')); return; }
  const table = el('table'), head = el('tr'); headers.forEach(h => head.append(el('th', h))); table.append(head);
  rows.forEach(values => { const row = el('tr'); values.forEach(value => row.append(el('td', String(value)))); table.append(row); }); root.append(table);
}
$('cost-calculate').onclick = async () => {
  try {
    const request = JSON.parse($('cost-request').value), body = await api('cost', { request: JSON.stringify(request), limit: 100 });
    const result = body.result, root = $('cost-result'); root.replaceChildren();
    root.append(el('h3', `集計: ${{ complete: '完了', unknown: '不明部分あり', invalid: '無効なプラン' }[result.status]} · ${result.target.resource} ×${result.target.amount} ${result.target.unit}`));
    ['setup', 'recurring'].forEach(phase => costTable(root, phase === 'setup' ? '初期設備・解放の材料' : '反復処理の材料', ['資源', '数量 / 単位', '初期在庫', '外部投入', '算定'], result.materials[phase].items.map(m => [m.resource, `${m.amount} ${m.unit}`, m.fromInventory ?? '?', m.external ?? '?', m.basis])));
    costTable(root, '既知費用と総費用', ['種類', '単位', '総費用', '既知小計'], result.costs.total.items.map(c => [c.kind, c.unit, c.amount ?? '不明', c.knownSubtotal]));
    costTable(root, '選択した工程', ['工程 / 区分', 'バッチ数', '算定', 'バッチ分散'], result.steps.items.map(s => [`${s.process} / ${s.phase === 'setup' ? '初期' : '反復'}`, s.batches, s.batchBasis, s.batchVariance ?? '?']));
    costTable(root, '主産物・副産物・返却物', ['資源 / 役割', '数量 / 単位', '確率', '算定'], result.outputs.items.map(o => [`${o.resource} / ${o.role}`, `${o.amount ?? '?'} ${o.unit}`, o.probability ?? '?', o.basis]));
    jsonDetails(root, '工具の耐久と触媒', { durability: result.durability, catalysts: result.catalysts });
    jsonDetails(root, '根拠・診断・制限', { evidence: body.evidence, diagnostics: result.diagnostics, limitations: body.limitations });
    if ([result.steps, result.outputs, result.materials.setup, result.materials.recurring, result.costs.total].some(page => page.truncated)) root.append(el('p', '表示上限100件で打ち切りました。CLI の offset で続きを取得できます。計算自体は全プランを使用しています。', 'notice'));
    $('status').textContent = '';
  } catch (err) { error(err); }
};
try {
  const { result: meta } = await api('meta'); $('identity').textContent = `${meta.snapshotId} · generation ${meta.generation} · ${meta.contentHash.slice(0, 10)}`;
  $('scenario').textContent = meta.scenario ? JSON.stringify(meta.scenario, null, 2) : '分析シナリオ未指定。--scenario で定義を指定してください。';
  $('explain').disabled = !meta.scenario; await search();
  $('cost-calculate').disabled = !meta.scenario;
  if (meta.costRequest) $('cost-request').value = JSON.stringify(meta.costRequest, null, 2);
} catch (err) { error(err); }
