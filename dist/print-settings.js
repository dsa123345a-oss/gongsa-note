// Only bounded numeric values and fixed CSS tokens may enter printed styles.
export function printSettings(value={}){
 const number=(key,fallback,min,max)=>{const v=Number(value[key]??fallback);if(!Number.isFinite(v)||v<min||v>max)throw Error('출력 설정 범위를 확인하세요: '+key);return v;};
 const result={startPage:number('startPage',1,1,99999),breakRows:String(value.breakRows||'').split(/[ ,]+/).filter(Boolean).map(Number),size:number('size',10,7,20),margin:number('margin',12,5,30),rowPadding:number('rowPadding',5,1,12),level:number('level',0,0,10),orientation:value.orientation==='portrait'?'portrait':'landscape',evidenceNewPage:value.evidenceNewPage===true,groupNewPage:value.groupNewPage===true,documents:{}};
 if(!Number.isInteger(result.startPage)||result.breakRows.some(n=>!Number.isInteger(n)||n<1||n>10000))throw Error('시작 페이지와 페이지를 나눌 행은 양의 정수입니다.');
 if(!Number.isInteger(result.level))throw Error('출력 레벨은 정수로 입력하세요.');
 for(const [key,v] of Object.entries(value.documents||{})){
  const size=Number(v.size||result.size),rowPadding=Number(v.rowPadding||result.rowPadding);
  if(!Number.isFinite(size)||size<7||size>20||!Number.isFinite(rowPadding)||rowPadding<1||rowPadding>12)throw Error('문서별 글자는 7~20pt, 행 여유는 1~12px입니다.');
  result.documents[key]={size,rowPadding};
 }
 return result;
}
// EST's larger level number denotes the higher-level aggregate.
export function printedLines(lines,level=0){return lines.filter(l=>!l.exclude&&(!level||(l.level&&l.level>=level)));}
