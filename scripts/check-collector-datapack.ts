import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { validateDatapack } from '../packages/core/src/datapack.ts';
import { validate } from '../packages/core/src/validate.ts';
import { normalize } from '../packages/core/src/normalize.ts';
import { readSnapshot } from '../packages/core/src/snapshot.ts';
import { fixture } from '../tests/helpers.ts';
import type { Coverage, DatapackData } from '../packages/core/src/types.ts';

// Uses an existing Gson dependency. Optional ECJ permits pure Java tests on a JRE.
// No dependency downloads, network changes, Gradle, or Minecraft execution here.
const args = process.argv.slice(2);
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const gson = option('--gson'); assert.ok(gson, 'Provide --gson <existing gson JAR>');
const ecj = option('--ecj'), temp = mkdtempSync(join(tmpdir(), 'atlas-java-datapack-'));
try {
  const sources = ['JsonFiles.java', 'DatapackCollector.java'].map(name => resolve('mods/collector/src/main/java/dev/craftatlas', name));
  sources.push(resolve('mods/collector/src/test/datapack/DatapackProbe.java'));
  const flags = ['-encoding', 'UTF-8', '-classpath', resolve(gson), '-d', temp, ...sources];
  if (ecj) execFileSync('java', ['-jar', resolve(ecj), '-21', ...flags], { stdio: 'pipe' });
  else execFileSync('javac', ['--release', '21', ...flags], { stdio: 'pipe' });
  const javaArgs = ['-classpath', [temp, resolve(gson)].join(delimiter), 'dev.craftatlas.DatapackProbe'];
  const output = execFileSync('java', [...javaArgs, resolve('fixtures/datapack-raw/mod-embedded'), resolve('fixtures/datapack-raw/override')], { encoding: 'utf8' });
  const result = JSON.parse(output) as { datapack: DatapackData; coverage: Coverage[]; errors: string[] };
  validateDatapack(result.datapack);
  const press = result.datapack.resources.find(r => r.id === 'atlas:recipe/press.json')!;
  assert.equal(press.effective.source, 'file/override'); assert.equal(press.stack.length, 2);
  assert.equal(press.stack[0]!.source, 'mod/embedded'); assert.notDeepEqual(press.effective.data, press.stack[0]!.data);
  assert.equal(press.stack[0]!.text, readFileSync('fixtures/datapack-raw/mod-embedded/data/atlas/recipe/press.json', 'utf8'));
  assert.deepEqual(result.datapack.disabledPacks, ['file/disabled']);
  assert.ok(result.datapack.resources.every(r => !r.id.includes('disabled')));
  assert.ok(result.datapack.resources.every(r => !r.id.includes('client_only')));
  assert.ok(result.datapack.resources.some(r => r.id === 'atlas:machines/press.json'));
  for (const id of ['malformed', 'unreadable', 'invalid_utf8', 'trailing', 'permissive', 'overflow']) assert.ok(result.datapack.resources.find(r => r.id === `atlas:recipe/${id}.json`)!.effective.error, id);
  const nonlast = result.datapack.resources.find(r => r.id === 'atlas:recipe/nonlast.json')!;
  assert.equal(nonlast.effective.source, 'selected'); assert.equal(nonlast.stack.at(-1)!.source, 'other', 'effective must come from the source API, not a stack priority guess');
  assert.equal(result.datapack.resources.find(r => r.id === 'atlas:recipe/invalid_utf8.json')!.effective.bytesBase64, '/w==');
  assert.equal(result.coverage[0]!.status, 'partial');
  assert.equal(result.coverage[0]!.enumerated, null, 'failed enumeration has an unknown denominator');
  assert.ok(result.errors.some(e => e.includes('Injected enumeration failure')));
  const s = fixture(); s.recipes = []; s.datapack = result.datapack; s.coverage = result.coverage;
  s.completion = { status: 'partial', errors: result.errors };
  const input = join(temp, 'snapshot.json'), published = join(temp, 'published'); writeFileSync(input, JSON.stringify(s));
  execFileSync('java', [...javaArgs, '--stage', input, published], { stdio: 'pipe' });
  assert.deepEqual(readSnapshot(published), s, 'Java staged dataset must pass TypeScript manifest/semantic checks');
  validate('snapshot', s); const model = normalize(s);
  assert.ok(model.processes.every(p => p.interpretation === 'opaque' && p.execution === 'unconfirmed'));
  assert.ok(model.processes.every(p => !p.outputs.length));
  process.stdout.write(JSON.stringify({ status: 'passed', resources: result.datapack.resources.length, processes: model.processes.length, boundary: 'shared Java capture + TypeScript consumer; ResourceManager source is simulated' }) + '\n');
} finally { rmSync(temp, { recursive: true, force: true }); }
