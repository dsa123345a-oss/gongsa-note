import {norm,unitNorm} from './calc.js';
import {editableAssembly} from './est-edit.js';
import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {resolveRateLibrary,validateProject} from './project-data.js';
import {repriceMachineOwnership} from './machine-pricing.js';

const category=r=>(r.category&&r.category!=='내역단가'?r.category:null)||({L:'노임',M:'자재',E:'장비',U:'일위대가',D:'단가산출'}[r.code?.[0]]);
const identity=r=>JSON.stringify([r.source,r.code,norm(r.name),String(r.spec||'').normalize('NFKC').replace(/\s/g,''),unitNorm(r.unit)]);
const specKey=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/\s/g,'').replace(/[×＊]/g,'*').replace(/\((\d+종)\)/g,'$1');
const resourceUnit=u=>unitNorm(String(u||'').replace(/당$/,''));
const same=(a,b)=>norm(a.name)===norm(b.name)&&specKey(a.spec)===specKey(b.spec)&&resourceUnit(a.unit)===resourceUnit(b.unit);
export const isAssemblyPriceReference=lib=>lib?.bundledDefault==='assembly'||String(lib?.name||'').normalize('NFKC').replace(/\s/g,'').toLowerCase()==='상수도공사메인(26년)소형감압변수정.ebkx';
export function resourceLibrary(project,libraries){
 const s=project.resourcePriceLibrary;
 const monthly=libraries.filter(l=>/\d{4}-\d{2}-main\.estx$/i.test(l.name)).sort((a,b)=>b.name.localeCompare(a.name));
 return s?(libraries.find(l=>l.id===s.id)||libraries.find(l=>l.name===s.name)):(libraries.find(l=>l.priceUpdateReference)||monthly[0]||libraries.find(l=>l.isMain));
}
export function createResourcePricer(project,libraries,options={}){
 const master=resourceLibrary(project,libraries),cache=new Map(),indexes=new Map();
 const keepMissing=options.keepMissing??(project.resourceMissingPolicy==='keep'||master?.priceUpdateReference===true);
 // A wage fallback is allowed only after an actual, unique lookup in the
 // known additional DB. An unresolved old snapshot is never enough.
 const canRetain=issue=>issue.kind==='fallback-reference'||!!keepMissing&&issue.kind==='missing-reference'&&category(issue.resource||{})!=='노임';
 const originalRate=input=>{const r=structuredClone(options.useCurrent||input.components?input:(input.resourcePricing?.original||input));delete r.resourcePricing;return r;};
 function index(lib){if(!indexes.has(lib)){const map=new Map();for(const r of lib?.items||[]){if(r.table==='EstMainDat')continue;const k=r.code;map.set(k,[...(map.get(k)||[]),r]);}indexes.set(lib,map);}return indexes.get(lib);}
 const resources=(master?.items||[]).filter(r=>['노임','자재','장비'].includes(category(r))&&r.table!=='EstMainDat');
 const byName=new Map();for(const r of resources){const k=category(r)+'|'+norm(r.name);byName.set(k,[...(byName.get(k)||[]),r]);}
 const primaryMatches=r=>(byName.get(category(r)+'|'+norm(r.name))||[]).filter(x=>same(x,r));
 const additionalLabor=libraries.filter(l=>l!==master&&isAssemblyPriceReference(l)).flatMap(l=>(l.items||[]).filter(r=>category(r)==='노임'&&r.table!=='EstMainDat').map(r=>({...r,source:l.name,library:l.id})));
 // Some EST databases keep fuel prices only in the machinery evidence. Use a
 // fuel only if every matching evidence row agrees on its unit and price.
 const fuels=new Map();for(const [k,rows] of master?.details||[]){if(!k.startsWith('MachMainDat:'))continue;for(const r of rows){if(r.Index!==-2||norm(r.Name)!=='주연료'||!Number.isFinite(r.TU))continue;const key=norm(r.Size)+'|'+unitNorm(r.Unite),arr=fuels.get(key)||[];arr.push(r);fuels.set(key,arr);}}
 function match(r){
  const cat=category(r),override=project.resourceMappings?.[identity(r)];
  if(override?.master===master?.name){const picked=resources.filter(x=>x.code===override.code&&same(x,override)&&category(x)===cat&&resourceUnit(x.unit)===resourceUnit(r.unit));if(picked.length===1)return picked[0];}
  let found=primaryMatches(r);
  if(found.length>1){const exact=found.filter(x=>x.code===r.code);if(exact.length===1)found=exact;}
  if(found.length===1)return found[0];
  if(cat==='자재'&&norm(r.name)==='주연료'){
   const rows=fuels.get(norm(r.spec)+'|'+unitNorm(r.unit))||[],prices=new Set(rows.map(x=>x.TU));
   if(rows.length&&prices.size===1){const value=rows[0].TU;return {name:r.name,spec:r.spec,unit:r.unit,code:'FUEL:'+norm(r.spec),source:master.name,library:master.id,table:'MachMainDat',category:'자재',labor:0,material:value,expense:0,other:0,total:value,evidenceRecords:rows.map(x=>x._record)};}
  }
  return null;
 }
 function walk(input,lib,stack=[]){
  const r=structuredClone(input),cat=category(r),key=identity(r);
  if(stack.includes(key)||stack.length>16)throw Error('순환 참조 또는 너무 깊은 구성 근거');
  if(['노임','자재'].includes(cat)){
   let selected=match(r),source=master.name;const issues=[];
   // Multiple monthly matches are ambiguous, not absent: never bypass them
   // using an additional DB. Likewise, multiple fallback matches need review.
   if(!selected&&cat==='노임'&&primaryMatches(r).length===0){
    const fallback=additionalLabor.filter(x=>same(x,r));
    if(fallback.length===1){selected=fallback[0];source=selected.source;issues.push({key,resource:structuredClone(r),reference:structuredClone(selected),kind:'fallback-reference',reason:'기준 DB에 해당 노임이 없어 추가 DB에서 확인한 동일 직종 단가 적용 · '+source});}
   }
   if(!selected)return {rate:r,changes:[],issues:[{key,resource:structuredClone(r),kind:'missing-reference',reason:(cat==='노임'?'기준 DB 또는 추가 DB에서':'기준 DB에')+' 품명·규격·단위가 일치하는 '+cat+' 항목을 하나로 확인하지 못했습니다.'+(cat==='노임'?' 노임 확인 전 계산 보류':'')}]};
   return {rate:{...r,...Object.fromEntries([...costKeys,'total'].map(k=>[k,selected[k]])),priceReference:structuredClone(selected)},changes:[{name:r.name,spec:r.spec,category:cat,before:r.total,after:selected.total,source,code:selected.code}],issues};
  }
  if(!r.components&&!['일위대가','단가산출','장비'].includes(cat))return {rate:r,changes:[],issues:[]};
  let base=r,expenseOnly=false;
  // EST estimate rows may account the same assembly wholly as expenses.
  if(r.table==='EstMainDat'&&!r.components){
   const candidates=(index(lib).get(r.code)||[]).filter(x=>same(x,r));
   if(candidates.length!==1)throw Error('내역단가의 원본 산출 구성을 하나로 확인할 수 없습니다.');
   base=candidates[0];expenseOnly=r.expense===r.total&&r.labor===0&&r.material===0;
   if(!expenseOnly&&costKeys.some(k=>r[k]!==base[k]))throw Error('내역단가의 비목이 원본 산출 구성과 다릅니다.');
  }
  const machine=base.table==='MachTitleDat'||base.originalCategory==='장비'||category(base)==='장비';
  const prefix=machine?'MachMainDat':{일위대가:'HeadMainDat',단가산출:'CostMainDat'}[category(base)];
  const details=lib?.details?.find(([k])=>k===prefix+':'+base.code)?.[1];
  const next=editableAssembly(base,details,lib?.items||[]),changes=[],issues=[];
  if(machine){
   const resource={...base,category:'장비'},target=match(resource);
   if(!target)issues.push({key:identity(resource),resource,kind:'missing-reference',reason:'기준 DB에 품명·규격·단위가 일치하는 장비 없음'});
   else {const updated=repriceMachineOwnership(next,resource,details,target,master);changes.push(...updated.changes);issues.push(...updated.issues);}
  }
  for(const part of next.components){
   if(machine&&(part.machineOwnership||details?.find(r=>r._record===part.originalRecord)?.Index===-3))continue;
   if(part.kind||part.exclude||['horizontal','both'].includes(part.calculationMode))continue;
   if(part.calculationMode==='vertical'&&!next.components.some(p=>p.kind==='percent'&&!p.exclude&&!['vertical','both'].includes(p.calculationMode)))continue;
   const sourceCandidates=(index(lib).get(part.code)||[]);
   let child=part.components?{...sourceCandidates.find(x=>same(x,part)),...part}:sourceCandidates.find(x=>same(x,part));
   // EST machinery fuel labels are intentionally generic (주연료 / 경유).
   if(!child&&sourceCandidates.length===1&&norm(part.name)==='주연료'&&category(sourceCandidates[0])==='자재')child=sourceCandidates[0];
   if(!child)child={...part,category:part.labor?'노임':part.material?'자재':category(part),total:costKeys.reduce((s,k)=>s+(part[k]||0),0)};
   if(!child.category&&!part.components){continue;} // explicit expense / ownership / fee
   try{
    const result=walk(child,lib,[...stack,key]);changes.push(...result.changes);issues.push(...result.issues);
    for(const k of costKeys)part[k]=part.sourceComponent&&part.sourceComponent!==k?0:result.rate[k];
    part.total=costKeys.reduce((s,k)=>s+(part[k]||0),0);
    // Preserve the exact source snapshot even when an unmatched resource keeps
    // its original price. Reopening a saved project must not need a current DB
    // to reconstruct the survey pages or fixed-text remark for that price.
    for(const k of ['prices','quotePages','remark','bigo'])if(Object.hasOwn(result.rate,k))part[k]=structuredClone(result.rate[k]);
    if(result.rate.components){part.components=result.rate.components;part.calculation=result.rate.calculation;}
    if(result.rate.priceReference)part.priceReference=result.rate.priceReference;
   }catch(e){issues.push({key:identity(child),resource:child,reason:e.message});}
  }
  if(expenseOnly)next.calculation={...next.calculation,expenseOnly:true};
  Object.assign(next,calculateAssemblyDetailed(next.components,next.calculation||{}).result);
  return {rate:{...next,category:r.category,table:r.table,record:r.record,id:r.id,name:r.name,spec:r.spec,unit:r.unit},changes,issues};
 }
 return {master,resources,reprice(input){
  const selected=originalRate(input);
  // Direct material lines belong to the selected construction DB. Only the
  // resources INSIDE an assembly are priced from the monthly reference DB.
  if(category(selected)==='자재'&&!options.updateDirectMaterials){
   const rate=structuredClone(selected),changes=[],issues=[];
   rate.resourcePricing={master:master?.name||'',masterId:master?.id,ready:true,mode:'direct-material',selectedSource:selected.source,changes,issues,original:structuredClone(selected)};
   return {rate,changes,issues,ready:true,mode:'direct-material'};
  }
  if(isAssemblyPriceReference(master)){
   const issues=[{kind:'invalid-resource-reference',reason:'추가 상수도 DB는 산출 구성용입니다. 노임은 월별 기준 DB를 선택해야 합니다.'}],warnings=issues.map(i=>({...i,retained:false}));
   return {rate:{...structuredClone(input),resourcePricing:{ready:false,issues,warnings,changes:[],master:master.name,masterId:master.id,original:structuredClone(input.resourcePricing?.original||input)}},changes:[],issues,warnings,ready:false};
  }
  if(!master){const issues=[{reason:'노임·자재 기준 DB를 선택하거나 다시 등록하세요.'}];return {rate:{...structuredClone(input),resourcePricing:{ready:false,issues,changes:[],master:project.resourcePriceLibrary?.name||'',original:structuredClone(input.resourcePricing?.original||input)}},changes:[],issues,ready:false};}
  const key=JSON.stringify(input);if(cache.has(key))return structuredClone(cache.get(key));
  let result;
  try{
   const original=selected;
   const lib=resolveRateLibrary(original,libraries)||libraries.find(l=>l.name===original.source);
   result=walk(original,lib);
   result.issues=[...new Map(result.issues.map(i=>[(i.key||'')+i.reason,i])).values()];
   result.changes=[...new Map(result.changes.map(i=>[JSON.stringify(i),i])).values()];
   result.warnings=result.issues.map(i=>({...i,retained:canRetain(i)}));
   result.ready=result.issues.every(canRetain);
   result.rate.resourcePricing={master:master.name,masterId:master.id,ready:result.ready,changes:result.changes,issues:result.issues,warnings:result.warnings,missingPolicy:keepMissing?'keep':'strict',original:structuredClone(input.resourcePricing?.original||original)};
  }catch(e){result={rate:selected,changes:[],issues:[{kind:'calculation',reason:'산식 검증 불가 · 재계산 미확정: '+e.message}],ready:false,retainedWhole:true};result.warnings=result.issues.map(i=>({...i,retained:false}));result.rate.resourcePricing={master:master.name,masterId:master.id,ready:false,changes:[],issues:result.issues,warnings:result.warnings,missingPolicy:keepMissing?'keep':'strict',original:structuredClone(selected)};}
  cache.set(key,result);return structuredClone(result);
 }};
}
export function refreshProjectResources(project,libraries){
 const next=structuredClone(project),pricer=createResourcePricer(next,libraries),rows=[];
 for(const l of next.lines){if(l.level||l.surcharge||l.deduction||l.exclude||!l.rate)continue;
  if(l.rate.manual||l.rate.evidenceBid){rows.push({id:l.id,name:l.name,before:l.rate.total,after:l.rate.total,ready:false,issues:[{reason:'직접 단가 또는 근거 낙찰 적용 항목은 별도 검토가 필요합니다.'}]});continue;}
  const result=pricer.reprice(l.originalExpenseRate||l.rate),before=l.rate.total;
  if(l.originalExpenseRate){l.originalExpenseRate=result.rate;l.rate={...result.rate,labor:0,material:0,other:0,expense:result.rate.total,expenseOnly:true};}else l.rate=result.rate;
  l.status=result.ready?'confirmed':'proposed';
  rows.push({id:l.id,name:l.name,before,after:l.rate.total,...result,rate:undefined});
 }
 next.ratesReviewed=false;return {project:validateProject(next),rows,master:pricer.master};
}
export {identity as resourceIdentity};
