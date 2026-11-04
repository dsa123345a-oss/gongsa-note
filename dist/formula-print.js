const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
const keys=['labor','material','expense','other'];
const labels={labor:'노무비',material:'재료비',expense:'경비',other:'기타',total:'합계'};
const num=v=>displayNumber.format(Number(v||0));
export function formulaDisplayRows(calc){
 const out=[],variables=new Map(calc.variables.map(v=>[v.name,v.value]));
 const expression=s=>String(s??'').replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,k=>variables.has(k)?'('+String(variables.get(k))+')':k).replace(/\*/g,' × ').replace(/\//g,' ÷ ');
 for(const v of calc.variables){const literal=Number(String(v.expression).trim());out.push({text:`  ${v.name} = ${Number.isFinite(literal)&&literal===v.value?num(v.value):expression(v.expression)+' = '+num(v.value)}`});}
 const groupKey=p=>JSON.stringify([p.name,p.spec,p.code,p.source,p.library,p.section,p.qtyExpression??p.qty,p.componentDigits,p.calculationMode,p.exclude]);
 for(let i=0;i<calc.rows.length;i++){
  const p=calc.rows[i],parts=[p],seen=new Set([p.sourceComponent]);
  // EST exposes one equipment as separate cost projections. Join only adjacent,
  // explicitly disjoint projections of the same equipment and quantity formula.
  if(!p.kind&&keys.includes(p.sourceComponent))while(i+1<calc.rows.length){
   const next=calc.rows[i+1];
   if(next.kind||!keys.includes(next.sourceComponent)||seen.has(next.sourceComponent)||groupKey(next)!==groupKey(p))break;
   seen.add(next.sourceComponent);parts.push(next);i++;
  }
  out.push({text:`  ${p.name||labels[p.kind]||p.kind}${p.spec?' ('+p.spec+')':''}`,amount:p.kind?p.amount:undefined});
  if(p.kind==='percent')out.push({text:`    ${labels[p.basis]||p.basis||'합계'} ${num(p.basisValue)} × ${num(p.percent)}%`});
  else if(!p.kind)for(const part of parts)for(const k of keys)if(part[k]||part.amount[k]){
   const manual=['horizontal','both'].includes(part.calculationMode);
   out.push({text:manual?`    ${labels[k]}: 직접 입력 ${num(part.amount[k])}`:`    ${labels[k]}: ${num(part[k])} × (${expression(part.qtyExpression??part.qty)}) = ${num(part.amount[k])}`,amount:{[k]:part.amount[k],total:part.amount[k]}});
  }
 }
 return out;
}
