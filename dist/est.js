// Read-only EST/DBISAM importer. Only the observed, validated field layout is supported.
import {decodeCp949} from './cp949.js';
import {emptyEstMessage} from './est-source-checks.js';
import {readEstMemo} from './est-memo.js';
const korean = {decode:decodeCp949};
const utf8 = new TextDecoder();
export const TABLES = {
  StuffcDat: '자재', LaborcDat: '노임', MachTitleDat: '장비',
  CostTitleDat: '단가산출', HeadTitleDat: '일위대가', EstMainDat: '내역단가', SilJukDat: '표준시장단가'
};
export const TABLE_LABELS={...TABLES,EstMainDat:'내역서·안내문',CostMainDat:'단가산출 구성·산식',HeadMainDat:'일위대가 구성·산식',MachMainDat:'기계경비 구성·산식',MachGijunDat:'기계경비 적용기준',MulTitleDat:'수량산출 목록',MulMainDat:'수량산출 자료',EstiMateDat:'견적 자료',CadMainDat:'도면 자료',CadTitleDat:'도면 목록',GridHeaderInfo:'표 머리글',OtherTables:'기타 설정 자료',WongaDat:'원가계산 자료',DongWon:'동원 자료'};
export function readTable(bytes, selectedFields=null, blob=null) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if(bytes.length < 512) throw Error('데이터 파일의 헤더가 짧습니다.');
  const count=v.getUint16(47,true), size=v.getUint16(45,true), declared=v.getUint32(41,true);
  const start=512+count*768;
  if(!count || count>512 || size<26 || start>bytes.length || (bytes.length-start)%size) throw Error('지원하지 않는 EST 데이터 구조입니다.');
  const physical=(bytes.length-start)/size;
  if(physical>500000 || declared>physical) throw Error('데이터 행 수가 올바르지 않습니다.');
  const fields=[];
  for(let i=0;i<count;i++) {
    const p=512+i*768, len=bytes[p+2], type=v.getUint16(p+164,true), width=v.getUint16(p+166,true), offset=v.getUint16(p+172,true)+1;
    if(len>162 || v.getUint16(p,true)!==i+1) throw Error('필드 정의를 읽을 수 없습니다.');
    const name=utf8.decode(bytes.subarray(p+3,p+3+len));
    const length=type===1?width+1:[7,5383,11,5635].includes(type)?8:[6,7430,2].includes(type)?4:type===5?2:type===4?1:0;
    if(offset<1 || offset+length>size) throw Error('필드 위치가 데이터 범위를 벗어났습니다.');
    fields.push({name,type,width,offset,length});
  }
  const rows=[],memoWarnings=[];
  for(let i=0;i<physical;i++) {
    const p=start+i*size;
    if(bytes[p]!==0)continue;
    const row={_record:i};
    for(const f of fields) {
      if(selectedFields && !selectedFields.has(f.name))continue;
      const o=p+f.offset;
      if(f.type!==4 && bytes[o-1]===0){row[f.name]=null;continue;}
      if(f.type===1){const b=bytes.subarray(o,o+f.length);const end=b.indexOf(0);row[f.name]=korean.decode(end<0?b:b.subarray(0,end));}
      else if(f.type===7 || f.type===5383){const n=v.getFloat64(o,true);row[f.name]=Number.isFinite(n)?n:null;}
      else if(f.type===6)row[f.name]=v.getInt32(o,true);
      else if(f.type===7430)row[f.name]=v.getUint32(o,true);
      else if(f.type===5)row[f.name]=v.getInt16(o,true);
      else if(f.type===4)row[f.name]=!!bytes[o];
      else if(f.type===5635){try{row[f.name]=readEstMemo(blob,v.getUint32(o,true),v.getUint32(o+4,true));}catch(e){memoWarnings.push({record:i,field:f.name,reason:e.message});}}
    }
    rows.push(row);
  }
  if(rows.length!==declared)throw Error(`행 수 검증 실패: 헤더 ${declared}, 실제 ${rows.length}`);
  return {rows,fields,declared,rowSize:size,...(memoWarnings.length?{memoWarnings}:{})};
}
export async function unzip(input, inflate) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let end=-1;
  for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--)if(v.getUint32(p,true)===0x06054b50){end=p;break;}
  if(end<0)throw Error('ZIP 기반 EST 또는 XLSX 파일이 아닙니다.');
  const count=v.getUint16(end+10,true);let p=v.getUint32(end+16,true), total=0;const files=new Map();
  if(count>3000)throw Error('압축 항목이 너무 많습니다.');
  for(let i=0;i<count;i++) {
    if(p+46>bytes.length || v.getUint32(p,true)!==0x02014b50)throw Error('압축 목록이 손상되었습니다.');
    const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),cs=v.getUint32(p+20,true),us=v.getUint32(p+24,true),nl=v.getUint16(p+28,true),el=v.getUint16(p+30,true),cl=v.getUint16(p+32,true),loc=v.getUint32(p+42,true);
    const name=utf8.decode(bytes.subarray(p+46,p+46+nl));p+=46+nl+el+cl;
    if(flags&1)throw Error('암호로 보호된 압축 파일은 지원하지 않습니다.');
    total+=us;if(total>300*1024*1024)throw Error('압축 해제 크기가 300MB를 넘습니다.');
    if(loc+30>bytes.length || v.getUint32(loc,true)!==0x04034b50)throw Error('압축 데이터 위치가 잘못되었습니다.');
    const start=loc+30+v.getUint16(loc+26,true)+v.getUint16(loc+28,true);
    if(start+cs>bytes.length)throw Error('압축 데이터가 잘렸습니다.');
    files.set(name,{method,us,crc,bytes:bytes.subarray(start,start+cs)});
  }
  return {names:[...files.keys()],async read(name){
    const f=files.get(name);if(!f)return null;
    let b;
    if(f.method===0)b=f.bytes;
    else if(f.method===8){
      if(inflate)b=new Uint8Array(await inflate(f.bytes));
      else {const stream=new Blob([f.bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));b=new Uint8Array(await new Response(stream).arrayBuffer());}
    }else throw Error('지원하지 않는 압축 방식입니다.');
    if(b.length!==f.us || crc32(b)!==f.crc)throw Error('압축 파일 무결성 검사에 실패했습니다.');
    return b;
  }};
}
export async function importEst(input, filename, inflate) {
  const zip=await unzip(input,inflate), id=crypto.randomUUID(), items=[], stats=[], details=new Map(), projectRows=[],chargeHints=[],tables=[],archiveFiles=zip.names;
  const cache=new Map();
  for(const name of zip.names.filter(n=>/\.dat$/i.test(n))){
    try{const blobName=zip.names.find(n=>n.toLowerCase()===name.replace(/\.dat$/i,'.blb').toLowerCase());const t=readTable(await zip.read(name),null,blobName?await zip.read(blobName):null);for(const r of t.rows)for(const k of Object.keys(r))if(r[k]===null)delete r[k];cache.set(name.toLowerCase(),t);tables.push({name,label:TABLE_LABELS[name.replace(/\.dat$/i,'')]||name,fields:t.fields,rows:t.rows,...(t.memoWarnings?{memoWarnings:t.memoWarnings}:{})});}
    catch(e){tables.push({name,label:name,fields:[],rows:[],error:e.message});}
  }
  for(const [table,category] of Object.entries(TABLES)) {
    const t=cache.get((table+'.dat').toLowerCase());if(!t)continue;
    stats.push({table,category,count:t.rows.length});
    let group='';
    for(const r of t.rows) {
      if(table==='EstMainDat' && !r.Code){if(r.Level===1)group=r.Name||'';if(r.Unite==='%'&&r.Name)chargeHints.push({name:r.Name,rate:r.GN});continue;}
      if(!r.Code || !r.Name?.trim())continue;
      const project=table==='EstMainDat';
      if(project && (r.Level||0)!==0)continue;
      const total=project?r.TU:r.TC;
      if(total==null || !Number.isFinite(total))continue;
      let labor=table==='LaborcDat'?total:Number(project?r.NU:r.NC)||0;
      let material=table==='StuffcDat'?total:Number(project?r.GU:r.GC)||0;
      let expense=Number(project?r.JU:r.JC)||0;
      // Preserve the imported total and any unclassified remainder explicitly.
      const other=Number((total-labor-material-expense).toFixed(8));
      const item={id:`${id}:${table}:${r._record}`,library:id,category,table,record:r._record,code:r.Code,name:r.Name.trim(),spec:(r.Size||'').trim(),unit:(r.Unite||'').trim(),total,labor,material,expense,other,group,source:filename,prices:Array.from({length:6},(_,i)=>r['Cost'+(i+1)]??null),quotePages:Array.from({length:6},(_,i)=>r['Page'+(i+1)]??''),remark:r.Remark??'',sourceQuantity:project?r.GN:null,sourceAmount:project?r.TC:null,government:r.Gangub===2};
      if(typeof r.Bigo==='string')item.bigo=r.Bigo;
      else if(!t.memoWarnings?.some(w=>w.record===r._record&&w.field==='Bigo'))item.bigo='';
      items.push(item);if(project)projectRows.push(item);
    }
  }
  if(!items.length)throw Error(emptyEstMessage(cache.get('estmaindat.dat')?.rows));
  // Keep assembly rows with their original fields; no guessed recalculation.
  for(const name of ['HeadMainDat','CostMainDat','MachMainDat']) {
    const rows=cache.get((name+'.dat').toLowerCase())?.rows;if(!rows)continue;let parent='';
    for(const r of rows){if(r.TitleCode)parent=r.TitleCode;if(!parent)continue;const key=name+':'+parent;if(!details.has(key))details.set(key,[]);details.get(key).push(r);}
  }
  const basis=cache.get('machgijundat.dat')?.rows;if(basis)for(const i of items)if(i.table==='MachTitleDat')i.machineBasis=basis;
  const info=await zip.read('ProjectDataInfo.Ini');
  const ini=info?korean.decode(info):'';
  const version=/DataVersion=(.*)/.exec(ini)?.[1]?.trim()||'미상';
  const sourceLabels=Array.from({length:6},(_,i)=>new RegExp('TitleName'+(i+1)+'=(.*)').exec(ini)?.[1]?.trim()||`단가 ${i+1}`);
  return {id,name:filename,version,items,stats,details:[...details],projectRows,chargeHints,sourceLabels,tables,archiveFiles,originalBytes:input instanceof Uint8Array?input:new Uint8Array(input),importedAt:new Date().toISOString(),estMetadataVersion:1};
}
let crcTable;
export function crc32(bytes){if(!crcTable)crcTable=Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});let c=0xffffffff;for(const b of bytes)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
export function zipStore(entries){
  const enc=new TextEncoder(),locals=[],centrals=[];let offset=0;
  const block=(len)=>{const b=new Uint8Array(len);return[b,new DataView(b.buffer)];};
  for(const [name,value]of Object.entries(entries)){
    const n=enc.encode(name),data=typeof value==='string'?enc.encode(value):value,crc=crc32(data);
    const [h,v]=block(30+n.length);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,data.length,true);v.setUint32(22,data.length,true);v.setUint16(26,n.length,true);h.set(n,30);locals.push(h,data);
    const[c,w]=block(46+n.length);w.setUint32(0,0x02014b50,true);w.setUint16(4,20,true);w.setUint16(6,20,true);w.setUint16(8,0x800,true);w.setUint32(16,crc,true);w.setUint32(20,data.length,true);w.setUint32(24,data.length,true);w.setUint16(28,n.length,true);w.setUint32(42,offset,true);c.set(n,46);centrals.push(c);offset+=h.length+data.length;
  }
  const centralSize=centrals.reduce((s,b)=>s+b.length,0),[e,w]=block(22);w.setUint32(0,0x06054b50,true);w.setUint16(8,centrals.length,true);w.setUint16(10,centrals.length,true);w.setUint32(12,centralSize,true);w.setUint32(16,offset,true);
  const result=new Uint8Array(offset+centralSize+22);let p=0;for(const b of [...locals,...centrals,e]){result.set(b,p);p+=b.length;}return result;
}
