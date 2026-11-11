import { test } from 'node:test';
import assert from 'node:assert/strict';
import { managedAdapter } from '../src/managed-adapter.ts';
import type { OwnedResource, SceneRuntime } from '../src/managed-adapter.ts';
function setup() {
 let finish!: (resource: OwnedResource) => void;
 const calls = { open:0,destroy:0,late:0,attach:0,remove:0 };
 const pending = new Promise<OwnedResource>(resolve => { finish=resolve; });
 const scene: SceneRuntime = { tiles:()=>pending,zones:async()=>({destroy(){}}),attachTiles(){calls.attach++},attachZones(){},watchPartial(){return()=>{calls.remove++}},select(){},focus:async()=>false,cancelFocus(){},destroy(){calls.destroy++} };
 const adapter=managedAdapter(()=>{calls.open++;return scene});
 return {adapter,calls,finish:()=>finish({destroy(){calls.late++}})};
}
test('adapter does not open a scene before explicit load', () => { const f=setup();assert.equal(f.calls.open,0); });
test('late tiles are destroyed after unload instead of attached to dead viewer', async () => {
 const f=setup(); const work=f.adapter.load(()=>{}); await Promise.resolve(); f.adapter.dispose(); f.finish(); await work;
 assert.equal(f.calls.destroy,1); assert.equal(f.calls.attach,0); assert.equal(f.calls.late,1); assert.equal(f.calls.remove,1);
});
test('scene callbacks and destroy are cleaned once', async () => {
 const f=setup();const work=f.adapter.load(()=>{});f.finish();await work; f.adapter.dispose();f.adapter.dispose();
 assert.equal(f.calls.attach,1);assert.equal(f.calls.destroy,1);assert.equal(f.calls.remove,1);
});

test('a failed geometry sibling cannot permit retry while tile factory remains unresolved', async () => {
 const { SessionController } = await import('../src/session.ts');
 let finishTiles!: (value:OwnedResource) => void;
 let failZones!: (error:unknown) => void;
 const tiles = new Promise<OwnedResource>(resolve=>{finishTiles=resolve});
 const zones = new Promise<OwnedResource>((_resolve,reject)=>{failZones=reject});
 const calls = { open:0,destroy:0,late:0,attach:0 };
 const controller=new SessionController(true,()=>managedAdapter(()=>{
  calls.open++;
  return { tiles:()=>tiles,zones:()=>zones,attachTiles(){calls.attach++},attachZones(){},watchPartial(){return()=>{}},select(){},focus:async()=>false,cancelFocus(){},destroy(){calls.destroy++} };
 }),()=>{});
 const first=controller.load();await new Promise<void>(resolve=>setImmediate(resolve));
 failZones({statusCode:403});await first;
 assert.equal(controller.state.failure,'auth','error is reported before sibling settles');
 assert.equal(calls.destroy,1,'failed viewer is destroyed promptly');
 await controller.load();await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(calls.open,1,'unresolved sibling must keep the retry gate closed');
 finishTiles({destroy(){calls.late++}});await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(calls.late,1);assert.equal(calls.attach,0);
 await controller.load();assert.equal(calls.open,2,'retry is available after both branches settle');
});

for (const failing of ['tiles','zones'] as const) test(`${failing} synchronous failure retains the other factory drain`, async () => {
 const {SessionController}=await import('../src/session.ts');
 let finish!: (value:OwnedResource)=>void;
 const pending=new Promise<OwnedResource>(resolve=>{finish=resolve});
 const calls={open:0,late:0};
 const controller=new SessionController(true,()=>managedAdapter(()=>{
  calls.open++;
  const fail=()=>{throw {statusCode:429}};
  return {tiles:failing==='tiles'?fail:()=>pending,zones:failing==='zones'?fail:()=>pending,attachTiles(){},attachZones(){},watchPartial(){return()=>{}},select(){},focus:async()=>false,cancelFocus(){},destroy(){}};
 }),()=>{});
 await controller.load();
 assert.equal(controller.state.failure,'rate');assert.equal(controller.state.draining,true);
 await controller.load();assert.equal(calls.open,1);
 finish({destroy(){calls.late++}});await new Promise<void>(resolve=>setImmediate(resolve));
 assert.equal(calls.late,1);assert.equal(controller.state.draining,false);
 await controller.load();assert.equal(calls.open,2);
});

test('adapter focus never opens a scene and stays unavailable after partial load, including early partial callbacks',async()=>{
 let finish!: (resource:OwnedResource)=>void;let partial!:()=>void;let opens=0,moves=0;
 const pending=new Promise<OwnedResource>(resolve=>{finish=resolve});
 const adapter=managedAdapter(()=>{opens++;return {tiles:()=>pending,zones:async()=>({destroy(){}}),attachTiles(){},attachZones(){},watchPartial(change){partial=change;return()=>{}},select(){},destroy(){},focus:async()=>{moves++;return true},cancelFocus(){}}});
 assert.equal(await adapter.focus(1,false),false);assert.equal(opens,0);
 const work=adapter.load(()=>{});assert.equal(await adapter.focus(1,false),false);
 partial();finish({destroy(){}});await work;
 assert.equal(await adapter.focus(1,false),false);assert.equal(moves,0);adapter.dispose();
});
