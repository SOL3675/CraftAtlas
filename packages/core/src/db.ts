import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, renameSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical } from './hash.ts';
import { validateModel } from './validate.ts';
import { semanticHash } from './normalize.ts';
import type { Coverage, Model, Process, Resource } from './types.ts';
export interface QueryOptions { snapshotId?: string; limit?: number; offset?: number }
export interface Page<T> { items: T[]; total: number; limit: number; offset: number; truncated: boolean }
const ddl = `
PRAGMA foreign_keys=ON;
CREATE TABLE snapshots(id TEXT PRIMARY KEY, content_hash TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE resources(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, namespace TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE processes(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, source_id TEXT NOT NULL, type TEXT NOT NULL, namespace TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE input_slots(snapshot_id TEXT NOT NULL, process_id TEXT NOT NULL, slot INTEGER NOT NULL, amount REAL NOT NULL, unit TEXT NOT NULL, consumption TEXT NOT NULL, PRIMARY KEY(snapshot_id,process_id,slot), FOREIGN KEY(snapshot_id,process_id) REFERENCES processes(snapshot_id,id));
CREATE TABLE input_alternatives(snapshot_id TEXT NOT NULL, process_id TEXT NOT NULL, slot INTEGER NOT NULL, alternative INTEGER NOT NULL, resource_id TEXT, tag TEXT, payload TEXT NOT NULL, FOREIGN KEY(snapshot_id,process_id,slot) REFERENCES input_slots(snapshot_id,process_id,slot));
CREATE TABLE input_members(snapshot_id TEXT NOT NULL, process_id TEXT NOT NULL, slot INTEGER NOT NULL, resource_id TEXT NOT NULL);
CREATE TABLE outputs(snapshot_id TEXT NOT NULL, process_id TEXT NOT NULL, resource_id TEXT NOT NULL, amount REAL NOT NULL, unit TEXT NOT NULL, probability REAL, role TEXT NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(snapshot_id,process_id) REFERENCES processes(snapshot_id,id));
CREATE TABLE requirements(snapshot_id TEXT NOT NULL, process_id TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, FOREIGN KEY(snapshot_id,process_id) REFERENCES processes(snapshot_id,id));
CREATE TABLE tag_memberships(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), tag TEXT NOT NULL, resource_id TEXT NOT NULL, PRIMARY KEY(snapshot_id,tag,resource_id));
CREATE TABLE evidence(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE TABLE coverage(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), dataset TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE diagnostics(snapshot_id TEXT NOT NULL REFERENCES snapshots(id), id TEXT NOT NULL, rule TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(snapshot_id,id));
CREATE INDEX resources_search ON resources(snapshot_id,namespace,kind,id);
CREATE INDEX process_types ON processes(snapshot_id,type,id);
CREATE INDEX input_lookup ON input_members(snapshot_id,resource_id,process_id);
CREATE INDEX output_lookup ON outputs(snapshot_id,resource_id,process_id);
CREATE INDEX requirement_lookup ON requirements(snapshot_id,id,process_id);
CREATE INDEX tag_lookup ON tag_memberships(snapshot_id,resource_id);
PRAGMA user_version=1;`;
export function buildDatabase(path: string, model: Model): void {
  const m = validateModel(model); mkdirSync(dirname(path), { recursive: true });
  if (semanticHash(m) !== m.contentHash) throw new Error('Normalized content hash mismatch');
  const temp = path + '.tmp-' + randomUUID(); const db = new DatabaseSync(temp);
  try {
    db.exec(ddl); db.exec('BEGIN');
    db.prepare('INSERT INTO snapshots VALUES(?,?,?)').run(m.snapshotId, m.contentHash, canonical(m));
    const insert = (table: string, values: (string | number | null)[]) => db.prepare(`INSERT INTO ${table} VALUES(${values.map(() => '?').join(',')})`).run(...values);
    for (const r of m.resources) insert('resources', [m.snapshotId, r.id, r.kind, r.name, r.id.split(':')[0], canonical(r)]);
    for (const p of m.processes) {
      insert('processes', [m.snapshotId, p.id, p.sourceId, p.type, p.id.split(':')[0], canonical(p)]);
      for (const [index, slot] of p.inputs.entries()) {
        insert('input_slots', [m.snapshotId, p.id, index, slot.amount, slot.unit, slot.consumption]);
        for (const [i, a] of slot.alternatives.entries()) {
          insert('input_alternatives', [m.snapshotId, p.id, index, i, a.resource ?? null, a.tag ?? null, canonical(a)]);
          for (const resource of new Set(a.resource ? [a.resource] : a.members ?? [])) insert('input_members', [m.snapshotId, p.id, index, resource]);
        }
      }
      for (const o of p.outputs) insert('outputs', [m.snapshotId, p.id, o.resource, o.amount, o.unit, o.probability, o.role, canonical(o)]);
      for (const r of p.requirements) insert('requirements', [m.snapshotId, p.id, r.kind, r.id, canonical(r)]);
    }
    for (const [tag, members] of Object.entries(m.tags)) for (const member of new Set(members)) insert('tag_memberships', [m.snapshotId, tag, member]);
    for (const e of m.evidence) insert('evidence', [m.snapshotId, e.id, e.kind, canonical(e)]);
    for (const c of m.coverage) insert('coverage', [m.snapshotId, c.dataset, c.type, c.status, canonical(c)]);
    for (const d of m.diagnostics) insert('diagnostics', [m.snapshotId, d.id, d.rule, d.target, canonical(d)]);
    db.exec('COMMIT');
  } finally { db.close(); }
  // Whole-file rebuild is atomic; no partially imported snapshot is queryable.
  renameSync(temp, path);
}
export class AtlasDatabase {
  private db: DatabaseSync;
  constructor(path: string) {
    if (!existsSync(path)) throw new Error(`Database not found: ${path}`);
    this.db = new DatabaseSync(path, { readOnly: true });
    if ((this.db.prepare('PRAGMA user_version').get() as any).user_version !== 1) { this.db.close(); throw new Error('Unsupported database version'); }
  }
  snapshots(): { id: string; contentHash: string }[] { return this.db.prepare('SELECT id,content_hash AS contentHash FROM snapshots ORDER BY id').all() as any; }
  private snapshot(options: QueryOptions = {}) { const id = options.snapshotId ?? this.snapshots()[0]?.id; if (!id || !this.db.prepare('SELECT id FROM snapshots WHERE id=?').get(id)) throw new Error('Unknown snapshot'); return id; }
  model(snapshotId?: string): Model { const id = this.snapshot({ snapshotId }); return validateModel(JSON.parse((this.db.prepare('SELECT payload FROM snapshots WHERE id=?').get(id) as any).payload)); }
  private page<T>(sql: string, params: (string | number)[], options: QueryOptions): Page<T> {
    const limit = options.limit ?? 50, offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0 || offset > 1000000) throw new Error('Invalid pagination; limit 1..500, offset 0..1000000');
    const total = Number((this.db.prepare(`SELECT COUNT(*) AS total FROM (${sql})`).get(...params) as any).total);
    const items = this.db.prepare(sql + ' LIMIT ? OFFSET ?').all(...params, limit, offset).map(row => JSON.parse(row.payload as string)) as T[];
    return { items, total, limit, offset, truncated: offset + items.length < total };
  }
  search(query: string, options: QueryOptions = {}): Page<Resource> {
    if (query.length > 256) throw new Error('Search query too long');
    const escaped = query.replace(/[\\%_]/g, '\\$&');
    return this.page('SELECT payload FROM resources WHERE snapshot_id=? AND (id LIKE ? ESCAPE \'\\\' OR name LIKE ? ESCAPE \'\\\') ORDER BY id', [this.snapshot(options), `%${escaped}%`, `%${escaped}%`], options);
  }
  sources(id: string, options: QueryOptions = {}): Page<Process> { return this.page('SELECT p.payload FROM processes p WHERE p.snapshot_id=? AND EXISTS(SELECT 1 FROM outputs o WHERE o.snapshot_id=p.snapshot_id AND o.process_id=p.id AND o.resource_id=?) ORDER BY p.id', [this.snapshot(options), id], options); }
  uses(id: string, options: QueryOptions = {}): Page<Process> { return this.page("SELECT p.payload FROM processes p WHERE p.snapshot_id=? AND (EXISTS(SELECT 1 FROM input_members i WHERE i.snapshot_id=p.snapshot_id AND i.process_id=p.id AND i.resource_id=?) OR EXISTS(SELECT 1 FROM requirements r WHERE r.snapshot_id=p.snapshot_id AND r.process_id=p.id AND r.id=? AND r.kind IN ('equipment','stage','dimension'))) ORDER BY p.id", [this.snapshot(options), id, id], options); }
  inspect(id: string, options: QueryOptions = {}): { resource?: Resource; tags: string[]; sources: Process[]; uses: Process[]; truncated: boolean } {
    const snapshot = this.snapshot(options), row = this.db.prepare('SELECT payload FROM resources WHERE snapshot_id=? AND id=?').get(snapshot, id);
    const tags = this.db.prepare('SELECT tag FROM tag_memberships WHERE snapshot_id=? AND resource_id=? ORDER BY tag').all(snapshot, id).map(r => r.tag as string);
    const sources = this.sources(id, options), uses = this.uses(id, options);
    return { ...(row ? { resource: JSON.parse(row.payload as string) } : {}), tags, sources: sources.items, uses: uses.items, truncated: sources.truncated || uses.truncated };
  }
  coverage(options: QueryOptions = {}): Page<Coverage> { return this.page('SELECT payload FROM coverage WHERE snapshot_id=? ORDER BY dataset,type', [this.snapshot(options)], options); }
  close() { this.db.close(); }
}
export const openDatabase = (path: string) => new AtlasDatabase(path);
