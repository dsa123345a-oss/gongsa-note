import {upgradeEstLibraryMetadata} from './est-metadata.js';

// An unreadable historical archive must not prevent opening the user's work.
// Keep every registered library in order; only the verified metadata is added.
export async function upgradeRegisteredLibraryMetadata(libraries,upgrade=upgradeEstLibraryMetadata){
 let changed=false;const next=[],warnings=[];
 for(const library of libraries){
  try{
   const result=await upgrade(library);
   next.push(result.library);changed||=result.changed;
   if(result.status==='partial'||result.status==='unreadable-original')warnings.push({name:library.name,status:result.status,reason:result.reason||'일부 원본 비고를 읽지 못했습니다.'});
  }catch(error){next.push(library);warnings.push({name:library.name,status:'unreadable-original',reason:error.message});}
 }
 return {libraries:changed?next:libraries,changed,warnings};
}
