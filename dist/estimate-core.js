import {amount,truncateProduct,truncateQuotient,cleanNumber} from './calc.js';
import {evaluateFormula,evaluateVariables} from './formula.js';
import {createExactFormulaContext} from './formula-precision.js';
import {manualCalculation,manualAmounts,aggregateCalculation,validateCalculationMode} from './calculation-modes.js';
export const costKeys=['labor','material','expense','other'];
const zero=()=>({labor:0,material:0,expense:0,other:0,total:0});
export function hierarchyTotals(lines){const stack=[],result=new Map();
 for(const line of lines){if(line.separateTail)stack.length=0;const level=Number(line.level)||0;
  if(level){while(stack.length&&stack.at(-1).level<=level)stack.pop();const entry={...zero(),missing:0,level,scope:line.headingScope};result.set(line.id,entry);stack.push(entry);continue;}
  if(!aggregateCalculation(line))continue;const a=amount(line);for(const h of stack){if(h.scope==='direct'&&(line.bucket||'direct')!=='direct')continue;if(!a)h.missing++;else for(const k of [...costKeys,'total'])h[k]+=a[k];}
 }return result;
}
export function calculateAssemblyDetailed(parts,options={}){
 const variables=evaluateVariables(options.variables||''),exact=createExactFormulaContext(options.variables||''),rows=[],result=zero();
 const divisor=evaluateFormula(String(options.outputQuantity??1),variables.values);if(divisor<=0)throw Error('산출 기준 수량은 0보다 커야 합니다.');
 const digits=Number(options.componentDigits??0);if(!Number.isInteger(digits)||digits<0||digits>6)throw Error('구성 금액 소수 자릿수는 0~6입니다.');
 for(const [index,p] of parts.entries()){
  const rowDigits=Number(p.componentDigits??digits);if(!Number.isInteger(rowDigits)||rowDigits<0||rowDigits>6)throw Error('구성 행 소수 자릿수는 0~6입니다.');
  const product=(...values)=>truncateProduct(...values,10**rowDigits)/10**rowDigits;
  validateCalculationMode(p);if(p.kind==='subtotal'&&p.startRowInvalid)throw Error('ADD 시작 행이 삭제되었습니다. 소계의 시작행을 다시 지정하세요.');
  let row={...zero(),...p,index};
  if(p.kind==='percent'||p.kind==='subtotal'){
   let selected=rows.filter(r=>r.kind!=='subtotal');
   if(p.scope==='section')selected=selected.filter(r=>(r.section||'1')===(p.section||'1'));
   if(p.scope==='tag'){
    const tag=p.basisTag||p.sumTag;if(!tag)throw Error('SUM에 사용할 색인을 입력하세요.');
    selected=(p.basisTag?rows:selected).filter(r=>r.sumTag===tag);
    if(p.basisTag&&selected.length!==1)throw Error('명시 SUM 기준 색인을 하나로 확인할 수 없습니다.');
   }
   if(p.scope==='nearest'){
    const nearest=rows.findLast(r=>(r.section||'1')===(p.section||'1')&&(p.basis==='total'?r.amount.total:r.amount[p.basis||'labor'])!==0);
    selected=nearest?[nearest]:[];
   }
   if(p.kind==='subtotal'&&p.startRow){const start=Number(p.startRow)-1;if(!Number.isInteger(start)||start<0||start>=index)throw Error('ADD 시작 행은 소계보다 앞에 있는 행이어야 합니다.');selected=selected.filter(r=>r.index>=start);}
   if(![...costKeys,'components'].includes(p.target||'expense'))throw Error('계상 비목을 선택하세요.');
   const basis=cleanNumber(selected.reduce((n,r)=>n+(p.basis==='total'?r.amount.total:r.amount[p.basis||'labor']),0));
   const percent=p.kind==='subtotal'?100:evaluateFormula(String(p.percent??0),variables.values);if(percent<0&&!p.allowNegative)throw Error('잡비율은 0 이상이어야 합니다.');
   row.qty=percent;if(p.kind==='percent')row.percent=percent;row.basisValue=basis;row.amount=zero();
   if(p.kind==='subtotal'){
    for(const k of costKeys)if(p.basis==='total'||k===(p.basis||'labor'))row.amount[k]=selected.reduce((n,r)=>n+r.amount[k],0);
    row.amount.total=costKeys.reduce((n,k)=>n+row.amount[k],0);
   }else if(p.target==='components'){
    for(const k of costKeys)row.amount[k]=product(selected.reduce((n,r)=>n+r.amount[k],0),percent,0.01);
    row.amount.total=costKeys.reduce((n,k)=>n+row.amount[k],0);
   }else{row.amount[p.target||'expense']=product(basis,percent,0.01);row.amount.total=row.amount[p.target||'expense'];}
  }else{
   if(!String(p.qtyExpression??'').trim()&&cleanNumber(p.qty)===null)throw Error(`${p.name||'구성 항목'}: 수량을 확인하세요.`);
   row.qty=evaluateFormula(String(p.qtyExpression||(p.qty??0)),variables.values);if(row.qty<0)throw Error(`${p.name}: 수량은 0 이상이어야 합니다.`);
   row.amount=zero();for(const k of costKeys){const n=cleanNumber(p[k]??0);if(n===null||(n<0&&!p.allowNegative))throw Error(`${p.name}: ${k} 단가를 확인하세요.`);row[k]=n;row.amount[k]=p.qtyExpression?exact.truncateProduct(p.qtyExpression,p[k]??0,rowDigits):product(row.qty,n);}row.total=costKeys.reduce((n,k)=>n+row[k],0);row.amount.total=costKeys.reduce((n,k)=>n+row.amount[k],0);
  }
  if(manualCalculation(p))row.amount=manualAmounts(p);
  if(p.replaceRunning&&aggregateCalculation(p)){for(const k of costKeys)result[k]=0;}
  if(aggregateCalculation(p)&&p.kind!=='subtotal')for(const k of costKeys)result[k]+=row.amount[k];rows.push(row);
 }
 for(const k of costKeys)result[k]=truncateQuotient(result[k],divisor);
 result.total=costKeys.reduce((n,k)=>n+result[k],0);
 if(options.expenseOnly){result.expense=result.total;result.labor=result.material=result.other=0;}
 return {result,rows,variables:variables.rows,divisor};
}
export function chooseQuote(quotes,method='min',selected=0,manual=null){
 const valid=quotes.map(cleanNumber).filter(n=>n!==null&&n>=0);
 if(method==='manual'){const n=cleanNumber(manual);if(n===null||n<0)throw Error('입력 단가를 확인하세요.');return n;}
 if(method==='selected'){const n=cleanNumber(quotes[selected]);if(n===null||n<0)throw Error('선택한 조사단가가 없습니다.');return n;}
 if(!valid.length)throw Error('조사단가를 하나 이상 입력하세요.');
 if(method==='min')return Math.min(...valid);if(method==='max')return Math.max(...valid);if(method==='average')return valid.reduce((a,b)=>a+b,0)/valid.length;throw Error('단가 적용방법을 확인하세요.');
}
