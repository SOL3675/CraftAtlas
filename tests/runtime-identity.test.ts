import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './helpers.ts';
import {readSnapshot,writeSnapshot,captureIdentityContractVersion} from '../packages/core/src/snapshot.ts';
import {normalize} from '../packages/core/src/normalize.ts';
import {hash,bytesHash} from '../packages/core/src/hash.ts';
import {validateSnapshot} from '../packages/core/src/validate.ts';
const identity = () => {const loadedJars=[{name:'collector.jar',sha256:bytesHash('runtime distribution')}];return {schemaVersion:1,status:'complete',launchNonce:'11111111-1111-1111-1111-111111111111',requestId:'fresh',session:'test-session',generation:0,inputs:{'mods/collector.jar':bytesHash('runtime distribution')},loadedJars,startupJarsHash:hash(loadedJars),startupConfigurationHash:hash({}),startupPropertiesHash:hash({'mod.option':'actual'}),jvmProperties:{'mod.option':'actual'},errors:[]};};
test('runtime identity contract preserves optional legacy inputs and raw measurements through directory/model boundaries',()=>{
  assert.equal(captureIdentityContractVersion,1);assert.ok(validateSnapshot(fixture()));
  const root=mkdtempSync(join(tmpdir(),'atlas identity '));
  try {const value=fixture();value.runtimeIdentity=identity();writeSnapshot(join(root,'dump'),value);
    const read=readSnapshot(join(root,'dump'));assert.deepEqual(read.runtimeIdentity,value.runtimeIdentity);
    assert.deepEqual(normalize(read).runtimeIdentity,value.runtimeIdentity);
    const manifest=JSON.parse(readFileSync(join(root,'dump/manifest.json'),'utf8'));manifest.metadata.runtimeIdentity.requestId='relabeled';
    writeFileSync(join(root,'dump/manifest.json'),JSON.stringify(manifest));assert.throws(()=>readSnapshot(join(root,'dump')),/tampered/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('boot/request/generation remain provenance; JAR/config/declared JVM bytes affect semantic model identity',()=>{
 const baseline=fixture();baseline.runtimeIdentity=identity();const model=normalize(baseline);
 const fresh=structuredClone(baseline);Object.assign(fresh.runtimeIdentity as any,{launchNonce:'new-boot',requestId:'next',session:'next-session',generation:2});fresh.session='next-session';fresh.generation=2;
 assert.equal(normalize(fresh).contentHash,model.contentHash);
 for (const field of ['inputs','loadedJars','jvmProperties']) {const changed=structuredClone(baseline);(changed.runtimeIdentity as any)[field]=field==='loadedJars'?[{name:'changed.jar',sha256:bytesHash('changed')}]:field==='inputs'?{'config/mod.json':bytesHash('changed')}:{'mod.option':'changed'};if(field==='loadedJars')(changed.runtimeIdentity as any).startupJarsHash=hash((changed.runtimeIdentity as any).loadedJars);if(field==='inputs')(changed.runtimeIdentity as any).startupConfigurationHash=hash((changed.runtimeIdentity as any).inputs);if(field==='jvmProperties')(changed.runtimeIdentity as any).startupPropertiesHash=hash((changed.runtimeIdentity as any).jvmProperties);assert.notEqual(normalize(changed).contentHash,model.contentHash);}
});
test('missing, malformed and unknown-version runtime measurements cannot be schema-valid complete identity',()=>{
 const value=fixture();value.runtimeIdentity={schemaVersion:2};assert.throws(()=>validateSnapshot(value),/runtimeIdentity/);
 value.runtimeIdentity={...identity(),loadedJars:[{name:'collector.jar',sha256:'wrong'}]};assert.throws(()=>validateSnapshot(value),/runtimeIdentity/);
 value.runtimeIdentity={...identity(),inputs:{'config/mod.json':bytesHash('post boot')}};assert.throws(()=>validateSnapshot(value),/configuration\/JVM identity changed/);
 value.runtimeIdentity={...identity(),jvmProperties:{'mod.option':'post boot'}};assert.throws(()=>validateSnapshot(value),/configuration\/JVM identity changed/);
 value.runtimeIdentity={...identity(),status:'unsupported',launchNonce:null,startupJarsHash:null,errors:['No launcher-issued capture identity']};assert.equal((validateSnapshot(value).runtimeIdentity as any).status,'unsupported');
});
test('all four collector integrations measure loaded origins at server startup and publish identity under snapshot checksums',()=>{
 for (const path of ['mods/collector/src/main/java/dev/craftatlas/Collector.java','mods/collector-fabric/src/main/java/dev/craftatlas/fabric/Collector.java','mods/collector-1.20.1-common/src/main/java/dev/craftatlas/Collector.java']) {
   const source=readFileSync(new URL('../'+path,import.meta.url),'utf8');assert.match(source,/new RuntimeIdentity/);assert.match(source,/identity.isArmed\(\)/);assert.match(source,/snapshot.add\("runtimeIdentity"/);assert.match(source,/identity.capture\(requestId, session, generation\)/);
 }
 for (const loader of ['collector-fabric-1.20.1','collector-forge-1.20.1','collector-fabric']) assert.match(readFileSync(new URL('../mods/'+loader+'/build.gradle',import.meta.url),'utf8'),/RuntimeIdentity.java/);
});
