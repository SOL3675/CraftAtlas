import { writeFileSync, mkdirSync } from 'node:fs';
import { fixture, scenario } from '../tests/helpers.ts';
mkdirSync('fixtures', { recursive: true });
const before = fixture(), after = structuredClone(before);
after.id = 'fixture-after'; after.generation = 1;
(after.recipes[0].data as any).result.count = 4; after.tags['atlas:materials'] = ['minecraft:dirt'];
writeFileSync('fixtures/before.json', JSON.stringify(before, null, 2) + '\n');
writeFileSync('fixtures/after.json', JSON.stringify(after, null, 2) + '\n');
writeFileSync('fixtures/scenario.json', JSON.stringify(scenario(), null, 2) + '\n');
// These snapshots exercise version contracts only; they are not game captures.
const { snapshot1201 } = await import('../tests/fixtures-1.20.1.ts');
for (const loader of ['forge', 'fabric'] as const) writeFileSync(`fixtures/${loader}-1.20.1.json`, JSON.stringify(snapshot1201(loader), null, 2) + '\n');
