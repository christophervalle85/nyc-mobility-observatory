import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startupGate} from '../src/startup-gate.ts';
function fixture(overrides:Partial<{configured:boolean;visible:boolean;enabled:boolean}>={}) {let starts=0;const gate=startupGate({configured:true,visible:true,enabled:true,...overrides,start(){starts++}});return{gate,get starts(){return starts}};}
test('geography readiness consumes exactly one automatic start before invoking the loader',()=>{
 const f=fixture();assert.equal(f.starts,0);assert.equal(f.gate.pending,true);f.gate.ready();f.gate.ready();f.gate.visibility(false);f.gate.visibility(true);assert.equal(f.starts,1);assert.equal(f.gate.pending,false);
});
test('initially hidden document waits for first visible readiness and never visibility-restarts',()=>{
 const f=fixture({visible:false});f.gate.ready();assert.equal(f.starts,0);f.gate.visibility(false);f.gate.visibility(true);assert.equal(f.starts,1);f.gate.visibility(false);f.gate.visibility(true);assert.equal(f.starts,1);
});
for(const ending of ['stop','pagehide'] as const)test(`${ending} cancels startup before delayed geography or visibility callbacks`,()=>{
 const f=fixture({visible:false});f.gate.stop();f.gate.ready();f.gate.visibility(true);assert.equal(f.starts,0);assert.equal(f.gate.pending,false);
});
test('missing configuration/verification exclusion cannot auto-create a live scene',()=>{
 for(const override of [{configured:false},{enabled:false}]){const f=fixture(override);f.gate.ready();f.gate.visibility(true);assert.equal(f.starts,0);assert.equal(f.gate.pending,false);}
});
test('loader failure cannot yield another automatic attempt',()=>{
 let starts=0;const gate=startupGate({configured:true,visible:true,enabled:true,start(){starts++;throw new Error('safe fixture failure')}});gate.ready();gate.ready();gate.visibility(true);assert.equal(starts,1);
});
test('automatic startup shares Stop/drain/two-attempt locks with deliberate Resume',async()=>{
 const{SessionController}=await import('../src/session.ts');let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve});let created=0;
 const controller=new SessionController(true,()=>{created++;return{load:()=>pending,whenSettled:()=>pending,select(){},focus:async()=>false,cancelFocus(){},dispose(){}}},()=>{});
 let result:Promise<void>|undefined;const gate=startupGate({configured:true,visible:true,enabled:true,start(){result=controller.load()}});
 gate.ready();await Promise.resolve();assert.equal(created,1);gate.stop();controller.stop();await result;
 gate.ready();gate.visibility(false);gate.visibility(true);await controller.load();assert.equal(created,1);
 finish();await new Promise<void>(resolve=>setImmediate(resolve));await controller.load();assert.equal(created,2);
 controller.stop();await controller.load();assert.equal(created,2);assert.equal(controller.state.attempts,2);
});
