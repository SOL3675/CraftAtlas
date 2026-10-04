import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync, realpathSync } from 'node:fs';
import { resolve, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { loadConfig } from 'craft-foundry/core/config';
import { resolveTool } from 'craft-foundry/core/cache';
import { validateMcPilotInstallation } from 'craft-foundry/core/tools';
import { OwnedServer } from 'craft-foundry/adapters/runtime/server';
import { McPilotRuntimeAdapter } from 'craft-foundry/adapters/runtime/mc-pilot';
import { normalize } from '../../core/src/normalize.ts';
import { readSnapshot } from '../../core/src/snapshot.ts';
import { validateSnapshot } from '../../core/src/validate.ts';
import { bytesHash, hash } from '../../core/src/hash.ts';
import { verifyCommonFixture } from './fabric-common.ts';
import { server1201, target1201 } from './targets-1.20.1.ts';
import { verify1201, verify1201Viewer } from './fixture-1.20.1.ts';
import { runArtifacts, saveResults, waitFor, RequiredUnsupported } from './common.ts';
import type { Case } from './common.ts';

const root = resolve(fileURLToPath(new URL('../../../', import.meta.url))), session = resolve(process.argv[2]), runRoot = resolve(process.argv[3]), target = process.argv[4];
const cases: Case[] = [];
const loaded = await loadConfig(root), artifacts = runArtifacts(runRoot, target), version = loaded.config.targets[target].loaderVersion!;
const metadata = target1201(target, loaded.config.targets[target]), ids = ['atlas.integrated', `atlas.${metadata.viewer}`, 'atlas.client-stopped'];
const controller = new AbortController(); process.once('SIGTERM', () => controller.abort()); process.once('SIGINT', () => controller.abort());
const preparation = new OwnedServer(loaded, target, server1201(target, loaded.config.targets[target]), join(session, 'world-preparation'), join(session, 'world-preparation-logs'));
let adapter: McPilotRuntimeAdapter | undefined, clientDir: string | undefined, stage = ids[0], worldStopped = false;
const evidence: Record<string, unknown> = { schemaVersion: 1, artifacts, toolLockHash: bytesHash(readFileSync(join(root, 'harness.lock.json'))), targetMetadata: metadata };
function owned(path: string) {
  const result = realpathSync(path), rel = relative(realpathSync(session), result);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Client launch data escapes its fresh session');
  return result;
}
async function freePort() {
  const reservation = createServer(); await new Promise<void>((accept, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', accept); });
  const address = reservation.address(); if (!address || typeof address === 'string') throw new Error('No client port');
  const port = address.port; await new Promise<void>(accept => reservation.close(() => accept())); return port;
}
try {
  process.stderr.write('Atlas client: generating a fresh fixed world\n');
  await preparation.prepare(artifacts, runRoot, controller.signal);
  mkdirSync(join(preparation.directory, 'world/datapacks'), { recursive: true });
  cpSync(join(root, 'fixtures/datapack-1.20.1'), join(preparation.directory, 'world/datapacks/atlas'), { recursive: true });
  cpSync(join(root, 'fixtures/scripts'), join(preparation.directory, 'scripts'), { recursive: true });
  writeFileSync(join(preparation.directory, 'server.properties'), readFileSync(join(preparation.directory, 'server.properties'),'utf8').replace('level-type=minecraft:flat','level-type=minecraft:normal'));
  await preparation.start(controller.signal); await preparation.waitReady();
  const stopped = await preparation.stop(); assert.equal(stopped?.exitCode, 0); worldStopped = true;
  const helperId = metadata.helper, helper = await resolveTool(loaded, helperId, controller.signal);
  const backendRoot = loaded.local.backends?.['mc-pilot']; if (!backendRoot) throw new Error('mc-pilot backend is not configured');
  evidence.backend = await validateMcPilotInstallation(backendRoot, loaded.lock.tools['mc-pilot']);
  const role = loaded.config.targets[target].java?.game, javaHome = role ? loaded.local.java?.[role] : undefined;
  if (!javaHome) throw new Error('Explicit client Java home is required');
  adapter = new McPilotRuntimeAdapter({ backendRoot, runDir: join(session, 'client'), clientName: 'atlas-client', minecraft: metadata.minecraft, loader: metadata.loader, loaderVersion: version,
    downloadConcurrency: 4, assetCache: loaded.local.assetCaches?.[metadata.minecraft], java: join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'),
    wsPort: await freePort(), account: 'AtlasHarness', signal: controller.signal, requestTimeoutMs: 300000, sessionTimeoutMs: 900000, stopTimeoutMs: 20000,
    helperArtifact: { path: helper, sha256: loaded.lock.tools[helperId].sha256 } });
  process.stderr.write('Atlas client: installing verified helper and recorded pack\n');
  const client = await adapter.create(); clientDir = client.minecraftDir; evidence.client = client;
  for (const artifact of artifacts.filter(a => ['distribution', 'runtime-dependency'].includes(a.kind) && ['both', 'client'].includes(a.side))) await adapter.deployMod(resolve(runRoot, artifact.path), artifact.sha256);
  mkdirSync(join(clientDir, 'saves'), { recursive: true });
  cpSync(join(preparation.directory, 'world'), join(clientDir, 'saves/atlas-world'), { recursive: true });
  cpSync(join(root, 'fixtures/scripts'), join(clientDir, 'scripts'), { recursive: true });
  // Modify only newly installed session metadata; installed backend bytes remain verified.
  const runtimeRoot = owned(String(client.runtimeRootDir)), versionId = String(client.runtimeVersionId);
  if (!/^[a-zA-Z0-9_.+-]+$/.test(versionId)) throw new Error('Unexpected runtime version ID');
  const versionPath = owned(join(runtimeRoot, 'versions', versionId, versionId + '.json'));
  const original = readFileSync(versionPath), launchMetadata = JSON.parse(original.toString());
  launchMetadata.arguments ??= {}; launchMetadata.arguments.game ??= [];
  launchMetadata.arguments.jvm ??= []; launchMetadata.arguments.jvm.push('-Dcraftatlas.testRuntimeFixture=true', '-Dcraftatlas.resourceDirectories=machines');
  launchMetadata.arguments.game.push('--quickPlaySingleplayer', 'atlas-world');
  writeFileSync(versionPath, JSON.stringify(launchMetadata)); evidence.quickPlay = { path: relative(session, versionPath), originalHash: bytesHash(original), modifiedHash: bytesHash(readFileSync(versionPath)), world: 'atlas-world' };
  process.stderr.write('Atlas client: launching integrated world\n');
  const log = join(clientDir, 'logs/latest.log');
  evidence.launch = await adapter.launch(); await adapter.waitReady(240000, false);
  // This freshly generated, owned world may carry experimental datapack settings.
  // Read the actual screen and record its warning before accepting only this known load dialog.
  const current = await waitFor('Fresh world load dialog or integrated server',async () => await adapter!.control('gui.info') as any,
    screen => screen.title === 'Worlds using Experimental Settings are not supported' || /CRAFTATLAS READY/.test(readFileSync(log,'utf8')),180000);
  if (current.title === 'Worlds using Experimental Settings are not supported' && current.category === 'screen') {
    // The helper can expose the backing screen while the startup overlay still covers it.
    // Re-read this exact screen and retry only its load button until the actual screen changes.
    await waitFor('Experimental settings dialog accepted',async () => {
      const screen = await adapter!.control('gui.info') as any;
      if (screen.title === current.title && screen.category === 'screen') {
        evidence.experimentalWarning = { screen,screenshot:await adapter!.screenshot('experimental-world-warning.png') };
        await adapter!.control('input.click',{x:Math.round(screen.width / 2 + 80),y:Math.round(screen.height / 2 + (metadata.loader === 'forge' ? 35 : 17)),button:'left'});
        return false;
      }
      return true;
    },Boolean,180000);
  }
  await adapter.waitReady(240000, true);
  await waitFor('Viewer runtime completion', () => readFileSync(log, 'utf8'), text => new RegExp(`CRAFTATLAS ${metadata.viewer.toUpperCase()} READY session=[a-f0-9-]+ generation=\\d+`).test(text), 180000);
  await adapter.control('chat.command', { command: 'craftatlas-client dump integrated' });
  const path = join(clientDir, 'craftatlas/integrated');
  await waitFor('Fresh integrated snapshot', () => existsSync(join(path, 'completion.json')), Boolean, 180000);
  const snapshot = readSnapshot(path), model = normalize(snapshot);
  assert.equal(snapshot.mode, 'integrated'); assert.ok(snapshot.recipes.length > 100);
  if (snapshot.completion.status !== 'complete') throw new RequiredUnsupported('Required integrated collection is incomplete: ' + snapshot.completion.errors.join('; '));
  const environment = snapshot.environment as Record<string, any>;
  assert.ok(Object.keys(environment.datapackResources).length > 100);
  assert.ok(environment.datapackResources['atlas:recipes/added.json']);
  await adapter.control('chat.command', { command: 'craftatlas-client dump repeat' });
  const repeatPath = join(clientDir, 'craftatlas/repeat');
  await waitFor('Repeated integrated snapshot', () => existsSync(join(repeatPath, 'completion.json')), Boolean, 180000);
  const repeat = readSnapshot(repeatPath);
  if (repeat.completion.status !== 'complete') throw new RequiredUnsupported('Required repeated integrated collection is incomplete: ' + repeat.completion.errors.join('; '));
  assert.equal(hash(repeat.environment), hash(snapshot.environment));
  assert.equal(normalize(repeat).contentHash, model.contentHash);
  writeFileSync(join(session,'common-fixture.json'),JSON.stringify(verifyCommonFixture(snapshot,root),null,2));
  writeFileSync(join(session,'version-fixture.json'),JSON.stringify(verify1201(snapshot),null,2));
  cases.push({ id: stage, status: 'passed', message: `Integrated runtime collected ${snapshot.recipes.length} recipes; session ${snapshot.session}` });
  stage = `atlas.${metadata.viewer}`;
  assert.ok(snapshot.viewer && snapshot.viewer.recipes.length > 100);
  assert.equal(snapshot.viewer.kind,metadata.viewer);
  if (snapshot.viewer.coverage.some(c => c.status !== 'complete')) throw new RequiredUnsupported('Required viewer capture is incomplete; failed entries and raw evidence are retained');
  assert.equal(snapshot.viewer.session, snapshot.session); assert.equal(snapshot.viewer.generation, snapshot.generation);
  writeFileSync(join(session, 'viewer-fixture.json'), JSON.stringify(verify1201Viewer(snapshot), null, 2));
  assert.ok(snapshot.viewer.recipes.some(r => r.recipeId && snapshot.recipes.some(s => s.id === r.recipeId)));
  assert.ok(snapshot.viewer.recipes.some(r => r.category === 'minecraft:smelting' && r.equipment.includes('minecraft:furnace')));

  assert.ok(model.evidence.some(e => e.kind === 'viewer'));
  assert.throws(() => validateSnapshot({ ...snapshot, viewer: { ...snapshot.viewer, generation: snapshot.generation - 1 } }), /generation|identity|session/i);
  evidence.snapshot = { path: relative(session, path), id: snapshot.id, semanticHash: model.contentHash, viewerRecipes: snapshot.viewer.recipes.length };
  writeFileSync(join(session, 'integrated-model.json'), JSON.stringify(model));
  evidence.screenshot = await adapter.screenshot('atlas-integrated.png');
  cases.push({ id: stage, status: 'passed', message: `${metadata.viewer.toUpperCase()} captured ${snapshot.viewer.recipes.length} entries with matching generation; machine equipment and stale-token rejection verified` });
} catch (error) {
  process.stderr.write(String(error) + '\n'); cases.push({ id: stage, status: error instanceof RequiredUnsupported ? 'unsupported' : error instanceof assert.AssertionError ? 'failed' : 'infrastructure-error', message: String(error) });
} finally {
  if (!worldStopped) { try { await preparation.stop(); } catch (error) { evidence.preparationStopError = String(error); } }
  try {
    const stopped = await adapter?.stop(); evidence.clientStop = stopped;
    cases.push({ id: 'atlas.client-stopped', status: !adapter ? 'skipped' : stopped?.exitCode === 0 ? 'passed' : 'infrastructure-error', message: adapter ? `Owned broker stopped: ${stopped?.exitCode}` : 'No client process launched' });
  } catch (error) { cases.push({ id: 'atlas.client-stopped', status: 'infrastructure-error', message: String(error) }); }
  for (const id of ids) if (!cases.some(c => c.id === id)) cases.push({ id, status: 'skipped', message: 'Prerequisite did not complete' });
  if (clientDir && existsSync(join(clientDir, 'logs/latest.log'))) evidence.clientLog = { path: relative(session, join(clientDir, 'logs/latest.log')), sha256: bytesHash(readFileSync(join(clientDir, 'logs/latest.log'))) };
  evidence.casesHash = hash(cases); writeFileSync(join(session, 'evidence.json'), JSON.stringify(evidence, null, 2)); saveResults(session, cases);
}
