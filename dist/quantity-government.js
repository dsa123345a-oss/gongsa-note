import {extractQuantities} from './workbook.js';

const compact=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]/g,'');
function specKey(value){
 const text=compact(value).replace(/[φø∅]/g,'d');
 const diameter=text.match(/^(?:d|s)?(\d+(?:\.\d+)?)(?:mm|su|a)?$/);
 return diameter?'diameter:'+Number(diameter[1]):text;
}
const productKey=row=>JSON.stringify([compact(row.name),specKey(row.spec)]);
const rowKey=row=>JSON.stringify([productKey(row),compact(row.unit),row.qty===null?'unknown':row.qty,!!row.exclude]);
const isWork=row=>/설치|교체|부설|접합|철거|해체|천공|검사|시험|운반|보수|손료/.test(compact(row.name));
const report=()=>({added:0,corrected:0,sourceSheets:[],warnings:[]});

// The selected quantity sheet remains authoritative for its existing rows.
// Only explicitly grouped government materials are read from other sheets.
export function supplementGovernmentQuantities(sheets,selectedIndex,quantity=extractQuantities(sheets[selectedIndex])){
 if(!Array.isArray(sheets)||!Number.isInteger(selectedIndex)||!sheets[selectedIndex])throw Error('관급자재를 확인할 수량 시트를 선택하세요.');
 const result=structuredClone(quantity),meta=report();
 if(!Array.isArray(result.rows))throw Error('수량 시트의 내역을 확인하세요.');
 if(result.rows.some(row=>row.bucket==='government')){
  result.governmentSupplement=result.governmentSupplement||meta;
  return result;
 }
 result.governmentSupplement=meta;
 const byProduct=new Map();
 for(const [index,sheet] of sheets.entries()){
  if(index===selectedIndex)continue;
  let rows;
  try{rows=extractQuantities(sheet).rows.filter(row=>row.bucket==='government');}
  catch{meta.warnings.push(`${sheet.name||index+1+'번 시트'}의 관급자재를 읽지 못했습니다. 원본 시트를 확인하세요.`);return result;}
  if(!rows.length)continue;
  meta.sourceSheets.push(sheet.name);
  const products=new Map();
  for(const row of rows){const key=productKey(row);if(!products.has(key))products.set(key,[]);products.get(key).push(row);}
  for(const [key,items] of products){
   const signature=items.map(rowKey).sort().join('\n'),previous=byProduct.get(key);
   if(previous&&previous.signature!==signature){
    meta.warnings.push(`${items[0].name} (${items[0].spec||'규격 없음'}): ${previous.sheet}와 ${sheet.name}의 관급 수량·단위 또는 행 개수가 다릅니다. 관급자재를 자동 보충하지 않았습니다.`);
   }else if(!previous)byProduct.set(key,{signature,rows:items,sheet:sheet.name});
  }
 }
 meta.sourceSheets=[...new Set(meta.sourceSheets)];
 if(meta.warnings.length)return result;
 const additions=[...byProduct.values()].flatMap(entry=>entry.rows),used=new Set(),corrections=[];
 for(const row of additions){
  const matches=result.rows.map((current,index)=>({current,index})).filter(({current,index})=>!used.has(index)&&!isWork(current)&&rowKey(current)===rowKey(row));
  if(matches.length>1){
   meta.warnings.push(`${row.name} (${row.spec||'규격 없음'}): 선택한 시트에 같은 자재가 여러 행 있어 관급 행을 구분하지 못했습니다. 관급자재를 자동 보충하지 않았습니다.`);
   return result;
  }
  if(matches.length){const index=matches[0].index;used.add(index);corrections.push({index,row});}
 }
 for(const {index,row} of corrections){
  const current=result.rows[index];
  // Keep the chosen sheet's original quantity, formulas, source cells and ID.
  result.rows[index]={...current,bucket:'government',group:row.group,governmentSupplement:{source:row.source,previousBucket:current.bucket,previousGroup:current.group}};
  meta.corrected++;
 }
 const correctedRows=new Set(corrections.map(entry=>entry.row));
 for(const row of additions){
  if(correctedRows.has(row))continue;
  result.rows.push(structuredClone(row));meta.added++;
 }
 const unknown=additions.filter(row=>row.qty===null);
 if(unknown.length)meta.warnings.push(`관급자재 ${unknown.length}행의 수량 수식이 미계산입니다. 행과 원본 수식은 가져왔으며 수량을 확인해야 합니다.`);
 return result;
}
