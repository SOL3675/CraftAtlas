import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const pins = { mekanism: '10.7.14.79', crafttweaker: '21.0.38', jei: '19.22.1.316' };
const mods = [];
mkdirSync('.harness/pack', { recursive: true });
for (const [project, version] of Object.entries(pins)) {
  const response = await fetch(`https://api.modrinth.com/v2/project/${project}/version?game_versions=%5B%221.21.1%22%5D&loaders=%5B%22neoforge%22%5D`, { headers: { 'User-Agent': 'CraftAtlas/0.1.0 local validation' } });
  if (!response.ok) throw new Error(`Modrinth ${project}: ${response.status}`);
  const candidates = await response.json() as any[];
  const selected = candidates.find(v => v.version_number === version);
  if (!selected) throw new Error(`Fixed version missing: ${project} ${version}`);
  const file = selected.files.find((f: any) => f.primary) ?? selected.files.find((f: any) => !f.filename.includes('-api'));
  const data = Buffer.from(await (await fetch(file.url)).arrayBuffer());
  if (createHash('sha512').update(data).digest('hex') !== file.hashes.sha512) throw new Error(`Hash mismatch: ${file.filename}`);
  writeFileSync(`.harness/pack/${file.filename}`, data);
  mods.push({ id: project, version, filename: file.filename, url: file.url, sha256: createHash('sha256').update(data).digest('hex'), side: project === 'jei' ? 'client' : 'both', dependencies: selected.dependencies });
}
writeFileSync('fixtures/pack.lock.json', JSON.stringify({ schemaVersion: 1, minecraft: '1.21.1', loader: 'neoforge', loaderVersion: '21.1.252', mods }, null, 2) + '\n');
console.log(mods.map(m => ({ id: m.id, version: m.version, sha256: m.sha256, dependencies: m.dependencies })));
