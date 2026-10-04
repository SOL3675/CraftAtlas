import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { bytesHash, hash } from './hash.ts';
import { validateSnapshot } from './validate.ts';
import type { Snapshot } from './types.ts';
export function readSnapshot(path: string): Snapshot {
  if (!existsSync(resolve(path, 'manifest.json'))) return validateSnapshot(JSON.parse(readFileSync(path, 'utf8')));
  const root = realpathSync(path);
  if (basename(root).includes('.tmp-')) throw new Error('Unpublished snapshot staging directory');
  const manifest = JSON.parse(readFileSync(resolve(root, 'manifest.json'), 'utf8'));
  if (manifest.schemaVersion !== 1 || !manifest.files || typeof manifest.files !== 'object') throw new Error('Invalid snapshot manifest');
  const completion = JSON.parse(readFileSync(resolve(root, 'completion.json'), 'utf8'));
  if (completion.manifestHash !== bytesHash(readFileSync(resolve(root, 'manifest.json'))) || !['complete', 'partial'].includes(completion.status)) throw new Error('Incomplete or tampered snapshot');
  if (completion.id !== manifest.id) throw new Error('Completion snapshot identity mismatch');
  const datasets: Record<string, unknown> = {};
  for (const [file, digest] of Object.entries(manifest.files)) {
    const target = realpathSync(resolve(root, file)), rel = relative(root, target);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Snapshot path escapes root');
    const bytes = readFileSync(target);
    if (bytesHash(bytes) !== digest) throw new Error(`Checksum mismatch: ${file}`);
    datasets[file] = file.endsWith('.jsonl') ? bytes.toString('utf8').split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)) : JSON.parse(bytes.toString('utf8'));
  }
  const s = validateSnapshot({ ...manifest.metadata, resources: datasets['resources.json'], tags: datasets['tags.json'], recipes: datasets['recipes.jsonl'], coverage: datasets['coverage.json'], environment: datasets['environment.json'], completion: { status: completion.status, errors: completion.errors }, ...(datasets['viewer.json'] ? { viewer: datasets['viewer.json'] } : {}), ...(datasets['world.json'] ? { world: datasets['world.json'] } : {}), ...(datasets['datapack.json'] ? { datapack: datasets['datapack.json'] } : {}) });
  if (s.id !== manifest.id || hash(s) !== manifest.contentHash) throw new Error('Snapshot semantic hash mismatch');
  return s;
}
export function writeSnapshot(path: string, value: Snapshot) {
  const s = validateSnapshot(value);
  if (existsSync(path)) throw new Error(`Refusing to overwrite snapshot ${path}`);
  const temp = path + '.tmp-' + randomUUID(); mkdirSync(temp, { recursive: true });
  const { resources, tags, recipes, coverage, environment, completion, viewer, world, datapack, ...metadata } = s;
  const files: Record<string, string> = {};
  const write = (name: string, data: string) => { writeFileSync(resolve(temp, name), data); files[name] = bytesHash(data); };
  write('resources.json', JSON.stringify(resources)); write('tags.json', JSON.stringify(tags)); write('coverage.json', JSON.stringify(coverage)); write('environment.json', JSON.stringify(environment));
  write('recipes.jsonl', recipes.map(r => JSON.stringify(r)).join('\n') + '\n');
  if (viewer) write('viewer.json', JSON.stringify(viewer));
  if (world) write('world.json', JSON.stringify(world));
  if (datapack) write('datapack.json', JSON.stringify(datapack));
  const manifest = JSON.stringify({ schemaVersion: 1, id: s.id, metadata, files, contentHash: hash(s) }); writeFileSync(resolve(temp, 'manifest.json'), manifest);
  writeFileSync(resolve(temp, 'completion.json'), JSON.stringify({ ...completion, id: s.id, manifestHash: bytesHash(manifest) }));
  renameSync(temp, path);
}
