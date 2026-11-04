const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8});
// Print the inputs actually used by these machines, never an internal DB dump.
export function machineBasisRows(nodes){
 const result=[],seen=new Set(),number=n=>displayNumber.format(Number(n));
 const add=(kind,subject,formula,value,source)=>{const row=[kind,subject,formula,value,source],key=JSON.stringify(row);if(!seen.has(key)){seen.add(key);result.push(row);}};
 for(const n of nodes){
  const title=[n.rate.name,n.rate.spec].filter(Boolean).join(' / ');
  const sources=n.printSources?.length?n.printSources.join(' / '):n.rate.source||'';
  // Directly entered machines have a verified machineryRate result instead of
  // an assembly calculation. Preserve those actual inputs without inventing
  // a DB source or incorrectly marking a valid calculation as unavailable.
  if(n.verified&&n.machine&&n.rate.machineInputs){
   const v=n.rate.machineInputs,source=n.rate.source||'직접 입력';
   add('기준가격',title,'장비 구입가격',number(v.price),source);
   add('적용 환율',title,'기준가격 × 환율',number(v.exchange),source);
   const scale=Number(v.ownershipScale??6),ownership=Number(v.ownership);
   add('손료계수',title,number(ownership)+' × 10^(-'+scale+')',number(ownership/10**scale),source);
   add('주연료',title,number(v.fuel)+' × '+number(v.fuelPrice),number(v.fuelPrice)+' 원/단위',source);
   add('잡유',title,'주연료비 × '+number(v.oilPercent)+'%',number(v.oilPercent)+'%',source);
   add('운전원',title,number(v.dailyWage)+' × '+number(v.workers)+' × '+number(v.operatorFactor??1)+' ÷ '+number(v.hours),number(v.dailyWage)+' 원/일',source);
   if(Number(v.misc))add('기타경비',title,'시간당 직접 입력',number(v.misc)+' 원',source);
   continue;
  }
  if(!n.verified||!n.calc){add('확인 필요',title,'산출 구성을 확인하지 못했습니다.','','');continue;}
  const included=p=>!n.printComponents||n.printComponents.some(k=>p.amount?.[k]);
  for(const p of n.calc.rows.filter(included)){
   if(p.machineOwnership){
    const ref=p.priceReference,meta=p.machineOwnership;
    const subject=n.calc.rows.filter(r=>r.machineOwnership&&included(r)).length>1&&meta.name?title+' · '+meta.name:title;
    add('손료계수',subject,number(meta.coefficient)+' × 10^(-7)',number(meta.coefficient/1e7),sources);
    if(ref?.exchangeRate!=null&&!['원','₩','￦','\\'].includes(ref.unit))add('적용 환율',ref.unit,'1 '+ref.unit+'당 원화',number(ref.exchangeRate)+' 원',ref.source||'');
   }
   for(const v of n.calc.variables||[]){
    if(!/^OP\d+$/.test(v.name)||!new RegExp('\\b'+v.name+'\\b').test(String(p.qtyExpression||'')))continue;
    add('운전원 보정',title,v.expression,number(v.value),sources);
   }
  }
 }
 return result;
}
