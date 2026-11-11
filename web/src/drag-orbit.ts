export function dragOrbit(apply:(horizontal:number,vertical:number)=>void) {
  let previous:{x:number;y:number}|undefined,dragged=false;
  return {
    start(x:number,y:number){previous=Number.isFinite(x)&&Number.isFinite(y)?{x,y}:undefined;dragged=false;},
    move(x:number,y:number){
      if(!previous||!Number.isFinite(x)||!Number.isFinite(y))return false;
      const dx=x-previous.x,dy=y-previous.y;
      if(Math.abs(dx)+Math.abs(dy)<2)return false;
      const cap=(value:number)=>Math.max(-80,Math.min(80,value));
      apply(dx===0?0:-cap(dx)*.004,dy===0?0:-cap(dy)*.003);
      previous={x,y};dragged=true;return true;
    },
    end(){previous=undefined;},
    cancel(){previous=undefined;dragged=true;},
    consumeClick(){const result=dragged;dragged=false;return result;},
  };
}
