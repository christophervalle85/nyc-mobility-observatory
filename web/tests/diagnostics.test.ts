import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDiagnostics} from '../src/diagnostics.ts';
import type {DiagnosticDependencies,DiagnosticEntry} from '../src/diagnostics.ts';
function fixture(){
 let now=0,next=0,clockCalls=0,observations=0,disconnects=0;
 const timers=new Map<number,()=>void>(),entries:DiagnosticEntry[]=[];
 let longTask:(duration:number)=>void=()=>{};
 const dependencies:DiagnosticDependencies={
  now(){clockCalls++;return now;},
  setTimer(callback){const id=++next;timers.set(id,callback);return id;},
  clearTimer(id){timers.delete(id as number);},
  observeLongTasks(record){observations++;longTask=record;return()=>{disconnects++;};},
  emit(entry){entries.push(entry);},
 };
 return{dependencies,entries,timers,advance(value:number){now+=value;},flush(){const pending=[...timers.values()];timers.clear();for(const callback of pending)callback();},task(duration:number){longTask(duration);},counts(){return{clockCalls,observations,disconnects};}};
}
test('disabled diagnostics never reads clock, starts timers/observers or attaches render listeners',()=>{
 const f=fixture(),diagnostics=createDiagnostics(false,f.dependencies);let attached=0;
 diagnostics.span('geography.fetch')();diagnostics.event('tiles.rootReady');diagnostics.interaction();
 diagnostics.watchFrames(()=>{attached++;return()=>{};});diagnostics.nextFrame(()=>{attached++;return()=>{};});diagnostics.dispose();
 assert.equal(attached,0);assert.equal(f.counts().clockCalls,0);assert.equal(f.counts().observations,0);assert.equal(f.timers.size,0);assert.deepEqual(f.entries,[]);
});
test('one-off output has fixed labels and finite timing fields only, including after startup window ends',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);
 const end=diagnostics.span('geography.fetch');f.advance(12);end();
 diagnostics.event('provider-token-url' as never);f.flush();f.advance(20);diagnostics.event('tiles.rootReady');
 const timings=f.entries.filter(entry=>entry.kind==='timing');
 assert.deepEqual(timings,[{kind:'timing',label:'geography.fetch',milliseconds:12},{kind:'timing',label:'tiles.rootReady',milliseconds:32}]);
 for(const entry of timings)assert.deepEqual(Object.keys(entry).sort(),['kind','label','milliseconds']);
 diagnostics.dispose();
});
test('one-off records and sample windows have finite document caps',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);
 for(let i=0;i<100;i++)diagnostics.event('tiles.rootReady');
 for(let i=0;i<30;i++){diagnostics.interaction();f.flush();}
 assert.equal(f.entries.filter(entry=>entry.kind==='timing').length,64);
 assert.equal(f.entries.filter(entry=>entry.kind==='window').length,20);
 assert.equal(f.timers.size,0);diagnostics.dispose();
});
test('frame/long-task sampling is capped, window-bounded and never requests a render',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);let before=()=>{},after=()=>{},removed=0;
 diagnostics.watchFrames((start,end)=>{before=start;after=end;return()=>{removed++;};});
 for(let i=0;i<200;i++){before();f.advance(2);after();f.task(60);}
 f.flush();assert.equal(removed,1);assert.equal(f.counts().disconnects,1);
 const window=f.entries.find(entry=>entry.kind==='window');assert.ok(window&&window.kind==='window');
 assert.equal(window.frames,120);assert.equal(window.longTasks,120);assert.equal(window.renderCpuMeanMs,2);assert.equal(window.longTaskMs,7200);
 const count=f.entries.length;before();after();f.task(80);assert.equal(f.entries.length,count);
 diagnostics.dispose();
});
test('next actual frame is measured once and pending listeners are removed at window expiry/disposal',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);let frame=()=>{},removed=0;
 diagnostics.nextFrame(callback=>{frame=callback;return()=>{removed++;};});f.advance(25);frame();frame();
 assert.equal(removed,1);assert.equal(f.entries.filter(entry=>entry.kind==='timing'&&entry.label==='selection.nextFrame').length,1);
 diagnostics.nextFrame(callback=>{frame=callback;return()=>{removed++;};});f.flush();assert.equal(removed,2);
 diagnostics.interaction();const end=diagnostics.span('scene.construct');diagnostics.nextFrame(()=>()=>{removed++;});diagnostics.dispose();
 const count=f.entries.length;end();frame();assert.equal(f.entries.length,count);assert.equal(f.timers.size,0);assert.equal(removed,3);
});
test('invalid and overflowing numeric samples cannot enter diagnostic output',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);
 f.task(NaN);f.task(Infinity);f.task(-1);f.task(Number.MAX_VALUE);f.task(Number.MAX_VALUE);f.advance(Number.MAX_VALUE);diagnostics.event('tiles.rootReady');f.flush();
 for(const entry of f.entries)for(const value of Object.values(entry))if(typeof value==='number')assert.equal(Number.isFinite(value),true);
 diagnostics.dispose();
});
test('detail wait and explicit focus spans remain measurable after the interaction sampling window',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);
 diagnostics.interaction();
 const detail=diagnostics.span('detail.wait'),focus=diagnostics.span('focus.duration');
 f.advance(2200);f.flush();detail();focus();
 assert.deepEqual(f.entries.filter(entry=>entry.kind==='timing'),[
  {kind:'timing',label:'detail.wait',milliseconds:2200},
  {kind:'timing',label:'focus.duration',milliseconds:2200},
 ]);
 const abandoned=diagnostics.span('detail.wait');diagnostics.dispose();const count=f.entries.length;abandoned();assert.equal(f.entries.length,count);
});
test('optional local land phases use the same fixed-label numeric timing contract',()=>{
 const f=fixture(),diagnostics=createDiagnostics(true,f.dependencies);
 for(const label of ['land.fetch','land.json','land.validate'] as const){const end=diagnostics.span(label);f.advance(3);end();}
 assert.deepEqual(f.entries.filter(entry=>entry.kind==='timing').map(entry=>[entry.label,entry.milliseconds]),[['land.fetch',3],['land.json',3],['land.validate',3]]);
 diagnostics.dispose();
});
