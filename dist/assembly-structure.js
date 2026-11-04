// ADD references follow their original start row when preceding rows are removed.
export function removeAssemblyPart(parts,index){
 if(!Number.isInteger(index)||index<0||index>=parts.length)throw Error('삭제할 구성 행을 확인하세요.');
 const next=structuredClone(parts);next.splice(index,1);
 for(const p of next){if(p.kind!=='subtotal'||!p.startRow)continue;const start=Number(p.startRow)-1;
  if(start===index)p.startRowInvalid=true;else if(start>index)p.startRow=Number(p.startRow)-1;
 }return next;
}
