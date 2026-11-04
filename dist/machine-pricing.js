import {norm} from './calc.js';
const spec=s=>String(s||'').normalize('NFKC').replace(/\s/g,'');
const wonUnit=u=>['\\','₩','원','KRW'].includes(String(u||'').normalize('NFKC').trim().toUpperCase());

export function machineExchangeRate(row,basis=[]){
 // EST can omit the zero-valued Ratio for a price explicitly stored in won.
 // Missing foreign-currency ratios must never match an unindexed basis row.
 if(row.Ratio===0)return 1;
 if(row.Ratio===undefined)return wonUnit(row.Unite)?1:undefined;
 if(!Number.isInteger(row.Ratio))return undefined;
 return basis.find(r=>r.Index===row.Ratio)?.TC;
}

// Replace monetary inputs only. Ownership coefficients, operating factors,
// fuel consumption, quantities and rounding remain those of the source recipe.
export function repriceMachineOwnership(assembly,machine,sourceRows,target,master){
 const changes=[],issues=[],rows=master?.details?.find(([k])=>k==='MachMainDat:'+target?.code)?.[1]||[];
 const ownership=rows.filter(r=>r.Index===-3&&!r.TitleCode);
 const basis=master?.tables?.find(t=>t.name.toLowerCase()==='machgijundat.dat')?.rows||[];
 for(const part of assembly.components){
  const source=sourceRows?.find(r=>r._record===part.originalRecord);
  if(source?.Index!==-3&&!part.machineOwnership){
   if(!part.kind&&!part.exclude&&(part.sourceComponent==='expense'||part.expense))issues.push({resource:machine,reason:'장비 손료의 원본 행 근거가 없습니다.'});
   continue;
  }
  if(part.kind||part.exclude||['horizontal','both'].includes(part.calculationMode))continue;
  const meta=part.machineOwnership||{name:source.Name,spec:source.Size||'',coefficient:source.GN,currencyRatio:source.Ratio};
  try{
   const matches=ownership.filter(r=>norm(r.Name)===norm(meta.name)&&spec(r.Size)===spec(meta.spec));
   if(matches.length!==1)throw Error('장비 기준가격의 '+meta.name+' 항목을 하나로 확인할 수 없습니다.');
   const selected=matches[0],fx=machineExchangeRate(selected,basis);
   if(!Number.isFinite(selected.TU)||selected.TU<0||!Number.isFinite(fx)||fx<=0)throw Error('장비 기준가격 또는 환율이 없습니다.');
   const variable=meta.fxVariable||String(part.qtyExpression||'').match(/\bFX\d+\b/)?.[0];
   if(!variable||!/^FX\d+$/.test(variable))throw Error('손료 산식의 환율 변수를 확인할 수 없습니다.');
   const pattern=new RegExp('^'+variable+'\\s*=.*$','m');
   if(!pattern.test(assembly.calculation?.variables||''))throw Error('손료 산식의 환율 기준이 없습니다.');
   const previous=assembly.calculation.variables.match(pattern)[0];
   assembly.calculation.variables=assembly.calculation.variables.replace(pattern,()=>variable+' = '+fx);
   changes.push({name:machine.name+' · '+meta.name+' 기준가격',spec:machine.spec,category:'장비',before:part.expense,after:selected.TU,source:master.name,code:target.code,currency:wonUnit(selected.Unite)?'원':selected.Unite,exchangeRate:fx,previousExchange:previous});
   part.expense=selected.TU;part.total=part.expense;part.unit=selected.Unite||part.unit;
   part.machineOwnership={...meta,fxVariable:variable,currencyRatio:selected.Ratio};
   part.priceReference={source:master.name,library:master.id,table:'MachMainDat',record:selected._record,code:target.code,name:machine.name+' · '+selected.Name,spec:machine.spec,unit:selected.Unite,total:selected.TU,expense:selected.TU,exchangeRate:fx};
  }catch(e){issues.push({resource:machine,reason:e.message});}
 }
 return {changes,issues};
}
