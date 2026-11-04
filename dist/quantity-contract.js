// Generator metadata identifies a DB item, never a price or a quantity.
import {workConnectionJoints} from './work-connection-joints.js';
const SHEET='_공사노트연동',MAGIC='gongsa.quantity.v1';
const fields=['name','spec','unit'],same=(a,b)=>fields.every(k=>String(a?.[k]??'').trim()===String(b?.[k]??'').trim());
const address=/^[A-Z]{1,3}[1-9]\d{0,6}$/;
const identity=x=>x&&typeof x==='object'&&!Array.isArray(x)&&fields.every(k=>typeof x[k]==='string');
const allowanceValid=a=>a&&a.basis==='all-components'&&Number.isFinite(a.percent)&&a.percent>0&&a.percent<=30&&Number.isFinite(a.targetQuantity)&&a.targetQuantity>0&&Number.isFinite(a.targetTotalQuantity)&&a.targetTotalQuantity>=a.targetQuantity&&typeof a.reason==='string'&&a.reason.trim()&&Array.isArray(a.targetKeys)&&a.targetKeys.length&&new Set(a.targetKeys).size===a.targetKeys.length&&Array.isArray(a.targetIdentities)&&a.targetIdentities.length===a.targetKeys.length&&a.targetIdentities.every(t=>identity(t)&&/KP.*접합.*부설/i.test(t.name)&&!t.spec.includes('이탈방지압륜'));
function cell(sheet,ref){const row=sheet.rows.find(r=>r.index===Number(ref.match(/\d+/)?.[0]));return row?.cells[ref.replace(/\d+/g,'')]?.value??'';}
export function readQuantityContracts(sheets){
 const meta=sheets.find(s=>s.name===SHEET);if(!meta)return sheets;
 const targets=sheets.filter(s=>s!==meta),valid=cell(meta,'A1')===MAGIC;
 let header;try{header=JSON.parse(cell(meta,'A2'));}catch{}
 if(!valid||header?.schema!==1){for(const s of targets)s.quantityContractError='수량산출서 DB 연결정보 형식을 확인하세요.';return targets;}
 const joints=workConnectionJoints(header.workConnectionJoints);
 for(const sheet of targets)sheet.workConnectionJoints=structuredClone(joints);
 for(const row of meta.rows.filter(r=>r.index>=4)){
  const raw=row.cells.A?.value;if(!raw)continue;
  let record;try{record=JSON.parse(raw);}catch{for(const s of targets)s.quantityContractError='수량산출서 DB 연결정보를 읽지 못했습니다.';continue;}
  const sheet=targets.find(s=>s.name===record?.sheet);
  if(!sheet||!record.refs||!['name','spec','unit','qty'].every(k=>address.test(record.refs[k]||''))){for(const s of targets)s.quantityContractError='수량산출서 DB 연결 셀을 확인하세요.';continue;}
  const key=`${sheet.name}!${record.refs.name} / ${record.refs.qty}`;
  sheet.quantityContracts??=new Map();
  const visible=Object.fromEntries(fields.map(k=>[k,cell(sheet,record.refs[k])]));
  const target=record.target;
  const conditional=record.status==='conditional'&&visible.name==='이탈방지압륜 가산'&&visible.unit==='%'&&allowanceValid(record.allowance)&&Number(cell(sheet,record.refs.qty))===record.allowance.percent;
  const state=sheet.quantityContracts.has(key)?'duplicate':!identity(record.expected)?'invalid':!same(visible,record.expected)?'changed':conditional?'conditional':record.status==='unresolved'?'unresolved':record.status==='linked'&&identity(target)&&typeof target.source==='string'&&typeof target.code==='string'&&same(target,record.expected)?'linked':'invalid';
  sheet.quantityContracts.set(key,{state,catalogVersion:header.catalogVersion,expected:record.expected,visible,
   target:state==='linked'?Object.fromEntries(['source','code','name','spec','unit','kind'].map(k=>[k,target[k]])):null,
   ...(state==='conditional'?{allowance:structuredClone(record.allowance)}:{})});
 }
 return targets;
}
export function attachQuantityContracts(sheet,rows){
 for(const line of rows){
  const record=sheet.quantityContracts?.get(line.source);
  // A merged name can occupy the nominal specification column. The generator
  // records the real specification box; use its current visible value only.
  if(record?.visible&&!line.spec&&String(line.name).trim()===String(record.visible.name).trim()&&String(line.unit).trim()===String(record.visible.unit).trim())line.spec=String(record.visible.spec??'');
  if(record)line.dbReference=structuredClone(record);
  if(sheet.quantityContractError)line.dbReference={state:'invalid'};
  if(line.dbReference&& !['linked','conditional'].includes(line.dbReference.state)){
   const reason=line.dbReference.state==='unresolved'?'수량산출서에서 DB 품목 미선택':'수량산출서의 DB 연결정보와 현재 입력이 다름';
   line.note=[line.note,reason+' · 직접 확인 후 연결'].filter(Boolean).join(' / ');
  }
 }
 for(const line of rows){
  const a=line.dbReference?.allowance;if(line.dbReference?.state!=='conditional'||!a)continue;
  const targets=a.targetKeys.map(key=>rows.find(r=>r.source===key));
  if(targets.some((r,i)=>!r||!same(r,a.targetIdentities[i])||r.dbReference?.state!=='linked')||targets.some(r=>rows.indexOf(r)>=rows.indexOf(line))||Math.abs(targets.reduce((n,r)=>n+Number(r.qty),0)-a.targetTotalQuantity)>1e-8){line.dbReference={state:'invalid'};line.note='압륜 가산 대상 KP 품·수량·순서를 확인하세요.';continue;}
  line.surcharge={scope:'selected',basis:'total',target:'components',sourceIds:targets.map(r=>r.id),includeSurcharges:false,kpAllowance:{targetMaterialId:a.targetMaterialId||'',quantity:a.targetQuantity,totalQuantity:a.targetTotalQuantity,identities:targets.map(r=>({id:r.id,...Object.fromEntries(fields.map(k=>[k,r[k]]))})),reason:a.reason}};
  line.factor=.01;line.note=`대상 KP ${a.targetQuantity}본 · 비목별 ${a.percent}% · ${a.reason}`;
 }
 return rows;
}
export function referencedQuantityRate(line,entries){
 const ref=line.dbReference;if(!ref)return null;
 if(ref.state!=='linked'||!identity(ref.expected)||!identity(ref.target)||!same(line,ref.expected)||!same(ref.target,ref.expected))return {reason:ref.state==='unresolved'?'수량산출서에서 선택하지 않은 품목 · 직접 확인 후 연결':'수량산출서 품명·규격·단위 변경 또는 연결정보 오류 · 직접 확인 후 연결'};
 const t=ref.target;
 const matches=entries.filter(({item,source})=>source===t.source&&item.code===t.code&&same(item,t)&&['labor','material','expense','other','total'].every(k=>Number.isFinite(item[k]))&&['labor','material','expense','total'].every(k=>item[k]>=0));
 const prices=new Set(matches.map(({item})=>JSON.stringify(['labor','material','expense','other','total'].map(k=>item[k]))));
 if(!matches.length)return {reason:'수량산출서에서 선택한 DB 품목이 현재 DB에 없음 · DB 자료 확인'};
 if(prices.size!==1)return {reason:'선택한 DB 품목의 단가가 여러 개 · 직접 확인 후 연결'};
 matches.sort((a,b)=>Number(b.item.table==='EstMainDat')-Number(a.item.table==='EstMainDat'));
 return {rate:matches[0].item,reason:'수량산출서에서 지정한 DB 품목 · 품명·규격·단위 확인'};
}
