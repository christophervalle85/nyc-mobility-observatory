import {test} from 'node:test';
import assert from 'node:assert/strict';
import {engineLoader} from '../src/engine-loader.ts';
const eligible={configured:true,visible:true,live:true,pending:true};
test('eligible warming and scene load share one local module import',async()=>{
 let calls=0,finish!:(value:string)=>void;
 const loader=engineLoader(()=>{calls++;return new Promise<string>(resolve=>{finish=resolve;});});
 loader.warm(eligible);loader.warm(eligible);assert.equal(calls,1);
 const loaded=loader.load();assert.equal(calls,1);finish('engine');assert.equal(await loaded,'engine');
 assert.equal(await loader.load(),'engine');assert.equal(calls,1);
});
test('hidden, unconfigured, mock/verification or consumed startup cannot warm',()=>{
 for(const key of ['configured','visible','live','pending'] as const){let calls=0;const loader=engineLoader(async()=>{calls++;return 'engine';});loader.warm({...eligible,[key]:false});assert.equal(calls,0);}
});
test('warm rejection is handled without automatic retries; explicit retry alone rearms import',async()=>{
 let calls=0;const error=new Error('local import failed');
 const loader=engineLoader(async()=>{if(++calls===1)throw error;return 'engine';});
 loader.warm(eligible);await new Promise<void>(resolve=>setImmediate(resolve));
 loader.warm(eligible);await assert.rejects(loader.load(),error);assert.equal(calls,1);
 loader.retry();assert.equal(calls,1);assert.equal(await loader.load(),'engine');assert.equal(calls,2);
});
test('Stop can consume entitlement while the unabortable warm import finishes without scene construction',async()=>{
 const {startupGate}=await import('../src/startup-gate.ts');let imports=0,scenes=0,finish!:()=>void;
 const loader=engineLoader(()=>{imports++;return new Promise<void>(resolve=>{finish=resolve;});});
 const gate=startupGate({configured:true,visible:true,enabled:true,start(){void loader.load().then(()=>{scenes++;});}});
 loader.warm({...eligible,pending:gate.pending});gate.stop();finish();await loader.load();gate.ready();loader.warm({...eligible,pending:gate.pending});
 assert.equal(imports,1);assert.equal(scenes,0);
});
