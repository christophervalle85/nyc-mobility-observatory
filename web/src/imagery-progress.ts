import type {Phase} from './session.ts';
export type ImageryStage='waiting-first-frame'|'refining'|'settled';
/** Tile visibility is only evidence after its scene frame completes. */
export function imageryProgress(subscribeVisible:(callback:()=>void)=>()=>void,subscribeFrame:(callback:()=>void)=>()=>void,change:(stage:ImageryStage)=>void){
  let stage:ImageryStage='waiting-first-frame',disposed=false,seen=false,rendered=false,detailSettled=false;
  let removeVisible=()=>{},removeFrame=()=>{};
  function publish(next:ImageryStage){if(disposed||stage===next)return;stage=next;change(stage);}
  removeVisible=subscribeVisible(()=>{
    if(disposed||seen)return;seen=true;removeVisible();
    removeFrame=subscribeFrame(()=>{
      if(disposed||rendered)return;rendered=true;removeFrame();
      publish(detailSettled?'settled':'refining');
    });
  });
  return{
    get stage(){return stage;},
    wait(){if(disposed)return;detailSettled=false;if(rendered)publish('refining');},
    settled(){if(disposed)return;detailSettled=true;if(rendered)publish('settled');},
    dispose(){if(disposed)return;disposed=true;removeVisible();removeFrame();},
  };
}
export function startupPresentation(phase:Phase,stage:ImageryStage,mock:boolean,pending:boolean):{cue:boolean;status?:string}{
  if(mock||!['idle','loading','ready'].includes(phase))return{cue:false};
  if(phase==='idle')return{cue:pending};
  return stage==='waiting-first-frame'?{cue:true,status:'Opening city imagery…'}
    :stage==='refining'?{cue:false,status:'City visible. Refining detail…'}
    :{cue:false,status:phase==='ready'?'Drag to orbit · Scroll to zoom':'City visible. Preparing area controls…'};
}
