import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SessionController} from '../src/session.ts';
import type {SceneAdapter} from '../src/session.ts';
function fixture(){
 let loaded!:()=>void;let update!:(phase:'ready'|'partial')=>void;
 const loading=new Promise<void>(resolve=>{loaded=resolve});
 const finishes:((moved:boolean)=>void)[]=[];const moves:{id:number;reduced:boolean}[]=[];
 const calls={created:0,loads:0,selection:null as number|null,cancel:0,dispose:0};
 const adapter:SceneAdapter & {focus:(id:number,reduced:boolean)=>Promise<boolean>;cancelFocus:()=>void}={
  load(change){calls.loads++;update=change;return loading},whenSettled:()=>loading,
  select(id){calls.selection=id},dispose(){calls.dispose++},cancelFocus(){calls.cancel++},
  focus(id,reduced){moves.push({id,reduced});return new Promise(resolve=>finishes.push(resolve))},
 };
 const controller=new SessionController(true,()=>{calls.created++;return adapter},()=>{},1000,(id:number)=>[1,2].includes(id));
 return {controller,calls,moves,finishes,loaded,update:(phase:'ready'|'partial')=>update(phase)};
}
test('selection/restoration never loads or focuses and premature Focus is not queued after Load',async()=>{
 const f=fixture();f.controller.select(1);assert.equal(f.calls.created,0);assert.equal(await f.controller.focus(),false);
 const loading=f.controller.load();await Promise.resolve();assert.equal(await f.controller.focus(),false);
 f.loaded();await loading;await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(f.calls.loads,1);assert.equal(f.moves.length,0);assert.equal(f.calls.selection,1);
});
test('only explicit ready-scene Focus for a validated selected source ID can move the camera',async()=>{
 const f=fixture();const loading=f.controller.load();f.loaded();await loading;await new Promise<void>(resolve=>setImmediate(resolve));
 f.controller.select(999);assert.equal(await f.controller.focus(),false);assert.equal(f.moves.length,0);
 f.controller.select(1);const work=f.controller.focus(true);assert.deepEqual(f.moves,[{id:1,reduced:true}]);
 assert.equal(await f.controller.focus(),false);assert.equal(f.moves.length,1);
 f.finishes[0](true);assert.equal(await work,true);assert.equal(f.calls.loads,1);assert.equal(f.controller.state.attempts,1);
});
test('changed selection cancels obsolete focus and late completion cannot release a newer focus guard',async()=>{
 const f=fixture();const loading=f.controller.load();f.loaded();await loading;await new Promise<void>(resolve=>setImmediate(resolve));
 f.controller.select(1);const old=f.controller.focus();f.controller.select(2);assert.ok(f.calls.cancel>0);
 const next=f.controller.focus();assert.equal(f.moves.length,2);f.finishes[0](true);assert.equal(await old,false);
 assert.equal(await f.controller.focus(),false);assert.equal(f.moves.length,2);
 f.finishes[1](true);assert.equal(await next,true);
});
for(const ending of ['stop','partial'] as const)test(`${ending} cancels focus without loading or spending retry`,async()=>{
 const f=fixture();const loading=f.controller.load();f.loaded();await loading;await new Promise<void>(resolve=>setImmediate(resolve));
 f.controller.select(1);const work=f.controller.focus();if(ending==='stop')f.controller.stop();else f.update('partial');
 assert.ok(f.calls.cancel>0);assert.equal(await f.controller.focus(),false);f.finishes[0](true);assert.equal(await work,false);
 assert.equal(f.calls.loads,1);assert.equal(f.controller.state.attempts,1);
});
