import {aggregateCalculation} from './calculation-modes.js';
import {totals,synchronizeLinkedCosts,truncateProduct,truncateQuotient,norm,unitNorm} from './calc.js';
import {originalProfitCharge} from './profit-adjustment.js';
import {scopeRange} from './line-adjustments.js';
import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {editableAssembly} from './est-edit.js';
import {evaluateVariables} from './formula.js';
import {rateIdentity,resolveRateLibrary,validateProject} from './project-data.js';

const number=(v,name,min=0)=>{const n=Number(v);if(v===''||!Number.isFinite(n)||n<min||n>1e14)throw Error(name+' 값을 확인하세요.');return n;};
function cloneRows(rows,clearQty=false){const ids=new Map(rows.map(l=>[l.id,crypto.randomUUID()]));return rows.map(l=>{const next={...structuredClone(l),id:ids.get(l.id),qty:l.level?null:clearQty&&!l.surcharge&&!l.deduction?null:l.qty};if(next.surcharge?.sourceIds)next.surcharge.sourceIds=next.surcharge.sourceIds.map(id=>ids.get(id)||id);return next;});}
export function editBlock(project,ids,operation,value){
 const p=structuredClone(project),selected=new Set(ids),rows=p.lines.filter(l=>selected.has(l.id));
 if(!rows.length)throw Error('대상 행을 선택하세요.');
 if(operation==='copy'){const last=p.lines.findLastIndex(l=>selected.has(l.id));p.lines.splice(last+1,0,...cloneRows(rows));}
 else if(operation==='delete')p.lines=p.lines.filter(l=>!selected.has(l.id));
 else for(const l of rows){
  if(operation==='levelUp'||operation==='levelDown'){if(l.level){const n=l.level+(operation==='levelUp'?1:-1);if(n<1||n>9)throw Error('집계 레벨은 1~9 안에서 조정하세요.');l.level=n;}continue;}
  if(operation==='group'){l.group=String(value).trim();if(!l.group)throw Error('공종명을 입력하세요.');continue;}
  if(l.level)continue;
  if((l.surcharge||l.deduction)&&['qty','multiply','factor','expense','restoreExpense','bucket'].includes(operation))throw Error('할증·감액 행은 일괄 수량·비목 변경에서 제외하고 개별 설정으로 수정하세요.');
  if(operation==='qty'){l.qty=number(value,'수량');}
  else if(operation==='multiply'){if(l.qty==null)throw Error('수량 미확정 행이 있습니다.');l.qty=Number((l.qty*number(value,'수량 배수')).toPrecision(14));}
  else if(operation==='factor')l.factor=number(value,'단위환산계수',Number.MIN_VALUE);
  else if(operation==='bucket')l.bucket=value;
  else if(operation==='exclude')l.exclude=true;
  else if(operation==='include')l.exclude=false;
  else if(operation==='expense'&&l.rate){l.originalExpenseRate??=structuredClone(l.rate);l.rate={...l.rate,labor:0,material:0,other:0,expense:l.rate.total,expenseOnly:true};}
  else if(operation==='restoreExpense'&&l.originalExpenseRate){l.rate=l.originalExpenseRate;delete l.originalExpenseRate;}
 }
 p.ratesReviewed=false;return validateProject(p);
}
export function copyProjectLines(target,source,ids,clearQty=false){
 const p=structuredClone(target),selected=new Set(ids);
 for(const [index,l] of source.lines.entries()){
  if(!selected.has(l.id)||!l.surcharge)continue;
  if(l.surcharge.scope==='selected'){
   if(l.surcharge.sourceIds.some(id=>!selected.has(id)))throw Error('다른 공사로 할증을 복사할 때는 할증의 기준 행도 함께 선택하세요.');
  }else if(['group','section'].includes(l.surcharge.scope)){
   const {start}=scopeRange(source.lines,index-1,l.surcharge.scope==='group'?1:2);
   if(!selected.has(source.lines[start].id))throw Error('다른 공사로 범위 할증을 복사할 때는 원본 공종·공구 제목도 함께 선택하세요.');
  }
 }
 p.lines.push(...cloneRows(source.lines.filter(l=>selected.has(l.id)),clearQty));
 const evidence=new Map([...(p.evidence||[]),...(source.evidence||[])].map(e=>[rateIdentity(e.rate),e]));p.evidence=[...evidence.values()];p.ratesReviewed=false;return validateProject(p);
}
export function procurementFee(government,rate,digits=0){
 const base=number(government,'관급자재대'),pct=number(rate,'수수료율'),d=number(digits,'절상 자릿수');if(!Number.isInteger(d)||d>6)throw Error('절상 자릿수는 0~6입니다.');
 const pure=truncateProduct(base,pct,.01),unit=10**d,rounded=Math.ceil((base+pure)/unit)*unit;
 return {base,pure,rounding:rounded-base-pure,total:rounded-base};
}
export function reverseContract(project,target){
 const goal=number(target,'목표 도급액'),p=structuredClone(project),idx=p.charges.findIndex(c=>c.key==='profit');if(idx<0)throw Error('이윤 항목이 필요합니다.');
 const limit=originalProfitCharge(p.charges[idx]);p.charges[idx]=limit;
 const original=totals(p.lines,p.charges),max=original.charges[idx].amount;
 if(original.missing)throw Error('미연결 단가·수량을 확인한 뒤 역산하세요.');
 const calc=x=>{p.charges[idx]={...limit,link:undefined,ruleSet:undefined,formula:undefined,base:'fixed',fixed:x};return totals(p.lines,p.charges).contract;};
 if(goal>original.contract||goal<calc(0))throw Error(`이윤 한도에서 가능한 도급액은 ${calc(0).toLocaleString('ko-KR')}~${original.contract.toLocaleString('ko-KR')}원입니다.`);
 let lo=0,hi=max;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(calc(mid)<=goal)lo=mid;else hi=mid-1;}
 const actual=calc(lo);p.charges[idx].adjustment={original:limit,target:goal,actual,difference:goal-actual};p.ratesReviewed=false;
 return {project:validateProject(synchronizeLinkedCosts(p)),profit:lo,actual,difference:goal-actual,maximum:limit};
}
export function safetyComparison(base,government,rate,addition,surcharge){
 const b=number(base,'대상액'),g=number(government,'관급 포함액'),r=number(rate,'요율'),a=number(addition,'기초액'),s=number(surcharge,'할증률');
 const withGovernment=truncateProduct(b+g,r,.01)+a,withSurcharge=truncateProduct(truncateProduct(b,r,.01)+a,1+s/100);
 return {withGovernment,withSurcharge,selected:Math.min(withGovernment,withSurcharge)};
}
export function machineryRate(v){
 const n={};for(const k of ['price','exchange','ownership','fuel','fuelPrice','oilPercent','dailyWage','workers','hours','misc'])n[k]=number(v[k],k);if(!n.hours)throw Error('하루 작업시간은 0보다 커야 합니다.');
 const scale=Number(v.ownershipScale??6),factor=number(v.operatorFactor??1,'운전원 보정계수');if(![6,7].includes(scale))throw Error('손료 분모 지수는 6 또는 7입니다.');
 const labor=truncateQuotient(n.dailyWage*n.workers*factor,n.hours),fuel=truncateProduct(n.fuel,n.fuelPrice),material=fuel+truncateProduct(fuel,n.oilPercent,.01),expense=truncateProduct(n.price,n.exchange,n.ownership,10**(-scale))+truncateProduct(n.misc);
 return {labor,material,expense,other:0,total:labor+material+expense};
}
export function marketRate(total,percent,remainder='expense'){
 const t=number(total,'합계 단가'),r=number(percent,'노무비율');if(r>100||!['material','expense'].includes(remainder))throw Error('노무비율·잔여 비목을 확인하세요.');const labor=truncateProduct(t,r,.01);return {labor,material:0,expense:0,other:0,[remainder]:t-labor,total:t};
}
export function haulFormula({capacity,efficiency,loading,unloading,segments}){
 const q=number(capacity,'1회 운반량',Number.MIN_VALUE),eff=number(efficiency,'작업효율',Number.MIN_VALUE),load=number(loading,'적재시간'),unload=number(unloading,'적하시간');if(eff>1)throw Error('작업효율은 0 초과 1 이하입니다.');
 const variables=[`q = ${q}`,`E = ${eff}`,`tLoad = ${load}`,`tUnload = ${unload}`],times=[];
 for(const [i,s] of segments.entries()){const distance=number(s.distance,'운반거리');if(!distance)continue;const loaded=number(s.loaded,'적재 속도',Number.MIN_VALUE),empty=number(s.empty,'공차 속도',Number.MIN_VALUE),j=i+1;variables.push(`L${j} = ${distance}`,`V${j} = ${loaded}`,`W${j} = ${empty}`,`t${j} = 60*L${j}/V${j}+60*L${j}/W${j}`);times.push('t'+j);}
 variables.push('t = tLoad+tUnload'+times.map(x=>'+'+x).join(''),'Q = 60*q*E/t');const text=variables.join('\n'),result=evaluateVariables(text);return {variables:text,minutes:result.values.t,quantity:result.values.Q};
}
export function findUsage(project,query){
 const q=norm(query),result=[];if(!q)return result;
 function visit(rate,path,depth=0){if(!rate||depth>12)return;const match=norm([rate.name,rate.spec,rate.code,rate.source].join(' ')).includes(q);if(match)result.push({path,rate});for(const p of rate.components||[])if(!p.kind)visit(p,path+' → '+p.name,depth+1);}
 for(const line of project.lines){if(norm(line.name+' '+line.spec).includes(q))result.push({path:line.group+' / '+line.name,rate:line.rate,lineId:line.id});visit(line.rate,line.group+' / '+line.name);const evidence=project.evidence?.find(e=>line.rate&&rateIdentity(e.rate)===rateIdentity(line.rate));for(const row of evidence?.rows||[]){if(norm([row.Code,row.Name,row.Size,row.LineData].join(' ')).includes(q))result.push({path:line.group+' / '+line.name+' → 원본 근거 '+(row.Name||row.Code||''),rate:{name:row.Name||'',code:row.Code||''},lineId:line.id});}}
 return result;
}

// Physical resource quantities only. Never infer quantity by dividing cost by price.
export function resourceReport(project,libraries){
 const resources=new Map(),warnings=[],covered=new Set();let count=0;
 const evidence=new Map((project.evidence||[]).map(e=>[rateIdentity(e.rate),e.rows]));
 const cache=new Map();
 function expand(rate,qty,path,stack=[]){
  if(++count>60000)throw Error('구성 항목이 너무 많아 동원표 계산을 중단했습니다.');
  const key=rateIdentity(rate);if(stack.includes(key)||stack.length>12){warnings.push(path+' · 순환/깊이 제한');return;}
  const category=rate.category||({L:'노임',M:'자재',E:'장비'}[rate.code?.[0]]);
  if(['노임','자재','장비'].includes(category)){
   const id=JSON.stringify([rate.source,rate.code,rate.name,rate.spec,unitNorm(rate.unit),category,rate.government]);const old=resources.get(id)||{category,name:rate.name,spec:rate.spec||'',unit:rate.unit||'',code:rate.code||'',source:rate.source||'',government:!!rate.government,qty:0,uses:[]};old.qty+=qty;old.uses.push({path,qty});resources.set(id,old);return;
  }
  let editable=rate;
  try{if(!rate.components){if(cache.has(key))editable=cache.get(key);else{const lib=resolveRateLibrary(rate,libraries),prefix=rate.code?.startsWith('U')?'HeadMainDat':'CostMainDat',detail=evidence.get(key)||lib?.details?.find(([k])=>k===prefix+':'+rate.code)?.[1];editable=editableAssembly(rate,detail,lib?.items||[]);cache.set(key,editable);}}}catch(e){warnings.push(path+' · '+e.message);return;}
  const calc=calculateAssemblyDetailed(editable.components,editable.calculation||{}),parts=[],masked=new Map();
  for(const p of calc.rows){
   if(p.replaceRunning&&aggregateCalculation(p)){const scale=p.percent/100;for(const old of parts)old.qty*=scale;for(const m of masked.values())for(const k of Object.keys(m.values))m.values[k]*=scale;continue;}
   if(!aggregateCalculation(p)||p.kind==='percent'||p.kind==='subtotal'||p.fixedPrice||!p.qty)continue;
   if(p.sourceComponent){const id=JSON.stringify([p.source,p.code,p.qtyExpression,p.section]);if(!masked.has(id))masked.set(id,{p,values:{}});const m=masked.get(id);m.values[p.sourceComponent]=(m.values[p.sourceComponent]||0)+p.qty;}
   else parts.push({...p});
  }
  for(const {p,values} of masked.values())parts.push({...p,qty:Math.max(...Object.values(values))});
  for(const p of parts){let child=p;if(!p.components){const lib=libraries.find(l=>l.id===p.library)||libraries.find(l=>l.name===p.source),matches=lib?.items?.filter(i=>i.code===p.code&&i.table!=='EstMainDat'&&norm(i.name)===norm(p.name)&&norm(i.spec)===norm(p.spec))||[];if(matches.length===1)child=matches[0];}
   expand(child,qty*p.qty/calc.divisor,path+' → '+p.name,[...stack,key]);
  }
 }
 for(const l of project.lines){if(!aggregateCalculation(l)||l.level)continue;if(!l.rate||l.status!=='confirmed'||l.qty==null){warnings.push(l.name+' · 단가/수량 미확정');continue;}const before=warnings.length;expand(l.originalExpenseRate||l.rate,l.qty*(l.factor??1),l.group+' / '+l.name);if(warnings.length===before)covered.add(l.id);}
 return {rows:[...resources.values()].map(r=>({...r,qty:Number(r.qty.toPrecision(12))})).sort((a,b)=>a.category.localeCompare(b.category)||a.name.localeCompare(b.name)),warnings,covered:covered.size,total:project.lines.filter(l=>aggregateCalculation(l)&&!l.level).length};
}
export function scheduleRows(project){
 return [...new Set(project.lines.filter(l=>!l.level&&!l.exclude).map(l=>l.group))].map(group=>({group,start:'',end:'',progress:0,...project.schedule?.find(r=>r.group===group)}));
}
export function propagateResource(project,libraries,replacement){
 if(!replacement.origin?.source||!replacement.origin?.code)throw Error('원본 출처가 있는 편집 단가를 선택하세요.');
 const origin=replacement.origin,p=structuredClone(project),changes=[],skipped=[];
 function update(rate,stack=[]){
  const matches=rate.source===origin.source&&rate.code===origin.code&&norm(rate.name)===norm(replacement.name)&&norm(rate.spec)===norm(replacement.spec)&&unitNorm(rate.unit)===unitNorm(replacement.unit);
  if(matches)return {rate:structuredClone(replacement),changed:true};
  if(['노임','자재','장비','표준시장단가'].includes(rate.category))return {rate,changed:false};
  const key=rateIdentity(rate);if(stack.includes(key)||stack.length>12)throw Error('순환 참조 또는 구성 깊이 제한');
  let editable=rate,lib=resolveRateLibrary(rate,libraries);
  if(!rate.components){const prefix=rate.code?.startsWith('U')?'HeadMainDat':'CostMainDat',detail=project.evidence?.find(e=>rateIdentity(e.rate)===key)?.rows||lib?.details?.find(([k])=>k===prefix+':'+rate.code)?.[1];editable=editableAssembly(rate,detail,lib?.items||[]);}
  const next=structuredClone(editable);let changed=false;
  for(const part of next.components){if(part.kind||part.fixedPrice)continue;let child=part;
   if(!part.components){const source=libraries.find(l=>l.id===part.library)||libraries.find(l=>l.name===part.source),candidates=source?.items.filter(i=>i.table!=='EstMainDat'&&i.code===part.code&&norm(i.name)===norm(part.name)&&norm(i.spec)===norm(part.spec)&&unitNorm(i.unit)===unitNorm(part.unit))||[];if(candidates.length===1)child=candidates[0];}
   const result=update(child,[...stack,key]);if(!result.changed)continue;
   const preserve=Object.fromEntries(['qty','qtyExpression','section','sumTag','basisTag','exclude','calculationMode','manualAmounts','sourceComponent','originalRecord'].filter(k=>k in part).map(k=>[k,part[k]]));
   Object.assign(part,result.rate,preserve);if(part.sourceComponent){const leaf=!result.rate.components&&['노임','자재'].includes(result.rate.category);for(const k of costKeys)part[k]=k!==part.sourceComponent?0:leaf?result.rate.total:result.rate[k];part.total=costKeys.reduce((s,k)=>s+(part[k]||0),0);}changed=true;
  }
  if(changed){Object.assign(next,calculateAssemblyDetailed(next.components,next.calculation||{}).result);next.origin??={source:rate.source,code:rate.code};next.propagatedFrom={source:replacement.source,code:replacement.code};}
  return {rate:next,changed};
 }
 for(const line of p.lines){if(line.level||!line.rate||line.status!=='confirmed')continue;try{const result=update(line.originalExpenseRate||line.rate);if(result.changed){changes.push({name:line.name,before:line.rate.total,after:result.rate.total});if(line.originalExpenseRate){line.originalExpenseRate=result.rate;line.rate={...result.rate,labor:0,material:0,other:0,expense:result.rate.total,expenseOnly:true};}else line.rate=result.rate;}}catch(e){skipped.push(line.name+' · '+e.message);}}
 p.ratesReviewed=false;return {project:validateProject(p),changes,skipped};
}
export function validateSchedule(rows){
 const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const n=Date.parse(value+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===value?n:null;};
 for(const r of rows){if(r.start||r.end){const a=date(r.start),b=date(r.end);if(a===null||b===null||a>b)throw Error(r.group+': 시작일·종료일을 확인하세요.');}const n=number(r.progress,'진행률');if(n>100)throw Error('진행률은 100% 이하여야 합니다.');}return rows;
}
