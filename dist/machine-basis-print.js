const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8});
// Print the inputs actually used by these machines, never an internal DB dump.
export function machineBasisRows(nodes){
 const result=[],seen=new Set(),number=n=>displayNumber.format(Number(n));
 const add=(kind,subject,formula,value,source)=>{const row=[kind,subject,formula,value,source],key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);result.push(row);}};
 for(const n of nodes){
  const title=[n.rate.name,n.rate.spec].filter(Boolean).join(' / ');
  if(!n.verified||!n.calc){add('확인 필요',title,'산출 구성을 확인하지 못했습니다.','','');continue;}
  const included=p=>!n.printComponents||n.printComponents.some(k=>p.amount?.[k]);
  for(const p of n.calc.rows.filter(included)){
   if(p.machineOwnership){
    const ref=p.priceReference,meta=p.machineOwnership;
    const subject=n.calc.rows.filter(r=>r.machineOwnership&&included(r)).length>1&&meta.name?title+' · '+meta.name:title;
    add('손료계수',subject,number(meta.coefficient)+' × 10^(-7)',number(meta.coefficient/1e7),n.rate.source||'');
    if(ref?.exchangeRate!=null&&!['원','₩','￦','\\'].includes(ref.unit))add('적용 환율',ref.unit,'1 '+ref.unit+'당 원화',number(ref.exchangeRate)+' 원',ref.source||'');
   }
   for(const v of n.calc.variables||[]){
    if(!/^OP\d+$/.test(v.name)||!new RegExp('\\b'+v.name+'\\b').test(String(p.qtyExpression||'')))continue;
    add('운전원 보정',title,v.expression,number(v.value),n.rate.source||'');
   }
  }
 }
 return result;
}
