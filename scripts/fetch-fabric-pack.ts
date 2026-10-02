import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { bytesHash } from '../packages/core/src/hash.ts';
const lock = JSON.parse(readFileSync(new URL('../fixtures/pack-fabric.lock.json', import.meta.url), 'utf8'));
mkdirSync('.harness/pack-fabric', { recursive: true });
for (const mod of lock.mods) {
  const path = `.harness/pack-fabric/${mod.filename}`;
  if (existsSync(path) && bytesHash(readFileSync(path)) === mod.sha256) continue;
  const response = await fetch(mod.url);
  if (!response.ok) throw new Error(`Download failed ${mod.id}: ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (bytesHash(data) !== mod.sha256) throw new Error(`Fixed Fabric pack checksum mismatch: ${mod.filename}`);
  writeFileSync(path, data);
}
console.log('Fixed Fabric pack hashes verified.');
