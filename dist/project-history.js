// Session history contains project edits, not DB imports or files on disk.
export function createProjectHistory(initial,limit=30){
 let current=structuredClone(initial),past=[],future=[],lastKey='',lastTime=0;
 const stamp=p=>JSON.stringify(p);
 let currentStamp=stamp(current);
 return {
  get canUndo(){return past.length>0;},get canRedo(){return future.length>0;},
  record(next,key='',now=Date.now()){
   const nextStamp=stamp(next);if(nextStamp===currentStamp)return;
   if(!key||key!==lastKey||now-lastTime>900||!past.length)past.push(current);
   if(past.length>limit)past.shift();current=structuredClone(next);currentStamp=nextStamp;future=[];lastKey=key;lastTime=now;
  },
  undo(){if(!past.length)return null;future.push(current);current=past.pop();currentStamp=stamp(current);lastKey='';return structuredClone(current);},
  redo(){if(!future.length)return null;past.push(current);current=future.pop();currentStamp=stamp(current);lastKey='';return structuredClone(current);}
 };
}
