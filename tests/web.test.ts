import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from '../packages/core/src/normalize.ts';
import { createAtlasServer, localGraph } from '../packages/web/src/server.ts';
import { analyze } from '../packages/core/src/analyze.ts';
import { audit } from '../packages/core/src/audit.ts';
import { fixture, scenario } from './helpers.ts';

test('HTTP UI serves bounded search, local AND/OR graph, evidence and the same diagnostics', async () => {
  const model = normalize(fixture()), initial = scenario(); initial.equipment = ['minecraft:crafting_table'];
  const expectations = { schemaVersion: 1 as const, recipes: ['atlas:missing'], nonemptyTags: ['atlas:empty'], supportedTypes: [], reachable: ['minecraft:diamond'], unreachable: [] };
  const server = createAtlasServer({ model, scenario: initial, expectations, before: model });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const index = await fetch(base); assert.equal(index.status, 200); assert.match(await index.text(), /AND between slots \/ OR within alternatives/);
    assert.match(index.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    const viewport = await fetch(base + '/graph-viewport.js');
    assert.equal(viewport.status, 200); assert.match(viewport.headers.get('content-type')!, /javascript/);
    assert.match(await viewport.text(), /export class GraphCamera/);
    for (const path of ['/localization.js', '/locale-catalogs.js', '/locales/en.js', '/locales/ja.js']) {
      const asset = await fetch(base + path); assert.equal(asset.status, 200, path); assert.match(asset.headers.get('content-type')!, /javascript/);
    }
    assert.equal((await fetch(base + '/locales/unregistered.js')).status, 404);
    const query = async (path: string) => { const response = await fetch(base + path); assert.equal(response.status, 200); return response.json(); };
    const search = await query('/api/search?limit=2&offset=1'); assert.equal(search.schemaVersion, 1); assert.equal(search.result.items.length, 2); assert.equal(search.result.truncated, true);
    const graph = await query('/api/graph?id=minecraft:diamond&depth=2&limit=30');
    assert.ok(graph.result.nodes.some((n: any) => n.kind === 'process' && n.data.id === 'atlas:diamond'));
    assert.ok(graph.result.edges.some((e: any) => e.label.includes('AND slot 1 / OR')));
    const machineGraph = await query('/api/graph?id=minecraft:gold_ingot&depth=1');
    assert.ok(machineGraph.result.edges.some((e: any) => e.label.includes('設備')));
    assert.ok(graph.evidence.some((e: any) => e.id === 'runtime:atlas:diamond'));
    assert.deepEqual((await query('/api/diagnostics')).result.items, audit(model, expectations, initial));
    const explanation = await query('/api/explain?id=minecraft:diamond&mod=nonexistent');
    assert.equal(explanation.result.status, analyze(model, initial, 'minecraft:diamond').status);
    const diff = await query('/api/diff'); assert.equal(diff.result.changes.total, 0);
    const process = await query('/api/graph?id=atlas:diamond&depth=1'); assert.equal(process.result.nodes[0].kind, 'process');
    const inspection = await query('/api/inspect?id=minecraft:dirt'); assert.ok(inspection.result.tags.includes('atlas:materials'));
    const coverage = await query('/api/coverage'); assert.ok(coverage.result.items.some((c: any) => c.enumerated === null));
    for (const path of ['/api/search?limit=101', '/api/graph?id=x&depth=6', '/api/search?offset=-1', '/api/search?limit=abc']) assert.equal((await fetch(base + path)).status, 400);
    assert.equal((await fetch(base + '/api/inspect?id=unknown')).status, 404);
    assert.equal((await fetch(base + '/api/snapshot?path=../../package.json')).status, 404);
    assert.equal((await fetch(base + '/api/search', { method: 'POST' })).status, 405);
    assert.equal((await fetch(base + '/api/search', { headers: { Origin: 'https://external.example' } })).status, 403);
    const foreignHostStatus = await new Promise<number | undefined>((done, reject) => {
      const req = request(base + '/api/search', { headers: { Host: 'external.example' } }, response => { response.resume(); done(response.statusCode); }); req.on('error', reject); req.end();
    });
    assert.equal(foreignHostStatus, 403);
  } finally { await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done())); }
});

test('local graph has a node cap across large tag alternatives and cycles', () => {
  const model = normalize(fixture()); const p = model.processes[0];
  p.inputs[0].alternatives = [{ tag: 'atlas:many', members: Array.from({ length: 200 }, (_, i) => `atlas:resource_${i}`) }];
  const graph = localGraph(model, p.id, 5, 8); assert.equal(graph.nodes.length, 8); assert.equal(graph.truncated, true);
  const ids = new Set(graph.nodes.map(n => n.id)); assert.ok(graph.edges.every(e => ids.has(e.from) && ids.has(e.to)));
  p.inputs[0].alternatives = [{ tag: 'atlas:empty', members: [] }, { predicate: { custom: true } }];
  const opaque = localGraph(model, p.id, 1, 30);
  assert.equal(opaque.nodes.filter(n => n.kind === 'predicate').length, 2);
  assert.ok(opaque.edges.some(e => e.alternative === 1));
  assert.ok(opaque.nodes.some(n => n.kind === 'predicate' && n.unknown.length > 0));
  assert.equal(localGraph(model, p.id, 0, 30).truncated, true);
});

test('selected-plan cost HTTP and CLI agree on quantities, pagination and unknown input rejection', async () => {
  const requestPlan = { schemaVersion: 1, id: 'three-diamonds', target: { resource: 'minecraft:diamond', amount: 3, unit: 'item' }, routes: { 'minecraft:diamond': { process: 'atlas:diamond', output: 0 } }, selections: { 'atlas:diamond': { '0': 'minecraft:dirt', '1': 'minecraft:stick' } }, mode: 'deterministic', probabilityModels: {}, durability: {} };
  const server = createAtlasServer({ model: normalize(fixture()), scenario: scenario() }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address === 'object'); const base = `http://127.0.0.1:${address.port}`;
  const folder = mkdtempSync(join(tmpdir(), 'atlas-cost-api-'));
  try {
    const url = `${base}/api/cost?${new URLSearchParams({ request: JSON.stringify(requestPlan), limit: '1' })}`;
    const response = await fetch(url); assert.equal(response.status, 200); const http = await response.json();
    assert.equal(http.result.status, 'complete'); assert.equal(http.result.steps.items[0].batches, 2); assert.equal(http.result.outputs.items[0].amount, 4);
    assert.equal(http.result.materials.recurring.total, 2); assert.equal(http.result.materials.recurring.items.length, 1); assert.equal(http.result.materials.recurring.truncated, true);
    for (const [file, value] of [['snapshot', fixture()], ['scenario', scenario()], ['request', requestPlan]] as const) writeFileSync(join(folder, file + '.json'), JSON.stringify(value));
    const cli = spawnSync(process.execPath, ['packages/cli/src/main.ts', 'cost', '--snapshot', join(folder, 'snapshot.json'), '--scenario', join(folder, 'scenario.json'), '--request', join(folder, 'request.json'), '--limit', '1', '--json'], { encoding: 'utf8' });
    assert.equal(cli.status, 0, cli.stderr); assert.deepEqual(JSON.parse(cli.stdout).result, http.result);
    const invalid = { ...requestPlan, target: { ...requestPlan.target, amount: -1 } };
    assert.equal((await fetch(`${base}/api/cost?${new URLSearchParams({ request: JSON.stringify(invalid) })}`)).status, 400);
    assert.equal((await fetch(`${base}/api/cost?${new URLSearchParams({ request: ' '.repeat(32769) })}`)).status, 400);
  } finally { await new Promise<void>((done, reject) => server.close(err => err ? reject(err) : done())); rmSync(folder, { recursive: true, force: true }); }
});

test('CLI JSON errors, snapshot import and SQLite queries preserve the contract', () => {
  const folder = mkdtempSync(join(tmpdir(), 'atlas-cli-')); const input = join(folder, 'snapshot.json'), db = join(folder, 'atlas.sqlite');
  writeFileSync(input, JSON.stringify(fixture()));
  const run = (...args: string[]) => spawnSync(process.execPath, ['packages/cli/src/main.ts', ...args, '--json'], { encoding: 'utf8' });
  try {
    const imported = run('import', '--snapshot', input, '--db', db); assert.equal(imported.status, 0, imported.stderr); assert.equal(JSON.parse(imported.stdout).schemaVersion, 1);
    const snapshot = run('sources', 'minecraft:diamond', '--snapshot', input, '--limit', '1');
    const database = run('sources', 'minecraft:diamond', '--db', db, '--limit', '1');
    assert.equal(database.status, 0, database.stderr); assert.deepEqual(JSON.parse(database.stdout).result, JSON.parse(snapshot.stdout).result);
    const inspected = run('inspect', 'minecraft:dirt', '--db', db); assert.ok(JSON.parse(inspected.stdout).result.tags.items.includes('atlas:materials'));
    for (const args of [['sources', '--db', db], ['coverage', '--db', db, '--limit', '999'], ['serve', '--db', db, '--host', '0.0.0.0'], ['validate', '--model', input]]) {
      const error = run(...args); assert.equal(error.status, 1); assert.equal(JSON.parse(error.stdout).result, null);
    }
  } finally { rmSync(folder, { recursive: true, force: true }); }
});
