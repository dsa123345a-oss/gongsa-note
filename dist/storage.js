function encode(key,value){
 if(value instanceof ArrayBuffer||ArrayBuffer.isView(value)){
  const bytes=value instanceof ArrayBuffer?new Uint8Array(value):new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return {$binary:btoa(binary),$type:value instanceof ArrayBuffer?'ArrayBuffer':'Uint8Array'};
 }return value;
}
function decode(key,value){if(value&&typeof value.$binary==='string'&&['ArrayBuffer','Uint8Array'].includes(value.$type)){const bytes=Uint8Array.from(atob(value.$binary),c=>c.charCodeAt(0));return value.$type==='ArrayBuffer'?bytes.buffer:bytes;}return value;}
export async function createStorage(){
 let runtime=null;const config=await fetch('./desktop.json');if(config.ok)runtime=await config.json();else if(config.status!==404)throw Error('저장 위치를 확인하지 못했습니다.');
 if(runtime?.desktop){let tail=Promise.resolve(),revision=runtime.saveRevision||0;
  const priceCommand=(action,value)=>{const data=JSON.stringify({revision:++revision,value},encode);const job=tail.catch(()=>{}).then(async()=>{const r=await fetch('./api/prices/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:data});if(!r.ok){const error=await r.json().catch(()=>({}));throw Error(error.error||'단가 업데이트를 저장하지 못했습니다.');}});tail=job;return job;};
  return {runtime,
  async get(key){const r=await fetch('./api/data/'+key);if(!r.ok)throw Error('작업 자료를 읽지 못했습니다.');return JSON.parse(await r.text(),decode);},
  put(key,value){const data=JSON.stringify({revision:++revision,value},encode);const job=tail.catch(()=>{}).then(async()=>{const r=await fetch('./api/data/'+key,{method:'POST',headers:{'Content-Type':'application/json'},body:data});if(!r.ok){const failure=await r.json().catch(()=>({}));throw Error(failure.error||'자료를 저장하지 못했습니다.');}});tail=job;return job;},
  applyPriceUpdate(project,libraries){return priceCommand('apply',{project,libraries});},
  restorePriceUpdate(){return priceCommand('restore',{});},
  settled(){return tail;}
 };}
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('gongsa-note-v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('data');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const priceTransaction=(project,libraries,restore)=>new Promise((resolve,reject)=>{const tx=db.transaction('data','readwrite'),store=tx.objectStore('data');let failure;
  const abort=message=>{failure=Error(message);tx.abort();};
  if(restore){const request=store.get('priceUpdateBackup');request.onsuccess=()=>{const backup=request.result;if(!backup)return abort('복원할 단가 업데이트가 없습니다.');store.put(backup.project,'project');store.put(backup.libraries,'libraries');store.delete('priceUpdateBackup');};}
  else {const p=store.get('project'),l=store.get('libraries');l.onsuccess=()=>{if(!p.result||!Array.isArray(l.result))return abort('업데이트 전 자료를 먼저 저장하세요.');store.put({project:p.result,libraries:l.result},'priceUpdateBackup');store.put(project,'project');store.put(libraries,'libraries');};}
  tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(failure||tx.error||Error('단가 업데이트가 취소되었습니다.'));
 });
 return {runtime:null,get(key){return new Promise((res,rej)=>{const r=db.transaction('data').objectStore('data').get(key);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});},put(key,value){return new Promise((res,rej)=>{const t=db.transaction('data','readwrite');t.objectStore('data').put(value,key);t.oncomplete=res;t.onerror=()=>rej(t.error);});},applyPriceUpdate(project,libraries){return priceTransaction(project,libraries,false);},restorePriceUpdate(){return priceTransaction(null,null,true);}};
}
