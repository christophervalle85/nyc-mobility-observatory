const labels = ['geography.fetch','geography.json','geography.validate','land.fetch','land.json','land.validate','cesium.import','scene.construct','viewer.construct','zones.convert','zones.index','footprint.prepare','tiles.rootReady','tiles.attached','tiles.firstFrame','tiles.detailSettled','scene.resourcesAttached','selection.handler','selection.pick','selection.options','selection.nextFrame','detail.wait','focus.duration'] as const;
export type DiagnosticLabel = typeof labels[number];
export type DiagnosticEntry = {kind:'timing';label:DiagnosticLabel;milliseconds:number} | {kind:'window';window:'startup'|'interaction';frames:number;renderCpuMeanMs:number;renderCpuMaxMs:number;renderGapMeanMs:number;longTasks:number;longTaskMs:number};
export interface DiagnosticDependencies {
 now():number;
 setTimer(callback:()=>void,delay:number):unknown;
 clearTimer(id:unknown):void;
 observeLongTasks?(record:(duration:number)=>void):()=>void;
 emit(entry:DiagnosticEntry):void;
}
export interface Diagnostics {
 readonly enabled:boolean;
 span(label:DiagnosticLabel):()=>void;
 event(label:DiagnosticLabel):void;
 interaction():void;
 watchFrames(subscribe:(before:()=>void,after:()=>void)=>()=>void):()=>void;
 nextFrame(subscribe:(after:()=>void)=>()=>void):void;
 dispose():void;
}
const noop=()=>{};
function browserDependencies():DiagnosticDependencies {
 return {
  now:()=>performance.now(),
  setTimer:(callback,delay)=>setTimeout(callback,delay),
  clearTimer:id=>clearTimeout(id as ReturnType<typeof setTimeout>),
  observeLongTasks:typeof PerformanceObserver!=='undefined'&&PerformanceObserver.supportedEntryTypes.includes('longtask') ? record=>{
   const observer=new PerformanceObserver(list=>{for(const entry of list.getEntries())record(entry.duration);});
   observer.observe({type:'longtask',buffered:false});return()=>observer.disconnect();
  }:undefined,
  emit:entry=>console.info('[NYC diagnostics]',JSON.stringify(entry)),
 };
}
interface SampleWindow {
 kind:'startup'|'interaction';frames:number;cpuSum:number;cpuMax:number;gapSum:number;gaps:number;longTasks:number;longTaskMs:number;
 timer?:unknown;disconnect?:()=>void;
}
interface FrameSource {subscribe:(before:()=>void,after:()=>void)=>()=>void;remove?:()=>void}
export function createDiagnostics(enabled:boolean,dependencies?:DiagnosticDependencies):Diagnostics {
 if(!enabled)return{enabled:false,span:()=>noop,event:noop,interaction:noop,watchFrames:()=>noop,nextFrame:noop,dispose:noop};
 const environment=dependencies??browserDependencies(),origin=environment.now();
 const allowed=new Set<string>(labels),sources=new Set<FrameSource>();
 let disposed=false,records=0,windows=0,current:SampleWindow|undefined,pendingFrame:(()=>void)|undefined;
 function emit(entry:DiagnosticEntry){try{environment.emit(entry);}catch{/* Diagnostics must not interrupt the scene. */}}
 function timing(label:DiagnosticLabel,milliseconds:number){
  if(disposed||records>=64||!allowed.has(label)||!Number.isFinite(milliseconds)||milliseconds<0)return;
  records++;emit({kind:'timing',label,milliseconds:Number(milliseconds.toFixed(2))});
 }
 function attach(source:FrameSource,window:SampleWindow){
  let started:number|undefined,previous:number|undefined;
  try{source.remove=source.subscribe(()=>{
   if(disposed||current!==window||window.frames>=120)return;
   started=environment.now();
  },()=>{
   if(disposed||current!==window||window.frames>=120||started===undefined)return;
   const ended=environment.now(),duration=ended-started;started=undefined;
   if(!Number.isFinite(duration)||duration<0||!Number.isFinite(window.cpuSum+duration))return;
   window.frames++;window.cpuSum+=duration;window.cpuMax=Math.max(window.cpuMax,duration);
   if(previous!==undefined){const gap=ended-previous;if(Number.isFinite(gap)&&gap>=0&&Number.isFinite(window.gapSum+gap)){window.gapSum+=gap;window.gaps++;}}
   previous=ended;
  });}catch{/* An unavailable sampler does not change application behavior. */}
 }
 function closeWindow(){
  const window=current;if(!window)return;current=undefined;
  environment.clearTimer(window.timer);window.disconnect?.();
  for(const source of sources){source.remove?.();source.remove=undefined;}
  pendingFrame?.();pendingFrame=undefined;
  emit({kind:'window',window:window.kind,frames:window.frames,renderCpuMeanMs:window.frames?window.cpuSum/window.frames:0,renderCpuMaxMs:window.cpuMax,renderGapMeanMs:window.gaps?window.gapSum/window.gaps:0,longTasks:window.longTasks,longTaskMs:window.longTaskMs});
 }
 function beginWindow(kind:'startup'|'interaction',duration:number){
  if(disposed)return;closeWindow();if(windows>=20)return;windows++;
  const window:SampleWindow={kind,frames:0,cpuSum:0,cpuMax:0,gapSum:0,gaps:0,longTasks:0,longTaskMs:0};current=window;
  try{window.disconnect=environment.observeLongTasks?.(duration=>{
   if(disposed||current!==window||window.longTasks>=120||!Number.isFinite(duration)||duration<0||!Number.isFinite(window.longTaskMs+duration))return;
   window.longTasks++;window.longTaskMs+=duration;
  });}catch{/* Long-task observation is optional. */}
  for(const source of sources)attach(source,window);
  window.timer=environment.setTimer(()=>{if(current===window)closeWindow();},duration);
 }
 beginWindow('startup',10000);
 return {
  enabled:true,
  span(label){
   if(disposed||records>=64||!allowed.has(label))return noop;
   const start=environment.now();let finished=false;
   return()=>{if(finished||disposed)return;finished=true;timing(label,environment.now()-start);};
  },
  event(label){if(!disposed&&records<64&&allowed.has(label))timing(label,environment.now()-origin);},
  interaction(){if(current?.kind!=='interaction')beginWindow('interaction',1500);},
  watchFrames(subscribe){
   if(disposed)return noop;
   const source:FrameSource={subscribe};sources.add(source);if(current)attach(source,current);
   return()=>{source.remove?.();source.remove=undefined;sources.delete(source);};
  },
  nextFrame(subscribe){
   if(disposed||!current||records>=64)return;
   pendingFrame?.();const window=current,start=environment.now();let finished=false;
   let remove=noop;
   const cancel=()=>{if(finished)return;finished=true;remove();};pendingFrame=cancel;
   try{remove=subscribe(()=>{
    if(finished||disposed||current!==window)return;cancel();pendingFrame=undefined;
    timing('selection.nextFrame',environment.now()-start);
   });}catch{cancel();pendingFrame=undefined;}
  },
  dispose(){if(disposed)return;closeWindow();disposed=true;sources.clear();},
 };
}
