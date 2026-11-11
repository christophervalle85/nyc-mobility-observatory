import type {OverviewTarget} from './study-footprint.ts';
export interface StagePose {pivot:OverviewTarget;heading:number;pitch:number;range:number}
export interface StageCameraPort {lookAt(pose:StagePose):void;reset():void;range?(pivot:OverviewTarget):number}
export function stageNavigation(initial:OverviewTarget,camera:StageCameraPort){
 let pivot=initial,heading=Math.PI/12,pitch=-Math.PI*35/180,range=initial.range,disposed=false;
 const clamp=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));
 function apply(){if(disposed)return false;try{camera.lookAt({pivot,heading,pitch,range});return true;}catch{return false;}finally{try{camera.reset();}catch{/* Never retain a temporary local transform. */}}}
 function syncRange(){const current=camera.range?.(pivot);if(current!==undefined&&Number.isFinite(current))range=clamp(current,200,180000);}
 return{
  overview(target=initial){pivot=target;heading=Math.PI/12;pitch=-Math.PI*35/180;range=clamp(target.range,200,180000);return apply();},
  area(target:OverviewTarget){pivot=target;heading=0;pitch=-Math.PI/4;range=clamp(target.range,200,20000);},
  orbit(horizontal:number,vertical=0){if(disposed||!Number.isFinite(horizontal)||!Number.isFinite(vertical))return false;syncRange();heading=(heading+clamp(horizontal,-Math.PI/6,Math.PI/6))%(Math.PI*2);pitch=clamp(pitch+clamp(vertical,-Math.PI/12,Math.PI/12),-Math.PI*75/180,-Math.PI*20/180);return apply();},
  zoom(factor:number){if(disposed||!Number.isFinite(factor)||factor<=0)return false;syncRange();range=clamp(range*clamp(factor,.5,2),200,180000);return apply();},
  dispose(){disposed=true;},
 };
}
