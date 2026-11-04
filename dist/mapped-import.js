import {amount} from './calc.js';
export const importFields={name:'품명',spec:'규격',unit:'단위',group:'공종',qty:'수량',level:'집계 레벨',code:'코드',labor:'노무 단가',material:'재료 단가',expense:'경비 단가',other:'기타 단가',total:'합계 단가',amount:'원본 합계금액'};
export function mappedImport(sheet,map,options={}){
 const mode=options.mode||'quantity',start=Number(options.start??1),end=Number(options.end??1048576),category=options.category||'자재',target=options.target||'material';
 if(!['quantity','estimate','rate'].includes(mode)||!map.name)throw Error('가져올 종류와 품명 열을 선택하세요.');
 if(!Number.isInteger(start)||!Number.isInteger(end)||start<1||end<start)throw Error('시작/종료 행을 확인하세요.');
 if(mode!=='rate'&&!map.qty)throw Error('수량 열을 선택하세요.');
 if(!['labor','material','expense'].includes(target))throw Error('합계 단가의 계상 비목을 선택하세요.');
 const columns=Object.values(map).filter(Boolean);if(columns.some(c=>!/^[A-Z]{1,3}$/.test(c))||new Set(columns).size!==columns.length)throw Error('열은 중복 없이 지정하세요.');
 if(mode==='rate'&&!['자재','노임','장비','일위대가','단가산출','표준시장단가'].includes(category))throw Error('단가 구분을 확인하세요.');
 const rows=[],rates=[],issues=[];let group='미분류';
 for(const row of sheet.rows){
  if(row.index<start||row.index>end)continue;
  const cells=Object.fromEntries(Object.entries(map).filter(([,col])=>col).map(([key,col])=>[key,row.cells[col]||{value:'',ref:col+row.index}]));
  const text=key=>String(cells[key]?.value??'').trim();
  const name=text('name');if(!name)continue;
  const notes=[];
  const numeric=(key,missing=null)=>{const cell=cells[key];if(!cell||cell.value===''||cell.cached===false){if(cell?.formula)notes.push(importFields[key]+' 수식의 저장 계산값 없음');return missing;}const raw=typeof cell.value==='number'?cell.value:String(cell.value).trim().replace(/,/g,'');if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(raw))||!Number.isFinite(Number(raw))||Math.abs(Number(raw))>1e14){notes.push(importFields[key]+' 숫자 확인');return null;}return Number(raw);};
  if(text('group'))group=text('group');
  const level=map.level?numeric('level',0):0;
  if(level===null||!Number.isInteger(level)||level<0||level>9){issues.push({row:row.index,name,reason:'집계 레벨은 0~9 정수입니다. 행 보류'});continue;}
  if(!level&&/^(?:합\s*계|소\s*계|총\s*계)$/.test(name)){issues.push({row:row.index,name,reason:'합계 행 제외. 필요한 집계 행은 레벨 열을 지정하세요.'});continue;}
  let qty=mode==='rate'?null:numeric('qty');if(qty!==null&&qty<0){notes.push('음수 수량 확인');qty=null;}
  const sourceCells=structuredClone(cells),source=`${options.file||''} / ${sheet.name}!${map.name}${row.index}`;
  let rate=null;
  if(mode!=='quantity'&&!level){
   const keys=['labor','material','expense','other'],hasParts=keys.some(k=>map[k]),prices=Object.fromEntries(keys.map(k=>[k,map[k]?numeric(k):0]));
   const total=map.total?numeric('total'):null;
   if(!hasParts&&total!==null)prices[target]=total;
   if((hasParts||total!==null)&&keys.every(k=>prices[k]!==null&&(k==='other'||prices[k]>=0))){
    const sum=keys.reduce((s,k)=>s+prices[k],0);
    if(sum<0)notes.push('합계 단가는 0 이상이어야 합니다.');
    if(total!==null&&Math.abs(sum-total)>0.000001)notes.push('합계 단가와 비목 합계 불일치');
    if(sum>=0)rate={id:crypto.randomUUID(),code:text('code')||'XLS-'+row.index,name,spec:text('spec'),unit:text('unit'),category:mode==='estimate'?'내역단가':category,...prices,total:sum,source:options.file||sheet.name,table:'ExcelImport',record:row.index,sourceCells,sourcePosition:source};
   }else notes.push('단가 확인 필요');
  }
  const bucket=/관급/.test(group)?'government':/폐기물처리/.test(group)?'waste':/수수료|부담금/.test(group)?'fees':'direct';
  const line={id:crypto.randomUUID(),name,spec:text('spec'),unit:text('unit'),group,qty:level?null:qty,sourceQty:qty,level,bucket,factor:1,rate,status:rate?'confirmed':'unmatched',source,sourceCells,exclude:!level&&qty===0,note:''};
  if(map.amount&&!level&&mode==='estimate'){const expected=numeric('amount');line.sourceAmount=expected;const actual=amount(line)?.total;if(expected!==null&&actual!==undefined&&Math.abs(expected-actual)>0.000001)notes.push('원본 금액 '+expected+'원 / 재계산 '+actual+'원 불일치');}
  if(notes.length){issues.push({row:row.index,name,reason:notes.join(' · ')});if(rate)line.status='proposed';}
  line.note=notes.join(' · ');
  if(mode==='rate'){if(rate&&!notes.length)rates.push(rate);else if(!notes.length)issues.push({row:row.index,name,reason:'금액이 없는 단가 행 보류'});}else rows.push(line);
 }
 return {rows,rates,issues};
}
