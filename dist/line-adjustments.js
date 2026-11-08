import {amount,truncateProduct,bidPercent} from './calc.js';
import {aggregateCalculation,manualCalculation} from './calculation-modes.js';
export const adjustmentKeys=['labor','material','expense','other'];
export function scopeRange(lines,index,level){
 let start=-1;for(let i=index;i>=0;i--)if(lines[i].level>=level){start=i;break;}
 if(start<0)throw Error(`L${level} 공종 또는 공구 안의 행을 선택하세요.`);
 let end=start+1;while(end<lines.length&&!(lines[end].level>=lines[start].level))end++;
 return {start,end};
}
export function validateAdjustment(line){
 if(line.deduction&&(!String(line.deduction.reason||'').trim()||line.level||line.surcharge))throw Error('감액 근거를 입력하세요.');
 const s=line.surcharge;if(!s)return;
 if(line.level||!['group','section','selected'].includes(s.scope)||![...adjustmentKeys,'total'].includes(s.basis)||![...adjustmentKeys,'components'].includes(s.target)||!Number.isFinite(line.qty)||line.qty<0||line.qty>1000)throw Error('할증 범위·기준·계상 비목·요율을 확인하세요.');
 if(s.target==='components'&&(!s.kpAllowance||s.scope!=='selected'||line.qty>30))throw Error('KP 압륜 가산의 대상과 30% 이내 요율을 확인하세요.');
 if(s.kpAllowance&&(s.target!=='components'||s.scope!=='selected'||s.basis!=='total'||line.qty>30||s.includeSurcharges))throw Error('KP 압륜 가산의 비목별 대상과 30% 이내 요율을 확인하세요.');
 if(s.scope==='selected'&&(!Array.isArray(s.sourceIds)||!s.sourceIds.length||new Set(s.sourceIds).size!==s.sourceIds.length))throw Error('할증 기준 행을 선택하세요.');
}
function sameKpTarget(saved,line){
 if(saved.id!==line.id)return false;
 if(line.dbReference?.state!=='quantity')return ['name','spec','unit'].every(k=>String(saved[k])===String(line[k]));
 // A quantity sheet can specify a diameter before the estimator selects the work method.
 const compact=v=>String(v??'').replace(/\s/g,'').toLowerCase();
 const diameter=v=>compact(v).match(/^(?:dn|d|[φø])?=?(\d+)(?:mm|a)?$/)?.[1];
 const base=compact(saved.name),size=diameter(saved.spec);
 if(!size||!/^kp메커니컬접합및부설(?:\((?:인력|기계)\))?$/.test(base))return false;
 return [line,line.rate].every(item=>{
  const name=compact(item?.name);
  return (name===base||name.replace(/\((?:인력|기계)\)$/,'')===base)&&
   diameter(item.spec)===size&&compact(item.unit)===compact(saved.unit);
 });
}
export function resolveLineAdjustments(input){
 const lines=input.map(l=>({...l})),warnings=[];
 for(let i=0;i<lines.length;i++){
  const l=lines[i];validateAdjustment(l);if(!l.surcharge||l.exclude)continue;
  const s=l.surcharge;let sources=[];
  try{
   if(s.scope==='selected'){
    sources=s.sourceIds.map(id=>{const j=lines.findIndex(x=>x.id===id);if(j<0||j>=i||lines[j].level)throw Error('기준 행이 삭제되었거나 할증 뒤로 이동했습니다.');return lines[j];});
   }else{const {start}=scopeRange(lines,i-1,s.scope==='group'?1:2);sources=lines.slice(start+1,i).filter(x=>!x.level);}
   sources=sources.filter(x=>aggregateCalculation(x)&&(x.bucket||'direct')==='direct'&&(!x.surcharge||s.includeSurcharges));
   if(!sources.length)throw Error('계산할 기준 행이 없습니다.');
   if(sources.some(x=>!amount(x)))throw Error('기준 행의 단가 또는 수량이 미확정입니다.');
   let components=null;
   if(s.kpAllowance){
    const a=s.kpAllowance,totalQty=sources.reduce((n,x)=>n+x.qty,0);
    if(sources.some(x=>manualCalculation(x)||x.surcharge||![x.name,x.rate?.name].every(n=>/KP.*접합.*부설/i.test(String(n).replace(/\s/g,'')))||[x.spec,x.rate?.spec].some(v=>/이탈방지압륜/.test(String(v).replace(/\s/g,'')))))throw Error('압륜이 포함되지 않은 실제 KP 기본 품을 다시 지정하세요.');
    if(!Number.isFinite(a.quantity)||a.quantity<=0||a.quantity>totalQty||!Number.isFinite(a.totalQuantity)||Math.abs(a.totalQuantity-totalQty)>1e-8||!Array.isArray(a.identities)||a.identities.length!==sources.length||sources.some(x=>!a.identities.some(t=>sameKpTarget(t,x))))throw Error('압륜 가산 대상 KP 품의 관경·수량이 바뀌었습니다. 다시 지정하세요.');
    const key=JSON.stringify([...s.sourceIds].sort()),peers=lines.filter(x=>!x.exclude&&x.surcharge?.kpAllowance&&JSON.stringify([...x.surcharge.sourceIds].sort())===key);
    if(peers.filter(x=>String(x.surcharge.kpAllowance.targetMaterialId||'')===String(a.targetMaterialId||'')).length>1||peers.reduce((n,x)=>n+x.surcharge.kpAllowance.quantity,0)>totalQty)throw Error('같은 KP 대상의 압륜 가산이 중복되었거나 대상 본수 합계가 초과했습니다.');
    const signatures=new Set(sources.map(x=>JSON.stringify([x.rate.labor,x.rate.material,x.rate.expense,x.rate.other,x.factor,bidPercent(x),x.bidMethod])));
    if(signatures.size!==1)throw Error('압륜 가산 대상 KP 단가가 서로 달라 적용 대상을 나누어야 합니다.');
    components=amount({...sources[0],qty:a.quantity});
   }
   const base=components?components.total:sources.reduce((n,x)=>n+amount(x)[s.basis],0);
   if(base<0)throw Error('할증 기준금액이 음수입니다.');
   const basisSources=sources.filter(x=>amount(x)[s.basis]!==0);
   const bidPercents=[...new Set(basisSources.flatMap(x=>x.surcharge?x.surcharge.bidPercents||[]:[x.rate?.evidenceBid?.percent??bidPercent(x)]))];
   l.surcharge={...s,resolvedSourceIds:sources.map(x=>x.id),baseValue:base,bidPercents};
   l.rate={name:l.name,spec:l.spec,unit:'%',source:'내역 할증',code:'PERCENT',labor:0,material:0,expense:0,other:0,...(components?Object.fromEntries(adjustmentKeys.map(k=>[k,components[k]])):{[s.target]:base}),total:base};
   l.factor=.01;l.bidPercent=100;l.bidMethod='unit';l.status='confirmed';l.unit='%';delete l.adjustmentWarning;
  }catch(e){l.surcharge={...s,bidPercents:[]};l.status='proposed';l.rate=null;l.adjustmentWarning=e.message;warnings.push(l.name+' · '+e.message);}
 }
 return {lines,warnings};
}
export function addSurcharge(project,selectedId,settings){
 const next=structuredClone(project),existing=next.lines.find(l=>l.id===selectedId&&l.surcharge);
 let index=next.lines.findIndex(l=>l.id===selectedId);if(index<0)throw Error('할증을 넣을 공종 또는 공구의 행을 선택하세요.');
 const scope=settings.scope||'group';
 if(!existing)index=scope==='selected'?Math.max(...settings.sourceIds.map(id=>next.lines.findIndex(l=>l.id===id)))+1:scopeRange(next.lines,index,scope==='group'?1:2).end;
 const line={...(existing||{}),id:existing?.id||crypto.randomUUID(),group:existing?.group||next.lines[Math.max(0,index-1)]?.group||'할증',name:settings.name||'기타할증',spec:'',unit:'%',qty:settings.percent,factor:.01,bucket:'direct',status:'proposed',rate:null,surcharge:{scope,basis:settings.basis,target:settings.target,sourceIds:settings.sourceIds||[],includeSurcharges:!!settings.includeSurcharges}};
 validateAdjustment(line);if(existing)next.lines[index]=line;else next.lines.splice(index,0,line);next.ratesReviewed=false;return next;
}
