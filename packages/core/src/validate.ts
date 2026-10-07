import { readFileSync } from 'node:fs';
import { Ajv } from 'ajv';
import type { Model, Snapshot } from './types.ts';
import { bytesHash, hash } from './hash.ts';
import { validateDatapack } from './datapack.ts';
const ajv = new Ajv({ allErrors: true, strict: false });
const validators = new Map<string, ReturnType<Ajv['compile']>>();
export function validate<T>(kind: string, value: unknown): T {
  let check = validators.get(kind);
  if (!check) {
    check = ajv.compile(JSON.parse(readFileSync(new URL(`../../../schemas/${kind}.schema.json`, import.meta.url), 'utf8')));
    validators.set(kind, check);
  }
  if (!check(value)) throw new Error(`${kind}: ${ajv.errorsText(check.errors, { separator: '; ' })}`);
  return value as T;
}
function unique(ids: string[], label: string) { if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label}`); }
export function validateSnapshot(value: unknown): Snapshot {
  const s = validate<Snapshot>('snapshot', value);
  unique(s.recipes.map(r => r.id), 'recipe ID'); unique(s.resources.map(r => r.id), 'resource ID');
  validateDatapack(s.datapack);
  for (const r of s.recipes) if (r.serialization) {
    const raw = r.serialization;
    if (raw.bytesBase64 === undefined) { if (!raw.error) throw new Error(`Missing recipe network bytes: ${r.id}`); }
    else if (Buffer.from(raw.bytesBase64, 'base64').toString('base64') !== raw.bytesBase64 || bytesHash(Buffer.from(raw.bytesBase64, 'base64')) !== raw.sha256) throw new Error(`Recipe network checksum mismatch: ${r.id}`);
  }
  if (s.runtimeIdentity && typeof s.runtimeIdentity === 'object' && !Array.isArray(s.runtimeIdentity) && s.runtimeIdentity.status === 'complete') {
    if (s.runtimeIdentity.session !== s.session || s.runtimeIdentity.generation !== s.generation) throw new Error('Stale runtime identity session/generation');
    if (s.runtimeIdentity.startupJarsHash !== hash(s.runtimeIdentity.loadedJars)) throw new Error('Loaded runtime JAR identity changed after startup');
    const inputs = s.runtimeIdentity.inputs as Record<string, string>;
    const configuration = Object.fromEntries(Object.entries(inputs).filter(([key]) => key === 'server.properties' || ['config/', 'defaultconfigs/', 'world/serverconfig/'].some(root => key.startsWith(root))));
    if (s.runtimeIdentity.startupConfigurationHash !== hash(configuration) || s.runtimeIdentity.startupPropertiesHash !== hash(s.runtimeIdentity.jvmProperties)) throw new Error('Runtime configuration/JVM identity changed after startup');
  }
  if (s.completion.status === 'failed') throw new Error('Snapshot failed');
  if (s.viewer && (s.viewer.session !== s.session || s.viewer.generation !== s.generation)) throw new Error('Stale viewer generation/session');
  if (s.viewer) unique(s.viewer.recipes.map(r => r.id), 'viewer source ID');
  if (s.world) for (const kind of ['lootTables', 'lootModifiers', 'lootSources', 'biomes', 'dimensions', 'features'] as const) unique(s.world[kind].map(r => r.id), `world ${kind} ID`);
  for (const c of s.coverage) if (c.enumerated !== null && c.interpreted !== null && c.interpreted > c.enumerated) throw new Error('Invalid coverage denominator');
  return s;
}
export function validateModel(value: unknown): Model {
  const m = validate<Model>('model', value);
  validateDatapack(m.datapack);
  unique(m.processes.map(p => p.id), 'process ID'); unique(m.evidence.map(e => e.id), 'evidence ID');
  for (const p of m.processes) for (const s of p.inputs) for (const a of s.alternatives) {
    if (!a.resource && !a.tag && !a.predicate) throw new Error(`Empty alternative in ${p.id}`);
    if (a.tag && !Array.isArray(a.members)) throw new Error(`Unexpanded tag in ${p.id}`);
  }
  return m;
}
