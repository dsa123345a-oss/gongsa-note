import {norm,unitNorm} from './calc.js';
import {rateIdentity,resolveRateLibrary} from './project-data.js';
import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {editableAssembly} from './est-edit.js';
import {machineryRate} from './work-core.js';
import {aggregateCalculation,manualCalculation} from './calculation-modes.js';
import {withEstMetadata,copyMissingEstMetadata} from './est-metadata.js';
import {estResourcePolicy} from './est-resource-policy.js';

export const evidenceSheetNames=['일위단가표','기계경비단가산출표','자재단가표','노임단가표'];
const category=r=>(r.category!=='내역단가'&&r.category)||({HeadTitleDat:'일위대가',CostTitleDat:'단가산출',MachTitleDat:'장비',StuffcDat:'자재',LaborcDat:'노임'})[r.table]||(/^D/.test(r.code||'')?'단가산출':/^U/.test(r.code||'')?'일위대가':/^E/.test(r.code||'')?'장비':/^L/.test(r.code||'')?'노임':/^M/.test(r.code||'')?'자재':r.components?'일위대가':r.labor&&!r.material&&!r.expense?'노임':r.material&&!r.labor&&!r.expense?'자재':'일위대가');
const same=(a,b)=>norm(a.name)===norm(b.name)&&norm(a.spec)===norm(b.spec)&&unitNorm(a.unit)===unitNorm(b.unit);
export function collectPriceEvidence(project,libraries=[]){
 const nodes=[],seen=new Map(),lineNodes=new Map(),warnings=[],saved=project.evidence||[],metadataIndexes=new WeakMap();
 const savedByIdentity=new Map();for(const entry of saved){const key=rateIdentity(entry.rate);if(!savedByIdentity.has(key))savedByIdentity.set(key,entry);}
 function walk(input,usage,parentLib=null,stack=[]){
  const identity=rateIdentity(input),key=JSON.stringify([identity,input.library,input.machineInputs,input.sourceComponent]);if(stack.includes(key)||stack.length>=30){warnings.push(usage+' · 순환/깊은 구성은 원본 확인 필요');return null;}
  if(seen.has(key)){const node=seen.get(key);node.uses.add(usage);return node;}
  if(nodes.length+seen.size>10000)throw Error('단가 근거가 너무 많습니다. 공사를 나누어 출력하세요.');
  const rate=structuredClone(copyMissingEstMetadata(withEstMetadata(input,libraries,metadataIndexes),savedByIdentity.get(identity)?.rate)),lib=resolveRateLibrary(rate,libraries)||libraries.find(l=>l.name===rate.source)||parentLib;
  for(const k of costKeys){rate[k]=Number(rate[k]??0);if(!Number.isFinite(rate[k]))throw Error((rate.name||'단가')+'의 금액을 확인하세요.');}rate.total=costKeys.reduce((n,k)=>n+rate[k],0);
  const kind=rate.machineInputs?'장비':category(rate),sheet=kind==='장비'?1:kind==='자재'?2:kind==='노임'?3:0;
  const prefix=sheet===1?'MachMainDat':kind==='단가산출'||/^D/.test(rate.code||'')?'CostMainDat':'HeadMainDat';
  const savedRows=savedByIdentity.get(identity)?.rows;
  const raw=savedRows?.length?savedRows:lib?.details?.find(([k])=>k===prefix+':'+rate.code)?.[1]||[];
  const node={id:'P'+(seen.size+1),rate,kind,sheet,uses:new Set([usage]),raw,children:new Map(),issues:[]};seen.set(key,node);
  let editable=rate;
  if(sheet<2&&!rate.components&&!rate.machineInputs&&raw.length){try{editable=editableAssembly(rate,raw,lib?.items||[]);}catch(e){node.issues.push(e.message);}}
  if(editable.components){
   try{
    node.calculation=editable.calculation||{};node.calc=calculateAssemblyDetailed(editable.components,node.calculation);
    node.parts=editable.components;
    const projected=k=>rate.sourceComponent&&rate.sourceComponent!==k?0:node.calc.result[k];
    if(!costKeys.every(k=>Math.abs(projected(k)-(rate[k]||0))<0.00001))throw Error('구성 합계와 현재 적용 단가가 다름');
    node.verified=true;
   }catch(e){node.issues.push(e.message);node.verified=false;}
  }else if(rate.machineInputs){try{node.machine=machineryRate(rate.machineInputs);node.verified=costKeys.every(k=>node.machine[k]===(rate[k]||0));if(!node.verified)node.issues.push('장비 입력값과 현재 단가가 다름');}catch(e){node.issues.push(e.message);}}
  for(const [i,part] of (node.parts||[]).entries()){
   if(part.kind||part.machineOwnership)continue;
   const policy=estResourcePolicy(part,raw,rate);
   if(policy&&['separate','note','fixed-installation'].includes(policy.kind))continue;
   if(!aggregateCalculation(part)||(!manualCalculation(part)&&Number(node.calc?.rows[i]?.qty??part.qty)===0))continue;
   // A machine may be referenced separately for labor/material/expense. Only
   // follow resources contributing to the component actually used by this row.
   if(rate.sourceComponent&&node.calc?.rows[i]?.amount&&!node.calc.rows[i].amount[rate.sourceComponent])continue;
   const candidates=(lib?.items||[]).filter(r=>r.code===part.code&&r.table!=='EstMainDat');
   const original=candidates.find(r=>same(r,part))||(candidates.length===1&&norm(part.name)==='주연료'?candidates[0]:null);
   const child={...(original?{category:original.category,table:original.table}:{}),...part,source:part.priceReference?.source||part.source||rate.source,library:part.library||rate.library,total:costKeys.reduce((n,k)=>n+Number(part[k]||0),0)};
   // A saved project may be reopened without its source DB. Recover type only
   // from the exact applied snapshot, never from a reused code or name alone.
   const snapshot=savedByIdentity.get(rateIdentity(child))?.rate;if(snapshot){child.category||=snapshot.category;child.table||=snapshot.table;}
   if(!child.components&&!original&&!child.category&&!child.priceReference&&!/^L|^M|^E/.test(child.code||''))continue;
   const next=walk(child,node.id+' '+rate.name,lib,[...stack,key]);if(next)node.children.set(i,next);
  }
  if(sheet<2&&!node.verified&&!rate.manual&&!rate.machineInputs)node.issues.push(raw.length?'원본 저장 근거 표시 · 적용 단가 직접 입력':'구성 근거 없음 · 적용 단가 직접 입력');
  for(const issue of rate.resourcePricing?.warnings||[])node.issues.push((issue.resource?.name||'')+' '+issue.reason+(issue.kind==='fallback-reference'?' · 추가 DB 노임 적용':issue.retained===false?' · 미확정 · 기준가격 확인 필요':' · 기존 단가 유지'));
  if(node.issues.length)warnings.push(node.id+' '+rate.name+' · '+node.issues.join(' / '));
  nodes.push(node);return node;
 }
 for(const line of project.lines){if(line.level||!aggregateCalculation(line)||line.surcharge||line.deduction||!line.rate||line.status!=='confirmed'||line.rate.resourcePricing?.ready===false||(!manualCalculation(line)&&line.qty!=null&&Number(line.qty)===0))continue;const node=walk(line.rate,(line.group||'')+' / '+line.name+' ['+line.id+']');if(node)lineNodes.set(line.id,node);}
 return {nodes,lineNodes,warnings};
}
