import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { canonical, hash } from '../packages/core/src/hash.ts';

// Run after `mch inspect`: compile current Java source directly, without a concurrent Gradle run.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = JSON.parse(readFileSync(join(root, 'harness.config.json'), 'utf8'));
const args = process.argv.slice(2), target = args[0] && !args[0].startsWith('--') ? args[0] : 'neoforge-1.21.1';
const option = (name: string) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
const suppliedGson = option('--gson'), ecj = option('--ecj');
const selected = config.targets[target]; assert.ok(selected, 'Target must be explicitly configured');
const manifest = suppliedGson ? undefined : JSON.parse(readFileSync(join(root, config.builds[selected.build].root, selected.artifactManifest), 'utf8'));
const gson = suppliedGson ? resolve(suppliedGson) : manifest.classpath.find((path: string) => /gson-[\d.]+\.jar$/.test(path));
assert.ok(gson, 'Provide --gson or inspect the selected target to resolve Gson');
const local = suppliedGson ? undefined : JSON.parse(readFileSync(join(root, 'harness.local.json'), 'utf8'));
const javaHome = local?.java[selected.java.game];
const java = (command: string) => javaHome ? join(javaHome, 'bin', command + (process.platform === 'win32' ? '.exe' : '')) : command;
mkdirSync(join(root, '.harness'), { recursive: true });
const temporary = mkdtempSync(join(root, '.harness/canonical-check-'));
const strings = [
  'literal\u2028separator', 'literal\u2029separator', 'literal\\u2028separator', 'literal\\u2029separator',
  'emoji\ud83d\ude00', 'lone-high\ud83d', 'lone-low\ude00', '\ud83dX\ude00',
  '\u0000\b\t\n\f\r\u001f', '"\\/<>',
];
const samples: unknown[] = [...strings, Object.fromEntries(strings.map((value, index) => [value, { value, index }]))];
// Exercise every UTF-16 code unit, in values and keys, including surrogate boundaries.
const allUnits = Array.from({ length: 65536 }, (_, index) => String.fromCharCode(index)).join('');
samples.push(allUnits, { [allUnits]: allUnits }, strings.map(value => ({ nested: [value] })));
samples.push(0, -0, 0.1, 1e-7, 1e-6, 1e20, 1e21, 1e23, Number.MAX_VALUE, Number.MIN_VALUE, Number.MAX_SAFE_INTEGER + 1);
let state = 123456789;
const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
for (let index = 0; index < 300; ++index) samples.push((random() * 2 - 1) * 10 ** Math.floor(random() * 616 - 308));
const input = join(temporary, 'samples.json'); writeFileSync(input, JSON.stringify(samples));
const sources = [
  join(root, 'mods/collector/src/main/java/dev/craftatlas/JsonFiles.java'),
  join(root, 'mods/collector/src/test/canonical/CanonicalProbe.java'),
];
const flags = ['-encoding', 'UTF-8', '-classpath', gson, '-d', temporary, ...sources];
if (ecj) execFileSync(java('java'), ['-jar', resolve(ecj), '-' + selected.java.toolchain, ...flags], { cwd: root, stdio: 'pipe' });
else execFileSync(java('javac'), ['--release', String(selected.java.toolchain), ...flags], { cwd: root, stdio: 'pipe' });
const output = execFileSync(java('java'), ['-classpath', [temporary, gson].join(delimiter), 'dev.craftatlas.CanonicalProbe', input], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const lines = output.trimEnd().split(/\r?\n/); assert.equal(lines.length, samples.length);
for (const [index, sample] of samples.entries()) {
  const [base64, digest] = lines[index].split('\t');
  assert.equal(Buffer.from(base64, 'base64').toString('utf8'), canonical(sample), `Canonical JSON differs in sample ${index}`);
  assert.equal(digest, hash(sample), `Canonical content hash differs in sample ${index}`);
}
process.stdout.write(JSON.stringify({ target, release: selected.java.toolchain, boundary: 'pure Java canonical/hash probe; no Minecraft APIs executed', cases: samples.length, utf16CodeUnits: 65536, status: 'passed' }) + '\n');
