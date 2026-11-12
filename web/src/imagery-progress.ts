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
export function startupStatus(phase: Phase, stage: ImageryStage, mock: boolean): string | undefined {
  if (mock || (phase !== 'loading' && phase !== 'ready')) return undefined;
  if (stage === 'waiting-first-frame') return 'Opening city imagery…';
  if (stage === 'refining') return 'City visible. Refining detail…';
  if (phase === 'loading') return 'City visible. Preparing area controls…';
  return undefined;
}
