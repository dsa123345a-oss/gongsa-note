import {importEst} from './est.js';

export const estMetadataVersion=1;
const itemFields=['quotePages','remark','bigo'];
const rawFields=['Bigo','Bigo_','Remark',...Array.from({length:6},(_,i)=>'Page'+(i+1))];
const rawMeta=new Set(rawFields);
const sameText=(a,b)=>String(a??'').trim()===String(b??'').trim();
const itemMatches=(a,b)=>['code','name','spec','unit'].every(k=>sameText(a[k],b[k]))&&(!a.table||a.table===b.table)&&(!Number.isInteger(a.record)||a.record===b.record)&&['labor','material','expense','other'].every(k=>Number(a[k]||0)===Number(b[k]||0))&&(a.total==null||a.total===b.total);
const copyMissing=(old,fresh,fields)=>{let out=old;for(const key of fields)if(!Object.hasOwn(old,key)&&Object.hasOwn(fresh||{},key)){if(out===old)out={...old};out[key]=structuredClone(fresh[key]);}return out;};
export const copyMissingEstMetadata=(rate,snapshot)=>copyMissing(rate,snapshot,itemFields);
// Every pre-existing non-metadata field must agree with the original archive.
// This also protects independently edited rows and re-used record numbers.
const mergeRaw=(old,fresh)=>fresh&&Object.keys(old).filter(k=>!rawMeta.has(k)).every(k=>old[k]===fresh[k])?copyMissing(old,fresh,rawFields):old;
const mapRaw=(old,fresh)=>{const byRecord=new Map((fresh||[]).map(r=>[r._record,r]));return old.map(r=>mergeRaw(r,byRecord.get(r._record)));};

// A portable work file intentionally omits the original archive. Reopening an
// older copy must not replace a verified registered archive with that omission.
export function restoreEstProjectLibrary(library,libraries=[]){
 const source=libraries.find(l=>l.id===library.id&&l.name===library.name);
 let next=library;
 if(source){
  const items=new Map((source.items||[]).map(r=>[r.table+':'+r.record,r])),tables=new Map((source.tables||[]).map(t=>[t.name.toLowerCase(),t])),details=new Map(source.details||[]);
  const merge=old=>{const fresh=items.get(old.table+':'+old.record);return fresh&&itemMatches(old,fresh)?copyMissing(old,fresh,itemFields):old;};
  next={...library,items:(library.items||[]).map(merge),tables:(library.tables||[]).map(t=>({...t,rows:mapRaw(t.rows||[],tables.get(t.name.toLowerCase())?.rows)})),details:(library.details||[]).map(([key,rows])=>[key,mapRaw(rows,details.get(key))])};
  if(library.projectRows)next.projectRows=library.projectRows.map(merge);
  if(source.originalBytes instanceof ArrayBuffer||ArrayBuffer.isView(source.originalBytes))next.originalBytes=source.originalBytes;
  if(source.estMetadataVersion)next.estMetadataVersion=Math.max(library.estMetadataVersion||0,source.estMetadataVersion);
 }
 const {originalBytes,...portable}=next;return {library:next,portable};
}

export async function upgradeEstLibraryMetadata(library,inflate){
 if(library.estMetadataVersion>=estMetadataVersion)return {library,changed:false,status:'current'};
 if(!(library.originalBytes instanceof ArrayBuffer)&&!ArrayBuffer.isView(library.originalBytes))return {library,changed:false,status:'missing-original'};
 let fresh;try{fresh=await importEst(library.originalBytes,library.name,inflate);}catch(e){return {library,changed:false,status:'unreadable-original',reason:e.message};}
 const itemIndex=new Map(fresh.items.map(r=>[r.table+':'+r.record,r])),tables=new Map(fresh.tables.map(t=>[t.name.toLowerCase(),t])),details=new Map(fresh.details);
 const mergeItem=old=>{const r=itemIndex.get(old.table+':'+old.record);return r&&itemMatches(old,r)?copyMissing(old,r,itemFields):old;};
 const items=(library.items||[]).map(mergeItem),projectRows=(library.projectRows||[]).map(mergeItem);
 const next={...library,items,projectRows,tables:(library.tables||[]).map(t=>{const freshTable=tables.get(t.name.toLowerCase());return freshTable&&!freshTable.error?{...t,rows:mapRaw(t.rows||[],freshTable.rows),...(freshTable.memoWarnings?{memoWarnings:freshTable.memoWarnings}:{})}:t;}),details:(library.details||[]).map(([key,rows])=>[key,mapRaw(rows,details.get(key))]),estMetadataVersion};
 const warnings=fresh.tables.flatMap(t=>(t.memoWarnings||[]).map(w=>({table:t.name,...w})));
 return {library:next,changed:true,status:warnings.length?'partial':'upgraded',items:items.filter((r,i)=>r!==library.items[i]).length,warnings};
}

// Missing metadata can be filled only from the same source and exact applied
// amounts. Existing values, including deliberately empty notes, always win.
function matchingEstItem(rate,libraries,indexes){
 if(!rate||rate.manual)return null;
 const lib=libraries.find(l=>l.id===rate.library&&l.name===rate.source);if(!lib)return null;
 if(!indexes.has(lib)){const index=new Map();for(const item of lib.items||[]){const rows=index.get(item.code)||[];rows.push(item);index.set(item.code,rows);}indexes.set(lib,index);}
 const matches=(indexes.get(lib).get(rate.code)||[]).filter(r=>itemMatches(rate,r));
 return matches.length===1?matches[0]:null;
}
export function withEstMetadata(rate,libraries=[],indexes=new WeakMap()){
 if(!rate||rate.manual)return rate;
 const match=matchingEstItem(rate,libraries,indexes);return match?copyMissing(rate,match,itemFields):rate;
}

export function hydrateEstProjectMetadata(project,libraries=[]){
 const libs=project.estLibrary?[...libraries,project.estLibrary]:libraries;
 let changed=false;const indexes=new WeakMap();
 const prefixOf=r=>r?.table==='MachTitleDat'||r?.originalCategory==='장비'?'MachMainDat':r?.table==='CostTitleDat'||/^D/.test(r?.code||'')?'CostMainDat':'HeadMainDat';
 const sameIdentity=(a,b)=>['source','library','code','name','spec','unit','table','record'].every(k=>a?.[k]===b?.[k]);
 function rawRows(input){
  const saved=(project.evidence||[]).filter(e=>sameIdentity(e.rate,input)&&itemMatches(input,e.rate));
  const lib=libs.find(l=>l.id===input.library&&l.name===input.source),original=lib?.details?.find(([k])=>k===prefixOf(input)+':'+input.code)?.[1]||[];
  return saved.length===1&&saved[0].rows?.length?mapRaw(saved[0].rows,original):original;
 }
 function rowMemo(part,rows){
  if(part.manual||Object.hasOwn(part,'rowBigo')||!Number.isInteger(part.originalRecord))return part;
  const matches=rows.filter(r=>r._record===part.originalRecord&&sameText(r.Code,part.code)&&(!r.Name||sameText(r.Name,part.name))&&(!r.Size||sameText(r.Size,part.spec))&&(!r.Unite||sameText(r.Unite,part.unit)));
  return matches.length===1&&typeof matches[0].Bigo==='string'?{...part,rowBigo:matches[0].Bigo}:part;
 }
 function rate(input){
  if(!input)return input;let out=withEstMetadata(input,libs,indexes);if(out!==input)changed=true;
  const assign=(key,value)=>{if(value===out[key])return;if(out===input)out={...input};out[key]=value;changed=true;};
  if(input.components){const rows=input.manual?[]:rawRows(input),parts=input.components.map(p=>rate(rowMemo(p,rows)));if(parts.some((r,i)=>r!==input.components[i]))assign('components',parts);}
  if(input.priceReference)assign('priceReference',rate(input.priceReference));
  if(input.resourcePricing?.original){const original=rate(input.resourcePricing.original);if(original!==input.resourcePricing.original)assign('resourcePricing',{...input.resourcePricing,original});
   if(!input.manual&&!original.manual&&input.resourcePricing.ready===true&&sameIdentity(input,original)&&matchingEstItem(original,libs,indexes)){const supplemented=copyMissingEstMetadata(out,original);if(supplemented!==out){out=supplemented;changed=true;}}
  }
  if(input.evidenceBid?.original){const original=rate(input.evidenceBid.original);if(original!==input.evidenceBid.original)assign('evidenceBid',{...input.evidenceBid,original});}
  return out;
 }
 const lines=project.lines.map(l=>{const r=rate(l.rate),original=rate(l.originalExpenseRate);return r!==l.rate||original!==l.originalExpenseRate?{...l,rate:r,...(original?{originalExpenseRate:original}:{})}:l;});
 const evidence=(project.evidence||[]).map(entry=>{
  const r=rate(entry.rate),lib=libs.find(l=>l.id===r?.library&&l.name===r?.source);
  const prefix=r?.table==='MachTitleDat'?'MachMainDat':r?.table==='CostTitleDat'||/^D/.test(r?.code||'')?'CostMainDat':'HeadMainDat';
  const source=lib?.details?.find(([k])=>k===prefix+':'+r.code)?.[1],rows=mapRaw(entry.rows||[],source);
  if(r!==entry.rate||rows.some((row,i)=>row!==entry.rows[i])){changed=true;return {...entry,rate:r,rows};}return entry;
 });
 return {project:changed?{...project,lines,...(project.evidence?{evidence}:{})}:project,changed};
}
