import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { canonical, hash } from '../packages/core/src/hash.ts';

// Run after `mch inspect`: compile current Java source directly, without a concurrent Gradle run.
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const config = JSON.parse(readFileSync(join(root, 'harness.config.json'), 'utf8'));
const local = JSON.parse(readFileSync(join(root, 'harness.local.json'), 'utf8'));
const target = process.argv[2] ?? 'neoforge-1.21.1';
const manifest = JSON.parse(readFileSync(join(root, 'mods/collector/build/harness', target + '.json'), 'utf8'));
const gson = manifest.classpath.find((path: string) => /gson-[\d.]+\.jar$/.test(path));
assert.ok(gson, 'The inspected target must resolve Gson');
const javaHome = local.java[config.targets[target].java.game];
assert.ok(javaHome, 'The target game Java home must be configured');
const java = (command: string) => join(javaHome, 'bin', command + (process.platform === 'win32' ? '.exe' : ''));
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
execFileSync(java('javac'), ['-encoding', 'UTF-8', '-classpath', gson, '-d', temporary, ...sources], { cwd: root, stdio: 'pipe' });
const output = execFileSync(java('java'), ['-classpath', [temporary, gson].join(delimiter), 'dev.craftatlas.CanonicalProbe', input], { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
const lines = output.trimEnd().split(/\r?\n/); assert.equal(lines.length, samples.length);
for (const [index, sample] of samples.entries()) {
  const [base64, digest] = lines[index].split('\t');
  assert.equal(Buffer.from(base64, 'base64').toString('utf8'), canonical(sample), `Canonical JSON differs in sample ${index}`);
  assert.equal(digest, hash(sample), `Canonical content hash differs in sample ${index}`);
}
process.stdout.write(JSON.stringify({ cases: samples.length, utf16CodeUnits: 65536, status: 'passed' }) + '\n');
