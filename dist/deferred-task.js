// Coalesce expensive presentation work; the caller updates its model immediately.
// Flush before saving, switching tasks or undoing. IME composition keeps its caret.
export function createDeferredTask(run,delay=300){
 let timer=null,pending=false,paused=false;
 const clear=()=>{if(timer!==null)clearTimeout(timer);timer=null;};
 const flush=()=>{clear();if(!pending)return;pending=false;run();};
 const schedule=()=>{pending=true;clear();if(!paused)timer=setTimeout(flush,delay);};
 return {schedule,flush,pause(){paused=true;clear();},resume(){paused=false;if(pending)schedule();},get pending(){return pending;}};
}
