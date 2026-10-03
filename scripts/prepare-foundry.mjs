import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync, copyFileSync, openSync, closeSync } from 'node:fs';
import { delimiter, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Run before pnpm install: no dependencies or consumer lifecycle hooks required.
const root = fileURLToPath(new URL('../', import.meta.url));
function run(command, args, cwd, capture = false) {
  const result = spawnSync(command, args, {
    cwd, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', npm_config_cache: join(root, '.harness/cache/npm') },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.signal})`);
  return result.stdout?.trim();
}
function npmCli() {
  // Execute npm's JS entry point with Node, avoiding Windows .cmd/shell quoting.
  const candidates = [process.env.npm_execpath];
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue;
    candidates.push(join(entry, 'node_modules/npm/bin/npm-cli.js'));
    const shim = join(entry, 'npm');
    if (existsSync(shim)) candidates.push(realpathSync(shim));
  }
  const cli = candidates.find(file => file && file.endsWith('npm-cli.js') && existsSync(file));
  if (!cli) throw new Error('npm CLI not found. Install the pinned npm with Node and put it on PATH.');
  return cli;
}
function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--source' && args[1])) {
    throw new Error('Usage: node scripts/prepare-foundry.mjs [--source <existing-git-checkout>]');
  }
  const pin = JSON.parse(readFileSync(join(root, 'craft-foundry.source.json'), 'utf8'));
  if (pin.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(pin.commit) ||
      !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(?:\.git)?$/.test(pin.repository) ||
      !/^\d+\.\d+\.\d+$/.test(pin.version)) throw new Error('Invalid source pin: require an HTTPS repository, full lowercase commit SHA, and package version.');
  if (process.versions.node !== pin.node) throw new Error(`Use Node ${pin.node}; found ${process.versions.node}`);
  const cli = npmCli();
  if (run(process.execPath, [cli, '--version'], root, true) !== pin.npm) throw new Error(`Use npm ${pin.npm} to reproduce package bytes.`);
  const source = args.length ? resolve(args[1]) : pin.repository;
  if (args.length && realpathSync(run('git', ['rev-parse', '--show-toplevel'], source, true)) !== realpathSync(source)) {
    throw new Error('--source must name the Foundry Git root.');
  }
  const vendor = join(root, '.harness/vendor');
  mkdirSync(vendor, { recursive: true });
  const lock = join(vendor, 'prepare.lock');
  const fd = openSync(lock, 'wx');
  writeFileSync(fd, JSON.stringify({ pid: process.pid, commit: pin.commit }) + '\n');
  closeSync(fd);
  let temp;
  try {
    temp = mkdtempSync(join(vendor, 'prepare-'));
    const checkout = join(temp, 'source');
    mkdirSync(checkout);
    run('git', ['init', '--quiet'], checkout);
    run('git', ['config', 'core.autocrlf', 'false'], checkout);
    run('git', ['config', 'core.eol', 'lf'], checkout);
    run('git', ['-c', 'submodule.recurse=false', 'fetch', '--no-tags', '--depth=1', '--', source, pin.commit], checkout);
    run('git', ['-c', 'submodule.recurse=false', 'checkout', '--quiet', '--detach', pin.commit], checkout);
    if (run('git', ['rev-parse', 'HEAD'], checkout, true) !== pin.commit) throw new Error('Source identity mismatch');
    const pkg = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'));
    if (pkg.name !== 'craft-foundry' || pkg.version !== pin.version) throw new Error('Pinned package identity/version mismatch');
    run(process.execPath, [cli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], checkout);
    run(process.execPath, [cli, 'run', 'build'], checkout);
    // Explicit build above; disable arbitrary pre/postpack hooks.
    const packed = JSON.parse(run(process.execPath, [cli, 'pack', '--ignore-scripts', '--json', '--pack-destination', temp], checkout, true));
    if (packed.length !== 1 || packed[0].filename !== `craft-foundry-${pin.version}.tgz`) throw new Error('Unexpected pack output');
    const staged = join(temp, 'craft-foundry.tgz');
    copyFileSync(join(temp, packed[0].filename), staged);
    renameSync(staged, join(vendor, 'craft-foundry.tgz'));
    console.log(`Prepared craft-foundry ${pin.version} from ${pin.commit}\n${packed[0].integrity}\nNext: pnpm install --frozen-lockfile --ignore-scripts`);
  } finally {
    if (temp) rmSync(temp, { recursive: true, force: true });
    rmSync(lock, { force: true });
  }
}
try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
