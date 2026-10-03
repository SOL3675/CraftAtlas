import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import type { Artifact } from 'craft-foundry/core/types';
import { bytesHash } from '../../core/src/hash.ts';
export interface Case { id: string; status: 'passed' | 'failed' | 'unsupported' | 'skipped' | 'infrastructure-error'; message?: string; durationMs?: number }
export class RequiredUnsupported extends Error {}
export function runArtifacts(runRoot: string, target: string): Artifact[] {
  const root = resolve(runRoot, 'artifacts', target);
  const files = readdirSync(root).filter(f => /^artifacts-[a-f0-9]{64}\.json$/.test(f));
  if (files.length !== 1) throw new Error('This run must contain exactly one recorded artifact set');
  const metaBytes = readFileSync(resolve(root, files[0]));
  if (`artifacts-${bytesHash(metaBytes)}.json` !== files[0]) throw new Error('Artifact metadata hash mismatch');
  const manifest = JSON.parse(metaBytes.toString());
  if (manifest.schemaVersion !== 1 || manifest.target !== target) throw new Error('Artifact target mismatch');
  return manifest.artifacts.map((artifact: Artifact) => {
    const path = resolve(root, artifact.path), rel = relative(root, path);
    if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Artifact path escapes run');
    const bytes = readFileSync(path);
    if (bytesHash(bytes) !== artifact.sha256 || bytes.length !== artifact.size) throw new Error('Recorded artifact changed');
    return { ...artifact, path: relative(runRoot, path) };
  });
}
export function saveResults(session: string, cases: Case[]) {
  if (!cases.length || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error('No cases or duplicate results');
  mkdirSync(session, { recursive: true });
  writeFileSync(resolve(session, 'results.json'), JSON.stringify({ schemaVersion: 1, cases }, null, 2) + '\n', { flag: 'wx' });
}
export async function waitFor<T>(label: string, action: () => T | Promise<T>, ready: (value: T) => boolean, timeoutMs = 120000): Promise<T> {
  const start = Date.now();
  for (;;) {
    try { const value = await action(); if (ready(value)) return value; } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error; }
    if (Date.now() - start > timeoutMs) throw new Error(`${label} timeout`);
    await new Promise(r => setTimeout(r, 200));
  }
}
