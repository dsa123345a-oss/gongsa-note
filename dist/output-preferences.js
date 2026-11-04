export function createOutputPreferences(storage,onError=()=>{}){
 let value={},tail=Promise.resolve();const ready=storage.get('outputPreferences').then(v=>{if(v&&typeof v==='object')value=v;});
 return {async get(key){await ready;await tail;return structuredClone(value[key]);},set(key,next){const job=tail.catch(()=>{}).then(async()=>{await ready;value[key]=structuredClone(next);await storage.put('outputPreferences',value);});tail=job;job.catch(onError);return job;},settled(){return tail;}};
}
