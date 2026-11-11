import {test} from 'node:test';
import assert from 'node:assert/strict';
import {areaFocus} from '../src/area-focus.ts';
import type {CameraFocusPort} from '../src/area-focus.ts';
import type {ZoneCollection} from '../src/zones.ts';
const zones:ZoneCollection={type:'FeatureCollection',features:[{type:'Feature',id:1,properties:{location_id:1,zone:'Source area',borough:'Queens'},geometry:{type:'Polygon',coordinates:[[[-74,40.7],[-73.99,40.7],[-73.99,40.71],[-74,40.7]]]}}]};
function fixture(sync=false){
 const moves:Parameters<CameraFocusPort['move']>[]=[];let cancels=0;
 const focus=areaFocus(zones,{move(target,options){moves.push([target,options]);if(sync)options.complete()},cancel(){cancels++}});
 return {focus,moves,get cancels(){return cancels}};
}
test('focus is explicit, source-ID-only and ignores duplicates while moving',async()=>{
 const f=fixture();assert.equal(f.moves.length,0);assert.equal(await f.focus.focus(999,false),false);assert.equal(f.moves.length,0);
 const work=f.focus.focus(1,false);assert.equal(f.moves.length,1);assert.equal(f.moves[0][1].duration,1.2);
 assert.equal(await f.focus.focus(1,false),false);assert.equal(f.moves.length,1);f.moves[0][1].complete();assert.equal(await work,true);
});
test('reduced motion completes synchronously with an immediate camera operation',async()=>{
 const f=fixture(true);assert.equal(await f.focus.focus(1,true),true);assert.equal(f.moves[0][1].duration,0);
 assert.equal(await f.focus.focus(1,true),true);assert.equal(f.moves.length,2);
});
test('cancel/dispose resolve old movement and stale completion cannot complete a new focus',async()=>{
 const f=fixture();const old=f.focus.focus(1,false);const stale=f.moves[0]?.[1].complete;f.focus.cancel();assert.equal(await old,false);assert.equal(f.cancels,1);
 const next=f.focus.focus(1,false);stale?.();assert.equal(f.moves.length,2);f.focus.dispose();assert.equal(await next,false);
 assert.equal(await f.focus.focus(1,false),false);assert.equal(f.moves.length,2);
});


test('only the current focus callback is accepted, once, before an adapter commits arrival state',async()=>{
 const f=fixture();
 const first=f.focus.focus(1,false),firstCallbacks=f.moves[0][1];
 assert.equal(firstCallbacks.complete(),true);
 assert.equal(await first,true);
 assert.equal(firstCallbacks.complete(),false);
 assert.equal(firstCallbacks.cancel(),false);
 const second=f.focus.focus(1,false),secondCallbacks=f.moves[1][1];
 assert.equal(secondCallbacks.cancel(),true);
 assert.equal(await second,false);
 assert.equal(secondCallbacks.complete(),false);
 assert.equal(secondCallbacks.cancel(),false);
});

test('canceled and disposed callbacks cannot be accepted as a newer camera arrival',async()=>{
 const f=fixture();
 const old=f.focus.focus(1,false),stale=f.moves[0][1];
 f.focus.cancel();assert.equal(await old,false);
 const current=f.focus.focus(1,false),live=f.moves[1][1];
 assert.equal(stale.complete(),false);assert.equal(stale.cancel(),false);
 assert.equal(live.complete(),true);assert.equal(await current,true);
 const ending=f.focus.focus(1,false),disposed=f.moves[2][1];
 f.focus.dispose();assert.equal(await ending,false);
 assert.equal(disposed.complete(),false);assert.equal(disposed.cancel(),false);
});
