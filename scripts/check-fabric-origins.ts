import {execFileSync} from 'node:child_process';import {mkdirSync,mkdtempSync} from 'node:fs';import {resolve,join,delimiter} from 'node:path';
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--loader')throw new Error('Use --loader <inspected pinned fabric-loader.jar>');
const loader=resolve(args[1]);mkdirSync('.harness',{recursive:true});const output=mkdtempSync(resolve('.harness/fabric-origin-probe-'));
execFileSync('javac',['--release','17','-encoding','UTF-8','-classpath',loader,'-d',output,'mods/collector-fabric-common/src/main/java/dev/craftatlas/FabricJarOrigins.java','mods/collector-fabric-common/src/test/identity/FabricOriginsProbe.java'],{stdio:'inherit'});
process.stdout.write(execFileSync('java',['-classpath',[output,loader].join(delimiter),'dev.craftatlas.FabricOriginsProbe',join(output,'game')],{encoding:'utf8'}));
