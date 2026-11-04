import {createResourcePricer,resourceIdentity,isAssemblyPriceReference} from './resource-pricing.js';
import {attachMachineBasis} from './est-edit.js';
import {validateProject,collectEvidence} from './project-data.js';
import {totals} from './calc.js';

const keys=['labor','material','expense','other','total'];
export function validatePriceReference(reference){
 if(!reference?.items?.length)throw Error('최신 단가 DB를 선택하세요.');
 if(isAssemblyPriceReference(reference))throw Error('산출 구성용 추가 DB는 노임 기준으로 사용할 수 없습니다. 최신 월별 DB를 선택하세요.');
 const priceTables=new Set(['stuffcdat.dat','laborcdat.dat','machtitledat.dat','machmaindat.dat','machgijundat.dat']);
 if(reference.tables?.some(t=>t.error&&priceTables.has(t.name.toLowerCase())))throw Error('단가 표를 읽지 못했습니다. 최신 DB 파일을 확인하세요.');
 if(!reference.items.some(i=>['자재','노임','장비'].includes(i.category)))throw Error('노임·자재·장비 기준 단가가 없는 DB입니다.');
}
function seal(rate){
 const result=structuredClone(rate),metadata=result.resourcePricing;delete result.resourcePricing;
 // Next month's missing item must keep THIS month's value, not the pre-update value.
 if(metadata)result.resourcePricing={...metadata,original:structuredClone(result)};
 return result;
}
export function planPriceUpdate(project,libraries,reference,targetIds){
 validatePriceReference(reference);
 const oldReference=libraries.find(l=>l.name===reference.name),master=attachMachineBasis({...structuredClone(reference),isMain:oldReference?.isMain||false,priceUpdateReference:true});
 const targets=new Set(targetIds),sourceLibraries=libraries.filter(l=>l.name!==master.name).map(l=>attachMachineBasis({...structuredClone(l),priceUpdateReference:false}));
 if(targets.has(master.id)||oldReference&&targets.has(oldReference.id))throw Error('기준 DB 자체는 업데이트 대상에서 제외하세요.');
 const nextProject=structuredClone(project);nextProject.resourcePriceLibrary={id:master.id,name:master.name};nextProject.resourceMissingPolicy='keep';
 // A same-name monthly replacement must still read old recipes from the old
 // library while taking its monetary inputs from the newly selected one.
 const oldSource=oldReference&&oldReference.id!==master.id?attachMachineBasis(structuredClone(oldReference)):null;
 const available=[...sourceLibraries,...(oldSource?[oldSource]:[]),master],pricer=createResourcePricer(nextProject,available,{keepMissing:true,useCurrent:true,updateDirectMaterials:true}),rows=[];
 function update(rate,scope,id){
  if(rate.manual||rate.evidenceBid){rows.push({scope,id,name:rate.name,spec:rate.spec,before:rate.total,after:rate.total,changed:false,warnings:[{reason:'직접 편집·근거 낙찰 단가 유지'}],changes:[]});return structuredClone(rate);}
  const result=pricer.reprice(rate);
  rows.push({scope,id,name:rate.name,spec:rate.spec,before:rate.total,after:result.rate.total,ready:result.ready,changed:keys.some(k=>rate[k]!==result.rate[k]),warnings:result.warnings||[],changes:result.changes});
  return seal(result.rate);
 }
 const nextLibraries=sourceLibraries.map(lib=>{
  if(!targets.has(lib.id))return lib;
  return {...lib,items:lib.items.map(r=>update(r,lib.name,r.id)),priceUpdate:{reference:master.name,at:new Date().toISOString(),missingPolicy:'keep'}};
 });
 nextLibraries.push(master);
 for(const line of nextProject.lines){
  if(line.level||line.surcharge||line.deduction||line.exclude||!line.rate)continue;
  const blockedByMissingPrice=line.rate.resourcePricing?.ready===false;
  const rate=update(line.originalExpenseRate||line.rate,'현재 내역',line.id);
  if(line.originalExpenseRate){line.originalExpenseRate=rate;line.rate={...rate,labor:0,material:0,other:0,expense:rate.total,expenseOnly:true};}else line.rate=rate;
  if(line.status==='proposed'&&blockedByMissingPrice&&line.rate.resourcePricing?.ready)line.status='confirmed';
  if(line.rate.resourcePricing?.ready===false)line.status='proposed';
 }
 nextProject.ratesReviewed=false;nextProject.evidence=collectEvidence(nextProject,nextLibraries);
 const warnings=[...new Map(rows.flatMap(row=>row.warnings.map(w=>[w.resource?resourceIdentity(w.resource)+'|'+w.reason:row.scope+'|'+row.id+'|'+w.reason,{...w,scope:row.scope,item:row.name}]))).values()];
 const summary={changed:rows.filter(r=>r.changed).length,unchanged:rows.filter(r=>!r.changed).length,retained:warnings.filter(w=>w.retained!==false).length,unverified:rows.filter(r=>r.ready===false).length,reference:master.name,at:new Date().toISOString()};
 nextProject.lastPriceUpdate=summary;
 nextProject.priceUpdateHistory=[...(project.priceUpdateHistory||[]),{...summary,previousReference:project.resourcePriceLibrary||null,beforeContract:totals(project.lines,project.charges).contract,afterContract:totals(nextProject.lines,nextProject.charges).contract}];
 return {project:validateProject(nextProject),libraries:nextLibraries,rows,warnings,summary,before:totals(project.lines,project.charges),after:totals(nextProject.lines,nextProject.charges)};
}
