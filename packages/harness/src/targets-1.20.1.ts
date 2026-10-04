import type { RuntimeConfig, TargetConfig } from 'craft-foundry/core/types';

/** Only these two additional targets are supported; never infer a loader/version combination. */
export function target1201(id: string, config: TargetConfig) {
  const expected = id === 'forge-1.20.1' ? { loader: 'forge' as const, version: '47.3.0', viewer: 'jei' }
    : id === 'fabric-1.20.1' ? { loader: 'fabric' as const, version: '0.16.14', viewer: 'emi' } : undefined;
  if (!expected || config.minecraft !== '1.20.1' || config.loader !== expected.loader || config.loaderVersion !== expected.version)
    throw new Error(`Unsupported or mismatched 1.20.1 target: ${id}`);
  return { ...expected, minecraft: '1.20.1', helper: `mct-helper-${id}`, fixture: 'fixtures/datapack-1.20.1' };
}
export function server1201(id: string, config: TargetConfig): RuntimeConfig {
  const target = target1201(id, config);
  const properties = ['-Xmx2G', '-Dcraftatlas.testWriteDelayMillis=2000', '-Dcraftatlas.testRuntimeFixture=true', '-Dcraftatlas.resourceDirectories=machines'];
  return {
    kind: 'server', capabilities: ['dedicated-server'],
    ...(target.loader === 'forge' ? { setup: { executable: '{java:game}', args: ['-jar', `{tool:forge-server-1.20.1}`, '--installServer', '.'] } } : {}),
    command: { executable: '{java:game}', args: [...properties, ...(target.loader === 'forge'
      ? [`@libraries/net/minecraftforge/forge/1.20.1-${target.version}/{os}_args.txt`, 'nogui']
      : ['-jar', '{tool:fabric-server-1.20.1}', 'nogui'])] },
    readyPattern: 'Done \\(.*\\)! For help',
  };
}
