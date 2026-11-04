import {unzip,readTable,zipStore} from './est.js';
// Prototype for compatibility verification. Keep indexes, blobs and all unknown
// bytes byte-identical. This is not exposed as a supported project-save command.
export function patchEstNumbers(input,changes){
 const bytes=new Uint8Array(input),table=readTable(bytes),view=new DataView(bytes.buffer),start=512+table.fields.length*768;
 const allowed=new Set(['GN','NU','GU','JU','SU','TU','NC','GC','JC','SC','TC']);
 const rows=new Map(table.rows.map(r=>[r._record,r]));
 for(const change of changes){
  const row=rows.get(change.record);if(!row||row.PkID!==change.pk)throw Error('EST 원본 행이 변경되었습니다.');
  for(const [name,value]of Object.entries(change.values)){
   const field=table.fields.find(f=>f.name===name);
   if(!allowed.has(name)||field?.type!==7||!Number.isFinite(value)||Math.abs(value)>1e14)throw Error('검증되지 않은 EST 쓰기 필드입니다: '+name);
   const at=start+change.record*table.rowSize+field.offset;bytes[at-1]=1;view.setFloat64(at,value,true);
  }
 }
 const verified=readTable(bytes);
 for(const c of changes){const r=verified.rows.find(r=>r._record===c.record);for(const [k,v]of Object.entries(c.values))if(r[k]!==v)throw Error('EST 저장값 재읽기 검증 실패');}
 return bytes;
}
export async function writeEstVerificationCopy(original,changes,inflate){
 const zip=await unzip(original,inflate),entries={};if(!zip.names.includes('EstMainDat.dat'))throw Error('EST 내역 테이블이 없습니다.');
 for(const name of zip.names){if(name==='__proto__'||name==='constructor')throw Error('지원하지 않는 압축 항목');entries[name]=await zip.read(name);}
 entries['EstMainDat.dat']=patchEstNumbers(entries['EstMainDat.dat'],changes);
 return zipStore(entries);
}
