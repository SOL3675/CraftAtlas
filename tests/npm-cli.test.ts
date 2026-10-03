import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { selectNpmCli } from '../scripts/lib/npm-cli.mjs';

function fixture(t: test.TestContext) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'npm cli 空白 ')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function cli(name: string, version: string, prefix = root) {
    const folder = join(root, name), path = join(folder, 'node_modules/npm/bin/npm-cli.js');
    mkdirSync(join(folder, 'node_modules/npm/bin'), { recursive: true });
    writeFileSync(path, `console.log(process.argv.includes('--version') ? ${JSON.stringify(version)} : ${JSON.stringify(prefix)});`);
    return { folder, path };
  }
  const env = { ...process.env, npm_execpath: '', CRAFTFOUNDRY_NPM_CLI: '', PATH: '' };
  return { root, cli, env };
}

test('npm selection skips an older bundled CLI even when npm_execpath and PATH prefer it', t => {
  const f = fixture(t), old = f.cli('old', '10.9.0'), pinned = f.cli('pinned', '11.9.0');
  const env = { ...f.env, npm_execpath: old.path, PATH: [old.folder, pinned.folder].join(delimiter) };
  assert.equal(selectNpmCli(f.root, '11.9.0', env), pinned.path);
});

test('npm selection finds an upgraded global prefix that is absent from PATH', t => {
  const f = fixture(t), pinned = f.cli('global-prefix', '11.9.0'), old = f.cli('bundled', '10.9.0', pinned.folder);
  assert.equal(selectNpmCli(f.root, '11.9.0', { ...f.env, PATH: old.folder }), pinned.path);
});

test('npm selection refuses an unpinned version instead of silently using it', t => {
  const f = fixture(t), old = f.cli('bundled', '10.9.0');
  assert.throws(() => selectNpmCli(f.root, '11.9.0', { ...f.env, PATH: old.folder }), /Use npm 11.9.0.*discovered versions: 10.9.0/);
});


test('an explicit CI npm entry point survives package-manager npm_execpath overrides', t => {
  const f = fixture(t), pinned = f.cli('ci-prefix', '11.9.0'), old = f.cli('bundled', '10.9.0');
  assert.equal(selectNpmCli(f.root, '11.9.0', { ...f.env, CRAFTFOUNDRY_NPM_CLI: pinned.path, npm_execpath: old.path, PATH: old.folder }), pinned.path);
  assert.throws(() => selectNpmCli(f.root, '11.9.0', { ...f.env, CRAFTFOUNDRY_NPM_CLI: old.path, PATH: pinned.folder }), /CRAFTFOUNDRY_NPM_CLI must identify npm 11.9.0/);
});
