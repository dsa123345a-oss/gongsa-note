import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {evaluateFormula} from './formula.js';
import {truncateProduct} from './calc.js';

const close=(a,b)=>Math.abs((a||0)-(b||0))<0.00001;
const clean=s=>s.replace(/[\x00-\x1f,\s]/g,'').replace(/×/g,'*').replace(/÷/g,'/').replace(/(?:인\/개|인\/m|시간당|대당|인당|㎥|㎡|시간|분|초|hr|ton|m3|m2|kg|ℓ|EA|본|조|개|일|회|대|인|m)/g,'');
const targetOf=n=>({[-1]:'labor',[-2]:'material',[-3]:'expense'}[n]);
// Translate printed numeric expansions, then prove each row and the full parent
// against the saved EST values. Never derive quantities from total/price ratios.
export function costFromPrintedFormulas(item,details,sourceItems){
 const parts=[],expected=[];
 for(const r of details){
  if(r.TitleCode||r.Level<0)continue;
  if(r.ApplyNacChal||r.EscData)throw Error('낙찰·별도 조정 산식은 자동 갱신할 수 없습니다.');
  const text=r.LineData||'',prices=[...text.matchAll(/\x03([^\x03]+)\x03/g)],results=[...text.matchAll(/\x12([^\x12]+)\x12/g)];
  if([58,62].includes(r.LinkIndex)){
   const pct=text.match(/[×*]\s*([\d.]+)\s*%/),target=targetOf(r.SCheck),basis=targetOf(r.OCheck)|| (r.LinkIndex===62?'total':null);
   if(!pct||!target||!basis||!results.length)throw Error('잡비의 기준·비목을 확인할 수 없습니다.');
   parts.push({name:'잡비',kind:'percent',percent:Number(pct[1]),basis,target,scope:r.LinkIndex===62?'tag':'all',sumTag:String(r.SKind??0),source:item.source,originalRecord:r._record,...(typeof r.Bigo==='string'?{rowBigo:r.Bigo}:{}),calculationMode:!item[target]?'vertical':'auto'});
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
 if(!calc.rows.every((r,i)=>close(r.amount[expected[i].target],expected[i].value))||!costKeys.every(k=>close(calc.result[k],item[k])))throw Error('산출식 전체 집계가 원본과 달라 갱신을 보류했습니다.');
 return {...structuredClone(item),components:parts,calculation,conversionVerified:true,origin:{source:item.source,code:item.code,table:item.table,record:item.record}};
}
