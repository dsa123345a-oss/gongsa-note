export function boundaryDirection(event,index,count){
 if(event.shiftKey||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.repeat)return 0;
 return index===0&&event.key==='ArrowUp'?-1:index===count-1&&event.key==='ArrowDown'?1:0;
}
export function insertBoundaryLine(lines,id,direction){
 if(![-1,1].includes(direction)||!lines.length)return null;
 const index=direction<0?0:lines.length-1,anchor=lines[index];if(anchor.id!==id)return null;
 const line={id:crypto.randomUUID(),name:'',spec:'',unit:'',qty:1,group:anchor.group||'직접 입력',bucket:direction<0?'direct':anchor.bucket||'direct',status:'unmatched',rate:null,factor:1,exclude:false,source:'직접 입력'};
 return {lines:direction<0?[line,...lines]:[...lines,line],line};
}
export function setupGridKeyboard(api){
 const table=document.getElementById('estimateTable');let editing=false;
 const selector='textarea[data-field],input[data-field],input[data-separate-price],select[data-field],button[data-match],button[data-detail-line],button[data-bid-line]';
 const controls=row=>[...row.querySelectorAll(selector)].filter(el=>!el.disabled);
 const key=el=>el.dataset.field||('separatePrice' in el.dataset?'separatePrice':null)||(['match','detailLine','bidLine'].find(k=>k in el.dataset));
 table.addEventListener('focusin',()=>{editing=false;});
 table.addEventListener('dblclick',e=>{if(e.target.matches('input[data-field]:not([type=checkbox]),textarea[data-field]'))editing=true;});
 table.addEventListener('keydown',e=>{
  const current=e.target.closest(selector),row=current?.closest('[data-id]');if(!current||!row||e.isComposing)return;
  if(e.key==='F2'&&current.matches('input:not([type=checkbox]),textarea')){e.preventDefault();editing=true;return;}
  if(e.key==='Escape'){editing=false;return;}
  if(e.altKey||((e.ctrlKey||e.metaKey)&&!(e.shiftKey&&['ArrowUp','ArrowDown'].includes(e.key))))return;
  if(editing&&e.key!=='Enter'&&e.key!=='Tab')return;
  if(current.tagName==='SELECT'&&e.key!=='Tab'&&e.key!=='Enter')return;
  if(e.key==='Enter'&&current.tagName==='BUTTON')return;
  if(e.key===' '&&current.type==='checkbox')return;
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Tab','Enter'].includes(e.key))return;
  const rows=[...table.querySelectorAll('tbody tr[data-id]')],r=rows.indexOf(row),cells=controls(row),c=cells.indexOf(current),field=key(current);
  let nextRow=r,nextCell=c;
  if(e.key==='ArrowUp'||e.key==='ArrowDown'||e.key==='Enter')nextRow+=e.key==='ArrowUp'||e.key==='Enter'&&e.shiftKey?-1:1;
  else {nextCell+=e.key==='ArrowLeft'||e.key==='Tab'&&e.shiftKey?-1:1;if(e.key==='Tab'){if(nextCell<0){nextRow--;nextCell=nextRow>=0?controls(rows[nextRow]).length-1:0;}else if(nextCell>=cells.length){nextRow++;nextCell=0;}}}
  if(nextRow<0||nextRow>=rows.length){
   if(['ArrowUp','ArrowDown'].includes(e.key))e.preventDefault();
   const direction=boundaryDirection(e,r,rows.length);if(!direction||!api.insertBoundary)return;
   e.preventDefault();const id=row.dataset.id;current.blur();const inserted=api.insertBoundary(id,direction);if(!inserted)return;
   const fresh=[...table.querySelectorAll('tbody tr[data-id]')].find(r=>r.dataset.id===inserted),el=fresh&&(controls(fresh).find(el=>key(el)===field)||controls(fresh).find(el=>el.dataset.field==='name'));
   editing=false;if(el){el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});if(el.matches('input:not([type=checkbox]),textarea'))el.select();}return;
  }
  if(nextCell<0)return;
  const vertical=['ArrowUp','ArrowDown','Enter'].includes(e.key),targetRow=rows[nextRow],targetControls=controls(targetRow),target=vertical?(targetControls.find(el=>key(el)===field)||targetControls.find(el=>el.dataset.field==='name')):targetControls[nextCell];
  if(!target)return;e.preventDefault();const targetId=targetRow.dataset.id,targetKey=key(target);editing=false;
  // Blur commits the current value; rendering may replace every input node.
  current.blur();api.selectRow(targetId,{shift:e.shiftKey&&['ArrowUp','ArrowDown'].includes(e.key),ctrl:e.ctrlKey||e.metaKey});
  const fresh=[...table.querySelectorAll('tbody tr[data-id]')].find(r=>r.dataset.id===targetId),el=fresh&&controls(fresh).find(el=>key(el)===targetKey);
  if(el){el.focus({preventScroll:true});el.scrollIntoView({block:'nearest',inline:'nearest'});if(el.matches('input:not([type=checkbox]),textarea'))el.select();}
 });
}
