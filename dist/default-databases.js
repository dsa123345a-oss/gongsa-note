import {mergeLibrary} from './library-search.js';
// Only the two databases explicitly included in this release are installed.
// A stored empty list is intentional; upgrades must not repopulate or replace it.
export async function loadDefaultDatabases(existing,runtime,importer,fetcher=fetch){
 if(existing.length||!runtime?.seedNeeded)return existing;
 let next=[];
 for(const entry of runtime.seedManifest||[]){
  const response=await fetcher('./seed/'+encodeURIComponent(entry.name));if(!response.ok)throw Error('기본 DB를 읽지 못했습니다: '+entry.name);
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength!==entry.bytes)throw Error('기본 DB 크기를 확인하세요: '+entry.name);
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(digest!==entry.sha256)throw Error('기본 DB 검증에 실패했습니다: '+entry.name);
  const library=await importer(bytes,entry.name);
  library.bundledDefault=entry.role;
  if(entry.role==='resource')library.priceUpdateReference=true;
  next=mergeLibrary(next,library);
 }
 if(!next.length)throw Error('배포본에 기본 DB가 없습니다. 압축 파일 전체를 다시 풀어주세요.');
 return next;
}
