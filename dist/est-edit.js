import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {norm,unitNorm} from './calc.js';
import {evaluateFormula} from './formula.js';
import {costFromPrintedFormulas} from './est-cost-formulas.js';
import {verifiedEstComponentRow} from './est-resource-policy.js';
import {machineExchangeRate} from './machine-pricing.js';

const fields={labor:'NC',material:'GC',expense:'JC'};
const close=(a,b)=>Math.abs((a||0)-(b||0))<0.00001;
function projectHeadResource(part,details,sourceItems){
 if(part.sourceComponent||part.kind||part.components||part.calculationMode&&part.calculationMode!=='auto')return;
 const row=verifiedEstComponentRow(part,details),target={1:'material',2:'labor',3:'expense'}[row?.SCheck];
 if(!row||!target)return;
 const table={M:'StuffcDat',L:'LaborcDat'}[row.Code?.[0]],natural=table==='StuffcDat'?'material':'labor';
 if(!table)return;
 const raw={labor:row.NU||0,material:row.GU||0,expense:row.JU||0,other:row.SU||0};
 if(!(raw[target]>0)||!costKeys.every(k=>Number.isFinite(raw[k])&&(k===target||raw[k]===0)))return;
 const sources=sourceItems.filter(r=>r.code===row.Code&&r.table===table&&!r.components&&verifiedEstComponentRow({...r,originalRecord:row._record},[row]));
 if(sources.length!==1||!costKeys.every(k=>Number.isFinite(sources[0][k]||0)&&(k===natural||!(sources[0][k]||0))))return;
 const original=costKeys.every(k=>Number(part[k]||0)===raw[k]),ref=part.priceReference;
 const applied=ref&&ref.category===(natural==='material'?'자재':'노임')&&verifiedEstComponentRow({...ref,code:row.Code,originalRecord:row._record},[row])&&costKeys.every(k=>Number(part[k]||0)===Number(ref[k]||0));
 // Recover only the explicit allocation flag. Reading or printing saved
 // components must not change their amounts; repricing applies this target.
 if(original||applied)part.sourceComponent=target;
}
export function editableAssembly(item,details,sourceItems=[]){
 if(item.components){
  const next=structuredClone(item);
  if((item.table==='HeadTitleDat'||item.category==='일위대가')&&details?.some(r=>r.TitleCode&&r.Name))for(const part of next.components)projectHeadResource(part,details,sourceItems);
  return next;
 }
 if(!details?.length)throw Error('구성 근거가 없는 단가입니다. 직접 구성 항목을 작성하세요.');
 if(item.category==='장비'||item.table==='MachTitleDat')return editableMachine(item,details,sourceItems);
 if(!details.some(r=>r.TitleCode&&r.Name)){try{return editableCost(item,details,sourceItems);}catch{return costFromPrintedFormulas(item,details,sourceItems);}}
 const parts=[],original=[];
 for(const r of details){
  if(r.TitleCode)continue;
  if(!r.Name&&!r.Code&&!r.TC)continue;
  if(!r.GN&&!r.TC&&!r.Code)continue;
  if(r.ApplyNacChal||r.EscData||r.EscGN||r.Level||![0,5,6,103,104,105,58,62,68].includes(r.LinkIndex||0))throw Error('별도 산식·낙찰·소계 설정이 있어 자동 변환을 보류했습니다. 원본 근거를 확인하세요.');
  const p={name:r.Name||r.Code,spec:r.Size||'',unit:r.Unite||'',code:r.Code||'',source:item.source,library:item.library,section:String(r.SKind??0),sumTag:String(r.SKind??0),allowNegative:[r.NU,r.GU,r.JU,r.GN].some(n=>n<0),qty:r.GN??0,qtyExpression:String(r.GN??0),labor:r.NU||0,material:r.GU||0,expense:r.JU||0,other:0,originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),government:r.Gangub===2};
  if(r.LinkIndex===68){Object.assign(p,{kind:'percent',scope:'all',basis:'total',target:'components',percent:(r.GN??0)*100,replaceRunning:true});}
  else if(r.LinkIndex===58||r.LinkIndex===62){
   const basis={1:'material',2:'labor',3:'expense',0:'total'}[r.OCheck??0],target=(r.OCheck===0&&r.SCheck===0)?'components':{1:'material',2:'labor',3:'expense'}[r.SCheck];
   if(!basis||!target)throw Error('복합 비목 잡비는 아직 자동 변환하지 못합니다.');
   Object.assign(p,{kind:'percent',scope:r.LinkIndex===62?'tag':'all',basis,target,percent:r.GN});
  }else if(r.GN==null&&!r.TC&&!r.NC&&!r.GC&&!r.JC){p.qty=0;p.qtyExpression='0';}
  else if(!Number.isFinite(r.GN)||r.GN<0)throw Error('구성 수량을 확인할 수 없습니다.');
  projectHeadResource(p,details,sourceItems);
  parts.push(p);original.push(r);
 }
 if(!parts.length)throw Error('편집할 구성 항목이 없습니다.');
 // Accept a translation only when every component AND the parent reconcile.
 for(const digits of [1,0,2,3,4,5,6]){
  const calculation={outputQuantity:1,componentDigits:digits,variables:'',expenseOnly:false};
  const calc=calculateAssemblyDetailed(parts,calculation);
  if(!calc.rows.every((p,i)=>Object.entries(fields).every(([k,f])=>close(p.amount[k],original[i][f]))))continue;
  if(!costKeys.every(k=>close(calc.result[k],item[k])))continue;
  return {...structuredClone(item),category:'일위대가',components:parts,calculation,origin:{source:item.source,code:item.code,table:item.table,record:item.record},conversionVerified:true};
 }
 throw Error('원본 저장 금액과 재계산 결과가 달라 자동 편집을 보류했습니다. 원본 단가는 유지됩니다.');
}

function editableCost(item,details,sourceItems){
 const parts=[],expected=[],workloads=new Map();let section=0;
 for(const r of details){
  if(r.TitleCode)continue;
  if(r.Level>0)section++;
  if(r.ApplyNacChal)throw Error('근거자료 낙찰이 적용된 원본은 자동 변환하지 않습니다.');
  const text=r.LineData||'',prices=[...text.matchAll(/\x03([^\x03]+)\x03/g)],results=[...text.matchAll(/\x12([^\x12]+)\x12/g)];
  if(!r.Code||!prices.length)continue;
  const source=sourceItems.find(i=>i.code===r.Code&&i.table!=='EstMainDat');
  const target={[-1]:'labor',[-2]:'material',[-3]:'expense'}[r.SCheck]||((r.SCheck??0)===0&&source?.category==='노임'?'labor':null);
  if(!target||prices.length!==1||!results.length)throw Error('복합 산식이 있어 단가산출 자동 편집을 보류했습니다.');
  const price=Number(prices[0][1].replace(/,/g,'')),result=Number(results.at(-1)[1].replace(/,/g,''));
  if(!Number.isFinite(price)||!Number.isFinite(result)||price<0||result<0)throw Error('단가산출의 숫자식을 확인하세요.');
  const start=text.indexOf(prices[0][0]);
  let expression=text.slice(start).split('=')[0].replace(prices[0][0],'1');
  const clean=s=>s.replace(/[\x00-\x1f,\s]/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/(?:인|대|㎥|㎡|시간|분|초|hr|ton|m3|m2|m|kg|ℓ|EA|본|조|개|일|회|대당|인당|시간당)/g,'');
  expression=clean(expression);
  // If the symbolic expression has a fully numeric expansion, use that expansion.
  if(!/^[\d.+*/()\-]+$/.test(expression)){
   const candidates=text.slice(start).split('=').slice(1,-1).map(clean);
   const numeric=candidates.find(s=>/^[\d.+*/()\-]+$/.test(s)&&s.startsWith(String(price)));
   if(!numeric)throw Error('변수 또는 작업량 수식을 자동 변환하지 못했습니다. 원문을 확인하세요.');
   expression='1'+numeric.slice(String(price).length);
  }
  const quantity=evaluateFormula(expression);
  const sourceExpression=text.slice(start).split('=')[0].replace(prices[0][0],'1');
  if(/\x11[\d,.]+\x11/.test(sourceExpression)){
   const parameterized=clean(sourceExpression.replace(/\x11([\d,.]+)\x11/g,(_,n)=>{const value=Number(n.replace(/,/g,'')),key=section+':'+value;if(!workloads.has(key))workloads.set(key,{name:'Q'+(workloads.size+1),value});return workloads.get(key).name;}));
   const variables=Object.fromEntries([...workloads.values()].map(v=>[v.name,v.value]));
   try{if(close(evaluateFormula(parameterized,variables),quantity))expression=parameterized;}catch{/* Keep the validated numeric expansion when other symbols remain. */}
  }
  parts.push({name:source?.name||r.Code,spec:source?.spec||'',unit:source?.unit||'',code:r.Code,source:item.source,library:item.library,sourceComponent:target,government:r.Gangub===2||source?.government===true,section:'1',qtyExpression:expression,labor:0,material:0,expense:0,other:0,[target]:price,formulaSource:text.replace(/[\x00-\x1f]/g,''),originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{})});
  expected.push({target,result});
 }
 if(!parts.length)throw Error('편집 가능한 숫자식이 없습니다. 원본 근거를 확인하세요.');
 for(const digits of [1,0,2,3,4,5,6]){
  const calculation={outputQuantity:1,componentDigits:digits,variables:[...workloads.values()].map(v=>v.name+' = '+v.value).join('\n'),expenseOnly:false};
  const calc=calculateAssemblyDetailed(parts,calculation);
  if(!calc.rows.every((p,i)=>close(p.amount[expected[i].target],expected[i].result)))continue;
  if(!costKeys.every(k=>close(calc.result[k],item[k])))continue;
  return {...structuredClone(item),category:'단가산출',components:parts,calculation,origin:{source:item.source,code:item.code,table:item.table,record:item.record},conversionVerified:true,conversionNote:'원본의 저장 작업량을 Q 변수로 옮겼습니다. Q 또는 구성 수량 산식을 바꾸면 해당 비목이 재계산됩니다.'};
 }
 throw Error('단가산출의 집계·할증 결과가 원본과 달라 자동 편집을 보류했습니다.');
}

// A code is never sufficient: monthly and custom databases can reuse codes.
export function matchingRate(rate,library){
 const exact=library.items.filter(i=>i.table!=='EstMainDat'&&i.code===rate.code&&norm(i.name)===norm(rate.name)&&norm(i.spec)===norm(rate.spec)&&unitNorm(i.unit)===unitNorm(rate.unit));
 return exact.length===1?exact[0]:null;
}
export function refreshComponents(item,library){
 if(!item.components)throw Error('구성 항목을 먼저 편집 가능한 단가로 여세요.');
 const next=structuredClone(item),changes=[],skipped=[];
 for(const p of next.components){
  if(p.kind==='percent'||p.kind==='subtotal'||!p.code)continue;
  const match=matchingRate(p,library);
  if(!match){skipped.push(p.name);continue;}
  changes.push({name:p.name,before:costKeys.reduce((n,k)=>n+(p[k]||0),0),after:match.total});
  for(const k of costKeys)p[k]=p.sourceComponent&&p.sourceComponent!==k?0:match[k];
  p.source=match.source;p.library=match.library;p.id=match.id;p.government=match.government;
 }
 Object.assign(next,calculateAssemblyDetailed(next.components,next.calculation||{}).result);
 return {item:next,changes,skipped};
}

function editableMachine(item,details,sourceItems){
 const basis=item.machineBasis||sourceItems.find(x=>x.code===item.code&&x.table==='MachTitleDat')?.machineBasis;
 if(!basis)throw Error('기계경비 적용기준이 필요합니다. 원본 DB를 다시 등록하세요.');
 const parts=[],expected=[],variables=[];
 for(const r of details){
  if(r.TitleCode||(!r.Name&&!r.Code&&!r.TC))continue;
  if(r.CalcIndex||r.ApplyNacChal)throw Error('기계경비의 별도 계산 설정은 원본 검토가 필요합니다.');
  const target={[-1]:'labor',[-2]:'material',[-3]:'expense'}[r.Index];
  if(!target||!Number.isFinite(r.GN)||!Number.isFinite(r.TU))throw Error('기계경비 구성 유형을 확인할 수 없습니다.');
  const p={name:r.Name||r.Code,code:r.Code||'',spec:r.Size||'',unit:r.Unite||'',source:item.source,library:item.library,section:'1',labor:0,material:0,expense:0,other:0,originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),sourceComponent:target};
  if(r.Unite==='%')Object.assign(p,{kind:'percent',scope:'nearest',basis:target,target,percent:r.GN});
  else if(target==='expense'){
   // Original machine ownership coefficient is expressed in ten-millionths.
   const currency=machineExchangeRate(r,basis);
   if(!Number.isFinite(currency))throw Error('기계경비 환율 기준이 없습니다.');
   const v='FX'+(variables.length+1);variables.push(v+' = '+currency);Object.assign(p,{qtyExpression:`${r.GN}*${v}/10000000`,expense:r.TU,machineOwnership:{name:r.Name,spec:r.Size||'',coefficient:r.GN,currencyRatio:r.Ratio,fxVariable:v}});
  }else if(target==='labor'){
   const factor=basis.find(x=>x.Index===r.NCGasu&&x.Index>0);if(!factor||!Number.isFinite(factor.TC))throw Error('운전원 보정계수가 없습니다.');
   const v='OP'+(variables.length+1);let expression=String(factor.TC);try{if(close(evaluateFormula(factor.Name),factor.TC))expression=factor.Name;}catch{}
   variables.push(v+' = '+expression);Object.assign(p,{qtyExpression:`${r.GN}*${v}`,labor:r.TU});
  }else Object.assign(p,{qtyExpression:String(r.GN),material:r.TU});
  parts.push(p);expected.push(r);
 }
 if(!parts.length)throw Error('기계경비 구성 자료가 없습니다.');
 for(const digits of [1,0,2,3,4,5,6]){
  const calculation={outputQuantity:1,componentDigits:digits,variables:variables.join('\n'),expenseOnly:false};
  const c=calculateAssemblyDetailed(parts,calculation);
  if(!c.rows.every((p,i)=>Object.entries(fields).every(([k,f])=>close(p.amount[k],expected[i][f])))||!costKeys.every(k=>close(c.result[k],item[k])))continue;
  return {...structuredClone(item),category:'단가산출',originalCategory:'장비',components:parts,calculation,conversionVerified:true,origin:{source:item.source,code:item.code,table:item.table,record:item.record},conversionNote:'원본 손료·연료·잡품·운전원 적용기준을 대조한 편집 사본입니다.'};
 }
 throw Error('기계경비 적용기준의 재계산 결과가 원본과 달라 보류했습니다.');
}
export function attachMachineBasis(library){const basis=library.tables?.find(t=>t.name.toLowerCase()==='machgijundat.dat')?.rows;if(basis)for(const i of library.items||[])if(i.table==='MachTitleDat')i.machineBasis=basis;return library;}
