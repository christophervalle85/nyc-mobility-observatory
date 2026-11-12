export interface WarmEligibility {configured:boolean;visible:boolean;live:boolean;pending:boolean}
/** Preparation only imports local code. Scene construction remains the caller's responsibility. */
export function engineLoader<T>(importModule:()=>Promise<T>){
  let module:Promise<T>|undefined,failed=false;
  function load(){
    if(!module){
      try{module=Promise.resolve(importModule());}catch(error){module=Promise.reject(error);}
      void module.catch(()=>{failed=true;});
    }
    return module;
  }
  return{
    load,
    warm(eligible:WarmEligibility){if(eligible.configured&&eligible.visible&&eligible.live&&eligible.pending)void load();},
    retry(){if(failed){module=undefined;failed=false;}},
  };
}
