import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readSnapshot } from '../../core/src/snapshot.ts';
import { normalize } from '../../core/src/normalize.ts';
import { validate, validateModel } from '../../core/src/validate.ts';
import { buildDatabase, openDatabase } from '../../core/src/db.ts';
import { analyze } from '../../core/src/analyze.ts';
import { audit } from '../../core/src/audit.ts';
import { diff } from '../../core/src/diff.ts';
import { applyDefinitions } from '../../core/src/definitions.ts';
import { calculateCost } from '../../core/src/cost.ts';
import type { CostRequest, DefinitionPack, Expectations, Model, Scenario } from '../../core/src/types.ts';
import { bounds, boundedCost, createAtlasServer, envelope } from '../../web/src/server.ts';

const help = `Craft Atlas — offline snapshot search and analysis
Usage: pnpm atlas <command> [target] [options]
Commands: validate import inspect sources uses coverage explain audit diff cost serve
Input: --snapshot <JSON or directory> | --model <JSON> | --db <SQLite>
Options: --json --snapshot-id <id> --limit <0..100> --offset <0..1000000>
         --depth <0..5> --scenario <JSON> --expectations <JSON>
         --definitions <JSON> (repeatable) --before <snapshot/model> --after <snapshot/model>
Cost: --request <selected-plan JSON> --scenario <JSON>
Import: --snapshot <path> --db <destination>
Serve: --port <0..65535> --host <127.0.0.1|localhost|::1>
Display filters never change scenario forbiddenProcesses or allowedTypes.
`;
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
function fileModel(path: string): Model {
  if (!statSync(path).isDirectory()) { const json = readJson(path); if ('snapshotId' in json) return validateModel(json); }
  return normalize(readSnapshot(path));
}
function parse(argv: string[]) {
  const options: Record<string, string> = {}, definitions: string[] = [], positional: string[] = [];
  const names = new Set(['snapshot', 'model', 'db', 'snapshot-id', 'limit', 'offset', 'depth', 'scenario', 'expectations', 'before', 'after', 'definitions', 'port', 'host', 'request']);
  for (let index = 0; index < argv.length; index++) {
    const value = argv[index];
    if (value === '--json' || value === '--help') { options[value.slice(2)] = 'true'; continue; }
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const name = value.slice(2);
    if (!names.has(name)) throw new Error(`Unknown option ${value}`);
    const argument = argv[++index]; if (!argument || argument.startsWith('--')) throw new Error(`Missing value for ${value}`);
    if (name === 'definitions') definitions.push(argument);
    else { if (name in options) throw new Error(`Duplicate option ${value}`); options[name] = argument; }
  }
  if (positional.length > 2) throw new Error('Unexpected positional arguments');
  return { options, definitions, command: positional[0], target: positional[1] };
}
export async function runCLI(argv: string[]): Promise<number> {
  let query: unknown = { argv };
  try {
    const { options: o, definitions, command, target } = parse(argv);
    if (!command || o.help) { process.stdout.write(help); return 0; }
    const commands = ['validate', 'import', 'inspect', 'sources', 'uses', 'coverage', 'explain', 'audit', 'diff', 'cost', 'serve'];
    if (!commands.includes(command)) throw new Error(`Unknown command ${command}`);
    const limit = bounds(o.limit, 30, 100, 'limit'), offset = bounds(o.offset, 0, 1_000_000, 'offset'), depth = bounds(o.depth, 1, 5, 'depth');
    query = { command, target: target ?? null, limit, offset, depth, snapshotId: o['snapshot-id'] ?? null };
    const scenario = o.scenario ? validate<Scenario>('scenario', readJson(o.scenario)) : undefined;
    const expectations = o.expectations ? validate<Expectations>('expectations', readJson(o.expectations)) : undefined;
    const costRequest = o.request ? validate<CostRequest>('cost-request', readJson(o.request)) : undefined;
    const readInput = (): Model => {
      let model: Model;
      if (o.snapshot) model = normalize(readSnapshot(o.snapshot));
      else if (o.model) model = validateModel(readJson(o.model));
      else if (o.db) { const db = openDatabase(o.db); try { model = db.model(o['snapshot-id']); } finally { db.close(); } }
      else if (command === 'diff' && o.after) model = fileModel(o.after);
      else throw new Error('Provide --snapshot, --model, or --db');
      if (definitions.length) {
        if (!o.snapshot) throw new Error('--definitions requires --snapshot for exact target version metadata');
        const snapshot = readSnapshot(o.snapshot);
        model = applyDefinitions(model, definitions.map(path => validate<DefinitionPack>('definitions', readJson(path))), { minecraft: snapshot.minecraft, loader: snapshot.loader });
      }
      return model;
    };
    const model = readInput(); let result: unknown; const limitations: string[] = [];
    const page = <T>(items: T[]) => ({ items: items.slice(offset, offset + limit), total: items.length, limit, offset, truncated: offset > 0 || offset + limit < items.length });
    const sources = () => model.processes.filter(p => p.outputs.some(output => output.resource === target));
    const uses = () => model.processes.filter(p => p.inputs.some(slot => slot.alternatives.some(a => a.resource === target || a.members?.includes(target!))) || p.requirements.some(r => ['equipment', 'stage', 'dimension'].includes(r.kind) && r.id === target));
    const requiredTarget = () => { if (!target) throw new Error(`${command} requires a target ID`); };
    const dbQuery = (kind: 'sources' | 'uses' | 'coverage') => {
      const db = openDatabase(o.db);
      try {
        const options = { snapshotId: o['snapshot-id'], limit: Math.max(1, limit), offset };
        const result = kind === 'coverage' ? db.coverage(options) : db[kind](target!, options);
        return { ...result, limit, items: result.items.slice(0, limit), truncated: offset > 0 || offset + limit < result.total };
      } finally { db.close(); }
    };
    const dbOnly = o.db && !o.snapshot && !o.model;
    switch (command) {
      case 'validate': result = { valid: true, snapshotId: model.snapshotId, contentHash: model.contentHash, coverage: page(model.coverage) }; break;
      case 'import':
        if (!o.db || (!o.snapshot && !o.model)) throw new Error('import requires --snapshot or --model and --db');
        buildDatabase(o.db, model); result = { database: resolve(o.db), snapshotId: model.snapshotId, contentHash: model.contentHash, resources: model.resources.length, processes: model.processes.length }; break;
      case 'inspect': {
        requiredTarget(); let resource = model.resources.find(r => r.id === target) ?? null;
        let tags = Object.entries(model.tags).filter(([, members]) => members.includes(target!)).map(([tag]) => tag);
        if (dbOnly) { const db = openDatabase(o.db); try { const inspected = db.inspect(target!, { snapshotId: o['snapshot-id'], limit: Math.max(1, limit), offset }); resource = inspected.resource ?? null; tags = inspected.tags; } finally { db.close(); } }
        result = { resource, process: model.processes.find(p => p.id === target) ?? null, tags: page(tags), sources: dbOnly ? dbQuery('sources') : page(sources()), uses: dbOnly ? dbQuery('uses') : page(uses()) }; break;
      }
      case 'sources': requiredTarget(); result = dbOnly ? dbQuery('sources') : page(sources()); break;
      case 'uses': requiredTarget(); result = dbOnly ? dbQuery('uses') : page(uses()); break;
      case 'coverage': result = dbOnly ? dbQuery('coverage') : page(model.coverage); break;
      case 'explain': {
        requiredTarget(); if (!scenario) throw new Error('explain requires --scenario');
        const analysis = analyze(model, scenario, target!);
        result = { ...analysis, reachable: page(analysis.reachable), path: analysis.path.slice(0, depth * limit), stopReasons: page(analysis.stopReasons), diagnostics: page(analysis.diagnostics), unknown: page(analysis.unknown) };
        if (analysis.path.length > depth * limit) limitations.push('Path truncated by --depth × --limit; reachability evaluation uses the full model');
        limitations.push(...analysis.limitations); break;
      }
      case 'audit':
        if (!expectations) throw new Error('audit requires --expectations');
        result = page(audit(model, expectations, scenario)); break;
      case 'cost': {
        if (!costRequest || !scenario) throw new Error('cost requires --request and --scenario');
        const analysis = calculateCost(model, costRequest, scenario); result = boundedCost(analysis, limit, offset); limitations.push(...analysis.limitations); break;
      }
      case 'diff': {
        if (!o.before) throw new Error('diff requires --before');
        const comparison = diff(fileModel(o.before), model);
        result = { ...comparison, changes: page(comparison.changes), impact: { ...comparison.impact, resources: page(comparison.impact.resources), processes: page(comparison.impact.processes) } }; break;
      }
      case 'serve': {
        const host = o.host ?? '127.0.0.1'; if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('serve accepts only loopback hosts');
        const port = bounds(o.port, 4317, 65535, 'port');
        const server = createAtlasServer({ model, scenario, expectations, before: o.before ? fileModel(o.before) : undefined, costRequest });
        await new Promise<void>((done, reject) => { server.once('error', reject); server.listen(port, host, done); });
        const address = server.address(); const url = `http://${host === '::1' ? '[::1]' : host}:${typeof address === 'object' && address ? address.port : port}`;
        process.stdout.write(o.json ? JSON.stringify(envelope(query, { url, snapshotId: model.snapshotId }, model)) + '\n' : `Craft Atlas: ${url}\n`);
        const close = () => server.close(); process.once('SIGINT', close); process.once('SIGTERM', close);
        await new Promise<void>(done => server.once('close', done)); return 0;
      }
    }
    const output = envelope(query, result, model, limitations);
    process.stdout.write(JSON.stringify(output, null, o.json ? undefined : 2) + '\n'); return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes('--json')) process.stdout.write(JSON.stringify({ schemaVersion: 1, query, result: null, evidence: [], limitations: [message] }) + '\n');
    else process.stderr.write(`Craft Atlas: ${message}\n`);
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = await runCLI(process.argv.slice(2));
