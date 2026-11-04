import {unzip,readTable} from './est.js';
import {decodeCp949} from './cp949.js';

// Observed DBISAM BLOB chains and Delphi value streams. Read data only; no
// vendor code is loaded. Unknown tags/layouts fail instead of shifting fields.
export function readValueTable(bytes){
 const b=bytes,v=new DataView(b.buffer,b.byteOffset,b.byteLength);let p=4,nodes=0;
 const take=n=>{if(n<0||p+n>b.length)throw Error('원가 데이터가 잘렸습니다.');const a=b.subarray(p,p+n);p+=n;return a;};
 const integer=n=>{const a=take(n);return new DataView(a.buffer,a.byteOffset,n)[n===1?'getInt8':n===2?'getInt16':'getInt32'](0,true);};
 const string=a=>{try{return new TextDecoder('utf-8',{fatal:true}).decode(a);}catch{return decodeCp949(a);}};
 if(new TextDecoder().decode(b.subarray(0,4))!=='TPF0')throw Error('지원하지 않는 원가 저장 형식입니다.');
 function value(depth=0){
  if(++nodes>200000||depth>10)throw Error('원가 데이터가 너무 큽니다.');const t=integer(1);
  if(t===0)return null;
  if(t===1){const a=[];while(p<b.length&&b[p]!==0)a.push(value(depth+1));take(1);return a;}
  if([2,3,4].includes(t))return integer({2:1,3:2,4:4}[t]);
  if(t===5){take(10);const lo=v.getUint32(p-10,true),hi=v.getUint32(p-6,true),e=v.getUint16(p-2,true);const n=(hi*2**32+lo)*2**((e&32767)-16383-63)*(e&32768?-1:1);if(!Number.isFinite(n))throw Error('원가 숫자가 올바르지 않습니다.');return n;}
  if(t===6||t===7){const len=take(1)[0];return string(take(len));}
  if(t===8||t===9)return t===9;
  if([10,12,18,20].includes(t)){const len=integer(4);const a=take(len*(t===18?2:1));return t===10?null:t===18?new TextDecoder('utf-16le').decode(a):string(a);}
  throw Error('지원하지 않는 원가 값 형식: '+t);
 }
 const all=[];while(p<b.length)all.push(value());
 if(all.length!==5||!Array.isArray(all[1])||all[1].length%10||!Array.isArray(all[4]))throw Error('원가 테이블 정의를 확인할 수 없습니다.');
 const names=all[1].filter((_,i)=>i%10===0);if(names.length>200||all[3]?.[0]!==names.length)throw Error('원가 필드 수가 다릅니다.');
 return all[4].map(a=>{let i=1;const row={};for(const name of names){const missing=a[i++];if(typeof missing!=='boolean')throw Error('원가 행 정의가 다릅니다.');if(!missing)row[name]=a[i++];}if(i!==a.length)throw Error('원가 행 길이가 다릅니다.');return row;});
}

export async function readEstCostTables(input,inflate){
 const zip=await unzip(input,inflate),find=n=>zip.names.find(x=>x.toLowerCase()===n.toLowerCase());
 const dn=find('WongaDat.dat'),bn=find('WongaDat.blb');if(!dn||!bn)return [];
 const dat=await zip.read(dn),blob=await zip.read(bn),table=readTable(dat),field=table.fields.find(f=>f.name==='BLOB'&&f.type===3);
 if(!field)throw Error('원가 자료 연결 필드가 없습니다.');
 const dv=new DataView(dat.buffer,dat.byteOffset,dat.byteLength),bv=new DataView(blob.buffer,blob.byteOffset,blob.byteLength),out=[];
 for(const row of table.rows){
  const offset=512+table.fields.length*768+row._record*table.rowSize+field.offset;
  let block=dv.getUint32(offset,true),previous=0;const seen=new Set(),chunks=[];let length=0;
  while(block){
   const p=block*512;if(seen.has(block)||p+512>blob.length)throw Error('원가 데이터 연결이 손상되었습니다.');seen.add(block);
   if(bv.getUint32(p,true)!==previous)throw Error('원가 데이터 순서가 손상되었습니다.');
   const size=bv.getUint16(p+8,true);if(size>494)throw Error('원가 데이터 블록 크기가 잘못되었습니다.');
   chunks.push(blob.subarray(p+18,p+18+size));length+=size;previous=block;block=bv.getUint32(p+4,true);
  }
  if(!length)continue;const compressed=new Uint8Array(length);let p=0;for(const c of chunks){compressed.set(c,p);p+=c.length;}
  let raw;if(inflate)raw=new Uint8Array(await inflate(compressed.subarray(2,-4)));else raw=new Uint8Array(await new Response(new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  if(raw.length>16*1024*1024)throw Error('원가 자료가 너무 큽니다.');
  let a=1,b=0;for(const n of raw){a=(a+n)%65521;b=(b+a)%65521;}const checksum=new DataView(compressed.buffer).getUint32(compressed.length-4,false);
  if((((b<<16)|a)>>>0)!==checksum)throw Error('원가 압축 자료 검증에 실패했습니다.');
  out.push({index:row.Index,rows:readValueTable(raw)});
 }
 return out;
}
