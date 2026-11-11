export interface DetailState { tilesLoaded:boolean; cameraMoving:boolean; focusMoving:boolean }
export function detailReadiness(subscribe:(check:()=>void)=>()=>void,state:()=>DetailState,reveal:()=>void) {
  let waiting=true,disposed=false;
  function check() {
    if(disposed||!waiting)return;
    const current=state();
    if(!current.tilesLoaded||current.cameraMoving||current.focusMoving)return;
    waiting=false;reveal();
  }
  const remove=subscribe(check);
  return {
    wait(){if(!disposed)waiting=true;},
    check,
    dispose(){if(disposed)return;disposed=true;remove();},
  };
}
