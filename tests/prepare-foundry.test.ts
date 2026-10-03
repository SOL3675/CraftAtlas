import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../scripts/prepare-foundry.mjs', import.meta.url);
const pin = JSON.parse(readFileSync(new URL('../craft-foundry.source.json', import.meta.url), 'utf8'));
function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
function fixture(t: test.TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'atlas bootstrap 空白 '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'Foundry');
  const atlas = join(source, 'projects', 'craft-atlas');
  mkdirSync(join(atlas, 'scripts', 'lib'), { recursive: true });
  copyFileSync(new URL('../scripts/lib/npm-cli.mjs', import.meta.url), join(atlas, 'scripts', 'lib', 'npm-cli.mjs'));
  copyFileSync(script, join(atlas, 'scripts', 'prepare-foundry.mjs'));
  const pkg = { name: 'craft-foundry', version: '0.1.1', private: true, type: 'module', files: ['dist'], scripts: { build: 'node build.mjs' } };
  writeFileSync(join(source, 'package.json'), JSON.stringify(pkg));
  writeFileSync(join(source, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': pkg } }));
  writeFileSync(join(source, 'build.mjs'), "import{mkdirSync,writeFileSync}from'node:fs';mkdirSync('dist',{recursive:true});writeFileSync('dist/result.txt','committed source');");
  writeFileSync(join(source, '.gitignore'), 'projects/\n');
  git(source, 'init', '--quiet');
  git(source, 'add', '.');
  git(source, '-c', 'user.name=Bootstrap test', '-c', 'user.email=bootstrap@example.invalid', 'commit', '--quiet', '-m', 'Create pinned package fixture');
  const commit = git(source, 'rev-parse', 'HEAD');
  function setPin(sha = commit) {
    writeFileSync(join(atlas, 'craft-foundry.source.json'), JSON.stringify({ ...pin, commit: sha, version: pkg.version }));
  }
  setPin();
  const artifact = join(atlas, '.harness', 'vendor', 'craft-foundry.tgz');
  const lock = join(atlas, '.harness', 'vendor', 'prepare.lock');
  const run = () => spawnSync(process.execPath, ['scripts/prepare-foundry.mjs', '--source', '../..'], { cwd: atlas, encoding: 'utf8' });
  return { source, atlas, commit, artifact, lock, run, setPin };
}
const digest = (file: string) => createHash('sha512').update(readFileSync(file)).digest('hex');

test('bootstrap builds the pinned commit reproducibly from a dirty parent checkout with spaces', t => {
  const f = fixture(t);
  writeFileSync(join(f.source, 'build.mjs'), "throw new Error('dirty source must never run');");
  const statusBefore = git(f.source, 'status', '--porcelain');
  const first = f.run(); assert.equal(first.status, 0, first.stderr);
  const hash = digest(f.artifact);
  const second = f.run(); assert.equal(second.status, 0, second.stderr);
  assert.equal(digest(f.artifact), hash);
  assert.equal(git(f.source, 'rev-parse', 'HEAD'), f.commit);
  assert.equal(git(f.source, 'status', '--porcelain'), statusBefore);
  assert.equal(existsSync(f.lock), false);
});

test('bootstrap preserves an existing artifact when the pinned build fails', t => {
  const f = fixture(t);
  mkdirSync(join(f.atlas, '.harness', 'vendor'), { recursive: true });
  writeFileSync(f.artifact, 'previous package bytes');
  writeFileSync(join(f.source, 'build.mjs'), "throw new Error('intentional build failure');");
  git(f.source, 'add', 'build.mjs');
  git(f.source, '-c', 'user.name=Bootstrap test', '-c', 'user.email=bootstrap@example.invalid', 'commit', '--quiet', '-m', 'Inject failed build');
  f.setPin(git(f.source, 'rev-parse', 'HEAD'));
  const result = f.run(); assert.equal(result.status, 1);
  assert.match(result.stderr, /intentional build failure/);
  assert.equal(readFileSync(f.artifact, 'utf8'), 'previous package bytes');
  assert.equal(existsSync(f.lock), false);
});

test('bootstrap rejects mutable refs and overlapping work while preserving existing state', t => {
  const f = fixture(t);
  mkdirSync(join(f.atlas, '.harness', 'vendor'), { recursive: true });
  writeFileSync(f.artifact, 'previous package bytes');
  f.setPin('dev');
  const invalid = f.run(); assert.equal(invalid.status, 1); assert.match(invalid.stderr, /Invalid source pin/);
  f.setPin(); writeFileSync(f.lock, 'other owner');
  const overlap = f.run(); assert.equal(overlap.status, 1); assert.match(overlap.stderr, /EEXIST/);
  assert.equal(readFileSync(f.lock, 'utf8'), 'other owner');
  assert.equal(readFileSync(f.artifact, 'utf8'), 'previous package bytes');
});
