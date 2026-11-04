const compact=s=>String(s||'').replace(/\s/g,'');
const fields=['NC','GC','JC','TC'];
const sum=rows=>Object.fromEntries(fields.map(k=>[k,rows.reduce((n,r)=>n+(r[k]||0),0)]));
const equal=(a,b)=>fields.every(k=>(a[k]||0)===(b[k]||0));

// Inspect source rows independently of the importer. Never create work or
// adjust money to make a stale stored subtotal agree with the detail rows.
export function inspectEstSource(rows){
 const issues=[];
 for(let i=0;i<rows.length;i++){
  const heading=rows[i];if(!(heading.Level>0)||!Number.isFinite(heading.TC))continue;
  const children=[];
  for(let j=i+1;j<rows.length;j++){
   const r=rows[j];
   if(r.Level>=heading.Level||r.LinkIndex===54||r.LinkIndex===58)break;
   if(!(r.Level>0)&&r.Name&&Number.isFinite(r.TC))children.push(r);
  }
  const calculated=sum(children);if(equal(heading,calculated))continue;
  issues.push({type:'sectionSubtotal',record:heading._record,name:heading.Name,level:heading.Level,stored:sum([heading]),calculated,childRecords:children.map(r=>r._record)});
 }
 const directIndex=rows.findIndex(r=>r.LinkIndex===54&&compact(r.Name)==='순공사비');
 if(directIndex>=0){const source=rows[directIndex],leaves=rows.slice(0,directIndex).filter(r=>!r.Level&&![54,58].includes(r.LinkIndex)&&r.Name&&Number.isFinite(r.TC)),calculated=sum(leaves);
  if(!equal(source,calculated))issues.push({type:'directSubtotal',record:source._record,name:source.Name,stored:sum([source]),calculated,childRecords:leaves.map(r=>r._record)});
 }
 return issues;
}

export function emptyEstMessage(rows=[]){
 const items=rows.filter(r=>r.Name&&r.GN>0&&Number.isFinite(r.TC)&&r.TC!==0);
 if(items.length)return `원본에 금액이 있는 품목 ${items.length}행은 남아 있지만 단가 코드·공종 연결 정보가 없습니다. 전체 공사와 산출근거를 복원할 수 없습니다. 정상 EST 원본 또는 수량산출서를 선택하세요.`;
 if(rows.length&&!rows.some(r=>r.Name?.trim()||r.Code||r.TC))return `원본 내역 ${rows.length}행이 비어 있고 사용할 수 있는 단가 자료도 없습니다. 다른 정상 원본이나 백업 파일을 선택하세요.`;
 return '사용할 수 있는 단가 테이블을 찾지 못했습니다.';
}
