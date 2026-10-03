import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { delimiter, join } from 'node:path';

/** Find the pinned npm JS entry point without executing a Windows cmd shim. */
export function selectNpmCli(root, version, env = process.env) {
  const candidates = new Set();
  const add = file => {
    if (file && file.endsWith('npm-cli.js') && existsSync(file)) candidates.add(realpathSync(file));
  };
  add(env.npm_execpath);
  for (const entry of (env.PATH ?? env.Path ?? '').split(delimiter)) {
    if (!entry) continue;
    add(join(entry, 'node_modules/npm/bin/npm-cli.js'));
    const shim = join(entry, 'npm');
    if (existsSync(shim)) add(realpathSync(shim));
  }
  const probe = (cli, args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    });
    return result.status === 0 ? result.stdout.trim() : undefined;
  };
  if (env.CRAFTFOUNDRY_NPM_CLI) {
    const explicit = env.CRAFTFOUNDRY_NPM_CLI;
    if (!explicit.endsWith('npm-cli.js') || !existsSync(explicit) || probe(explicit, ['--version']) !== version) {
      throw new Error(`CRAFTFOUNDRY_NPM_CLI must identify npm ${version}'s npm-cli.js.`);
    }
    return realpathSync(explicit);
  }
  const versions = new Map();
  const matching = () => {
    for (const cli of candidates) {
      if (!versions.has(cli)) versions.set(cli, probe(cli, ['--version']));
      if (versions.get(cli) === version) return cli;
    }
  };
  let selected = matching();
  if (selected) return selected;
  // On Windows a global npm upgrade may use a prefix not yet on PATH. The
  // bundled npm can report that prefix while still being the old version.
  for (const cli of [...candidates]) {
    const prefix = probe(cli, ['prefix', '--global']);
    if (prefix) {
      add(join(prefix, 'node_modules/npm/bin/npm-cli.js'));
      add(join(prefix, 'lib/node_modules/npm/bin/npm-cli.js'));
    }
  }
  selected = matching();
  if (selected) return selected;
  const found = [...versions.values()].filter(Boolean).join(', ') || 'none';
  throw new Error(`Use npm ${version} to reproduce package bytes; discovered versions: ${found}. Install the pinned npm or put its prefix on PATH.`);
}
