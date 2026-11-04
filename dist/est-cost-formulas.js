import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {evaluateFormula} from './formula.js';
import {truncateProduct} from './calc.js';
import {normalizeEstNumericExpression,parseEstPercentFactor} from './est-numeric-formula.js';

const close=(a,b)=>Math.abs((a||0)-(b||0))<0.00001;
const clean=normalizeEstNumericExpression;
const targetOf=n=>({[-1]:'labor',[-2]:'material',[-3]:'expense'}[n]);
// Translate printed numeric expansions, then prove each row and the full parent
// against the saved EST values. Never derive quantities from total/price ratios.
export function costFromPrintedFormulas(item,details,sourceItems){
 try{return numericCostFromPrintedFormulas(item,details,sourceItems);}catch{return taggedCostFromPrintedFormulas(item,details,sourceItems);}
}
function numericCostFromPrintedFormulas(item,details,sourceItems){
 const parts=[],expected=[];
 for(const r of details){
  if(r.TitleCode||r.Level<0)continue;
  if(r.ApplyNacChal||r.EscData)throw Error('낙찰·별도 조정 산식은 자동 갱신할 수 없습니다.');
  const text=r.LineData||'',prices=[...text.matchAll(/\x03([^\x03]+)\x03/g)],results=[...text.matchAll(/\x12([^\x12]+)\x12/g)];
  if([58,62].includes(r.LinkIndex)){
   const legacyPercent=text.match(/[×*]\s*([\d.]+)\s*%/),percent=legacyPercent?Number(legacyPercent[1]):parseEstPercentFactor(text.replace(/\x06[^\x06]*\x06|\x07[^\x07]*\x07/g,'')),target=targetOf(r.SCheck),basis=targetOf(r.OCheck)|| (r.LinkIndex===62?'total':null);
   if(percent==null||!target||!basis||!results.length)throw Error('잡비의 기준·비목을 확인할 수 없습니다.');
   parts.push({name:'잡비',kind:'percent',percent,basis,target,scope:r.LinkIndex===62?'tag':'all',sumTag:String(r.SKind??0),source:item.source,originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),calculationMode:!item[target]?'vertical':'auto'});
   expected.push({value:Number(results.at(-1)[1].replace(/,/g,'')),target});continue;
  }
  if(!r.Code||!prices.length)continue;
  const source=sourceItems.find(i=>i.code===r.Code&&i.table!=='EstMainDat');
  const target=targetOf(r.SCheck)||(source?.category==='노임'?'labor':source?.category==='자재'?'material':null);
  if(!target||prices.length!==1||!results.length)throw Error('복합 단가식은 검토가 필요합니다.');
  const price=Number(prices[0][1].replace(/,/g,'')),value=Number(results.at(-1)[1].replace(/,/g,''));
  const start=text.indexOf(prices[0][0]),fragments=text.slice(start).split('=');
  let expression=clean(fragments[0].replace(prices[0][0],'1'));
  if(!/^[\d.+*/()\-]+$/.test(expression)){
   const numeric=fragments.slice(1,-1).map(clean).find(s=>/^[\d.+*/()\-]+$/.test(s)&&s.startsWith(String(price)));
   if(!numeric)throw Error('전개되지 않은 변수 산식은 검토가 필요합니다.');
   expression='1'+numeric.slice(String(price).length);
  }
  const qty=evaluateFormula(expression);if(!Number.isFinite(price)||price<0||!Number.isFinite(value)||value<0||qty<0)throw Error('산출식의 숫자 범위를 확인하세요.');
  const digits=[1,0,2,3,4,5,6].find(d=>close(truncateProduct(qty,price,10**d)/10**d,value));
  if(digits==null)throw Error('산출식의 수량·절사와 원본 금액이 다릅니다.');
  const excludedMaterial=source?.category==='자재'&&r.SCheck===0&&!r.TC;
  parts.push({name:source?.name||r.Code,spec:source?.spec||'',unit:source?.unit||'',code:r.Code,source:item.source,library:item.library,sourceComponent:target,qtyExpression:expression,componentDigits:digits,labor:0,material:0,expense:0,other:0,[target]:price,originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),sumTag:String(r.SKind??0),calculationMode:!item[target]||excludedMaterial?'vertical':'auto',formulaSource:text.replace(/[\x00-\x1f]/g,'')});
  expected.push({value,target});
 }
 if(!parts.length)throw Error('재계산할 숫자식이 없습니다.');
 const calculation={outputQuantity:1,componentDigits:1,variables:'',expenseOnly:false};
 for(let i=0;i<parts.length;i++)if(parts[i].kind){
  const digits=[1,0,2,3,4,5,6].find(d=>{parts[i].componentDigits=d;const a=calculateAssemblyDetailed(parts.slice(0,i+1),calculation).rows[i].amount;return close(a[expected[i].target],expected[i].value);});
  if(digits==null)throw Error('잡비 산식과 원본 금액이 다릅니다.');parts[i].componentDigits=digits;
 }
 const calc=calculateAssemblyDetailed(parts,calculation);
 if(!calc.rows.every((r,i)=>close(r.amount[expected[i].target],expected[i].value))||![...costKeys,'total'].every(k=>close(calc.result[k],item[k])))throw Error('산출식 전체 집계가 원본과 달라 갱신을 보류했습니다.');
 return {...structuredClone(item),components:parts,calculation,conversionVerified:true,origin:{source:item.source,code:item.code,table:item.table,record:item.record}};
}

const numeric=s=>/^[\d.+*/()\-]+$/.test(s);
const printedNumber=s=>{const value=clean(s);if(!/^\d+(?:\.\d+)?$/.test(value))throw Error('원문 숫자 표기를 확인하세요.');return Number(value);};
const marks=(text,char)=>[...text.matchAll(new RegExp(char+'([^'+char+']+)'+char,'g'))].map(m=>m[1]);
const stripTags=text=>text.replace(/\x06[^\x06]*\x06|\x07[^\x07]*\x07/g,'');
function explicitTag(text,char){
 const tags=marks(text,char).map(s=>s.trim());
 if(tags.length>1||tags.some(t=>!/^[A-Za-z][A-Za-z0-9_]*$/.test(t)))throw Error('SUM 색인 정의를 하나로 확인할 수 없습니다.');
 return tags[0];
}
function quantityExpression(text,priceToken,price){
 const start=text.indexOf(priceToken),fragments=stripTags(text.slice(start)).split('=');
 let expression=clean(fragments[0].replace(priceToken,'1'));
 if(!numeric(expression)){
  const prefix=String(price),expanded=fragments.slice(1,-1).map(clean).find(s=>numeric(s)&&s.startsWith(prefix)&&!/[\d.]/.test(s[prefix.length]||''));
  if(!expanded)throw Error('전개되지 않은 변수 산식은 검토가 필요합니다.');
  expression='1'+expanded.slice(prefix.length);
 }
 const qty=evaluateFormula(expression);if(!Number.isFinite(qty)||qty<0)throw Error('산출식의 수량을 확인하세요.');
 return {expression,qty};
}
// Explicit EST producer (06), consumer (07), and subtotal records are different
// operations. Keep those dependencies instead of replacing them with old totals.
function taggedCostFromPrintedFormulas(item,details,sourceItems){
 const parts=[],expected=[],defined=new Set(),calculation={outputQuantity:1,componentDigits:1,variables:'',expenseOnly:false};
 let section='1',sectionText='';
 const push=(part,value,target)=>{
  if(!Number.isFinite(value)||value<0)throw Error('원문 산출 금액을 확인하세요.');
  if(part.sumTag){if(defined.has(part.sumTag))throw Error('SUM 기준 색인이 중복되어 계산을 보류했습니다.');defined.add(part.sumTag);}
  const candidate=[...parts,part],digits=[1,0,2,3,4,5,6].find(d=>{part.componentDigits=d;return close(calculateAssemblyDetailed(candidate,calculation).rows.at(-1).amount[target],value);});
  if(digits==null)throw Error('원문 산식의 수량·소계·절사 결과가 다릅니다.');
  part.componentDigits=digits;parts.push(part);expected.push({value,target});
 };
 for(const r of details){
  if(r.TitleCode)continue;
  if(r.ApplyNacChal||r.EscData)throw Error('낙찰·별도 조정 산식은 자동 갱신할 수 없습니다.');
  const text=r.LineData||'',plain=text.replace(/[\x00-\x1f]/g,''),prices=marks(text,'\x03'),results=marks(text,'\x12'),producer=explicitTag(text,'\x06'),consumer=explicitTag(text,'\x07');
  if(r.Level>0){section=String(r._record);sectionText=plain;}
  const meta={source:item.source,library:item.library,originalRecord:r._record,section,formulaSource:plain,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),...(producer?{sumTag:producer}:{})};
  if(r.Level<0){
   if(!producer)continue;
   const basis=targetOf(r.OCheck)||targetOf(r.SCheck);
   if(!basis||results.length!==1)throw Error('색인 소계의 원본 비목을 확인할 수 없습니다.');
   const calc=calculateAssemblyDetailed(parts,calculation),values=calc.rows.filter(p=>p.kind!=='subtotal'&&p.amount[basis]!==0).map(p=>p.amount[basis]);
   const left=clean(stripTags(text).split('=')[0].split(':').at(-1));
   if(!/^\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)*$/.test(left))throw Error('소계의 명시 덧셈식을 확인할 수 없습니다.');
   const operands=left.split('+').map(Number).filter(n=>n!==0);
   if(operands.length!==values.length||!operands.every((n,i)=>close(n,values[i])))throw Error('소계의 원문 항목과 앞선 비목 구성이 다릅니다.');
   push({...meta,name:'원문 SUM '+producer+' 소계',kind:'subtotal',scope:'all',basis,target:basis},printedNumber(results[0]),basis);continue;
  }
  if(r.LinkIndex===61){
   const target=targetOf(r.SCheck),sum=marks(text,'\x0c');
   const prior=parts.filter(p=>p.section===section);
   if(!target||sum.length!==1||!/소\s*계/.test(plain)||!prior.length||prior.some(p=>p.kind||p.calculationMode!=='vertical'))throw Error('명시 소계의 포함 범위를 확인할 수 없습니다.');
   push({...meta,name:'원문 상하차료 소계',kind:'percent',percent:100,basis:'total',target,scope:'section'},printedNumber(sum[0]),target);continue;
  }
  if([58,62].includes(r.LinkIndex)){
   const percent=parseEstPercentFactor(stripTags(text)),target=targetOf(r.SCheck),basis=consumer?'total':targetOf(r.OCheck);
   if(percent==null||!target||!basis||results.length!==1||consumer&&!defined.has(consumer))throw Error('원본 잡비의 명시 기준·비율·비목을 확인할 수 없습니다.');
   const refValues=marks(text,'\x1a');
   if(consumer){
    const previous=calculateAssemblyDetailed(parts,calculation).rows.filter(p=>p.sumTag===consumer);
    if(previous.length!==1||refValues.length!==1||!close(previous[0].amount.total,printedNumber(refValues[0])))throw Error('SUM 참조의 표시 금액과 정의가 다릅니다.');
   }
   push({...meta,name:consumer?'SUM '+consumer+' 비율':'원문 잡비',kind:'percent',percent,basis,target,scope:consumer?'tag':'all',...(consumer?{basisTag:consumer}:{}),calculationMode:!item[target]?'vertical':'auto'},printedNumber(results[0]),target);continue;
  }
  if(r.Code&&prices.length){
   const candidates=sourceItems.filter(i=>i.code===r.Code&&i.table!=='EstMainDat');if(candidates.length!==1)throw Error('원본 자원을 하나로 확인할 수 없습니다.');
   const source=candidates[0],reference=(r.SCheck??0)===0&&!!targetOf(r.OCheck);
   const target=targetOf(r.SCheck)||(reference?targetOf(r.OCheck):source.category==='노임'?'labor':source.category==='자재'?'material':null);
   if(!target||prices.length!==1)throw Error('복합 단가식의 적용 비목을 확인할 수 없습니다.');
   const price=printedNumber(prices[0]),token='\x03'+prices[0]+'\x03';let expression,qty,value,priceOnly=false;
   if(!results.length&&producer&&source.category==='자재'&&/별산|별도/.test(sectionText)&&!text.slice(text.indexOf(token)+token.length).trim()){
    if(['TC','NC','GC','JC','SC'].some(k=>Number(r[k]||0)!==0))throw Error('단가 참조행에 별도 계상 금액이 있습니다.');
    expression='1';qty=1;value=price;priceOnly=true;
   }else{
    if(results.length!==1)throw Error('원본 산출 결과를 하나로 확인할 수 없습니다.');
    ({expression,qty}=quantityExpression(text,token,price));value=printedNumber(results[0]);
   }
   const digits=[1,0,2,3,4,5,6].find(d=>close(truncateProduct(qty,price,10**d)/10**d,value));if(digits==null)throw Error('원문 수량·단가·금액이 일치하지 않습니다.');
   const excludedMaterial=source.category==='자재'&&(r.SCheck??0)===0&&!r.TC;
   push({...meta,name:source.name,spec:source.spec||'',unit:source.unit||'',code:r.Code,sourceComponent:target,qtyExpression:expression,labor:0,material:0,expense:0,other:0,[target]:price,calculationMode:!item[target]||reference||excludedMaterial||priceOnly?'vertical':'auto',...(priceOnly?{referencePriceOnly:true,rowBigo:'원문 기준 단가 참조 · 직접 합산 제외'}:{})},value,target);continue;
  }
  if(!r.Code&&targetOf(r.SCheck)&&results.length===1&&![58,61,62].includes(r.LinkIndex)){
   const target=targetOf(r.SCheck),fragments=plain.split('='),first=clean(fragments[0].split(':').at(-1)),start=first.match(/^\d+(?:\.\d+)?/);
   if(!start)throw Error('고정 단가의 명시 숫자식을 확인할 수 없습니다.');
   const price=Number(start[0]),expanded=numeric(first)?first:fragments.slice(1,-1).map(clean).find(s=>numeric(s)&&s.startsWith(start[0])&&!/[\d.]/.test(s[start[0].length]||''));
   if(!expanded)throw Error('고정 단가의 전개된 수량식이 없습니다.');
   const expression='1'+expanded.slice(start[0].length),value=printedNumber(results[0]);
   push({...meta,name:'원문 고정 '+({labor:'노무비',material:'재료비',expense:'경비'}[target]),spec:'원문 명시 단가 유지',unit:'식',code:'',fixedPrice:true,qtyExpression:expression,labor:0,material:0,expense:0,other:0,[target]:price},value,target);continue;
  }
  if(r.SCheck===-5&&r.Code&&!prices.length){
   const calc=calculateAssemblyDetailed(parts,calculation),selected=calc.rows.filter(p=>p.code===r.Code&&p.section===section&&p.calculationMode!=='vertical');
   if(!selected.length||!costKeys.every(k=>close(selected.reduce((n,p)=>n+p.amount[k],0),r[{labor:'NC',material:'GC',expense:'JC',other:'SC'}[k]])))throw Error('장비 소계의 계상 비목이 원본과 다릅니다.');
  }
 }
 if(!parts.length)throw Error('재계산할 명시 산식이 없습니다.');
 const calc=calculateAssemblyDetailed(parts,calculation);
 if(!calc.rows.every((r,i)=>close(r.amount[expected[i].target],expected[i].value))||![...costKeys,'total'].every(k=>close(calc.result[k],item[k])))throw Error('산출식 전체 집계가 원본과 달라 갱신을 보류했습니다.');
 return {...structuredClone(item),components:parts,calculation,conversionVerified:true,conversionNote:'원문의 단가·수량·명시 SUM 색인과 고정 단가식을 보존하고 행별 금액과 전체 비목을 검증했습니다.',origin:{source:item.source,code:item.code,table:item.table,record:item.record}};
}
