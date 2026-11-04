import {boundaryDirection} from './grid-keyboard.js';
// IDs, not row positions, survive edits. Ranges use only the visible row order.
export function createRowSelection(){
 let selected=new Set(),anchor=null,active=null,order=[];
 const ids=()=>order.filter(id=>selected.has(id));
 return {
  get ids(){return ids();},get active(){return active;},get anchor(){return anchor;},
  reconcile(next,external=active){
   order=[...next];const visible=new Set(order);selected=new Set([...selected].filter(id=>visible.has(id)));
   if(external!==active){selected=new Set(visible.has(external)?[external]:[]);active=visible.has(external)?external:null;anchor=active;}
   if(!visible.has(active))active=ids().at(-1)||null;
   if(!visible.has(anchor))anchor=active;
   return ids();
  },
  select(id,{shift=false,ctrl=false}={}){
   if(!order.includes(id))return ids();
   if(shift){if(!order.includes(anchor))anchor=active||id;const a=order.indexOf(anchor),b=order.indexOf(id),range=order.slice(Math.min(a,b),Math.max(a,b)+1);selected=ctrl?new Set([...selected,...range]):new Set(range);active=id;}
   else if(ctrl){selected.has(id)?selected.delete(id):selected.add(id);anchor=id;active=selected.has(id)?id:ids().at(-1)||null;}
   else{selected=new Set([id]);active=anchor=id;}
   return ids();
  },
  replace(next){selected=new Set(next.filter(id=>order.includes(id)));active=ids().at(-1)||null;anchor=ids()[0]||null;return ids();},
  all(){selected=new Set(order);anchor=order[0]||null;active=order.at(-1)||null;return ids();},
  clear(){selected.clear();active=anchor=null;}
 };
}

export function setupRowSelection(api){
 const table=document.getElementById('estimateTable'),state=createRowSelection();
 const bar=document.getElementById('deleteLine').parentElement;
 const copy=document.createElement('button');copy.id='copySelectedLines';copy.className='button small';copy.textContent='선택 행 복사';copy.disabled=true;bar.append(copy);
 const block=document.createElement('button');block.className='button small';block.textContent='선택 일괄 편집';block.disabled=true;bar.append(block);
 const label=document.createElement('span');label.className='row-selection-info';label.setAttribute('role','status');bar.append(label);
 const hint=document.createElement('span');hint.className='row-selection-hint';hint.textContent='행 번호 · Shift 범위 · Ctrl 추가 선택';hint.title='행 번호를 클릭한 뒤 Shift+↑/↓로 범위 조절, Ctrl+A 전체 선택, Esc 선택 해제';bar.append(hint);
 function paint(){const ids=new Set(state.ids);for(const tr of table.querySelectorAll('tbody tr[data-id]')){tr.classList.toggle('selected-line',ids.has(tr.dataset.id));tr.classList.toggle('selection-active',tr.dataset.id===state.active);tr.setAttribute('aria-selected',String(ids.has(tr.dataset.id)));tr.querySelector('[data-select-row]')?.setAttribute('aria-pressed',String(ids.has(tr.dataset.id)));}label.textContent=ids.size?`${ids.size}행 선택`:'';copy.disabled=block.disabled=!ids.size;document.getElementById('deleteLine').disabled=!ids.size;}
 function update(){api.onChange(state.active,state.ids);paint();}
 function select(id,options){state.select(id,options);update();}
 const rowButton=id=>[...table.querySelectorAll('[data-select-row]')].find(b=>b.dataset.selectRow===id);
 function focus(id){rowButton(id)?.focus({preventScroll:true});rowButton(id)?.scrollIntoView({block:'nearest',inline:'nearest'});}
 table.addEventListener('pointerdown',e=>{if((e.shiftKey||e.ctrlKey||e.metaKey)&&e.target.closest('tbody tr[data-id]'))e.preventDefault();});
 table.addEventListener('click',e=>{
  if(e.target.closest('[data-select-all]')){e.preventDefault();e.stopImmediatePropagation();state.all();update();return;}
  const row=e.target.closest('tbody tr[data-id]');if(!row)return;
  const id=row.dataset.id,modified=e.shiftKey||e.ctrlKey||e.metaKey,selector=e.target.closest('[data-select-row]');
  if(modified||selector){e.preventDefault();e.stopImmediatePropagation();if(document.activeElement!==e.target)document.activeElement?.blur();select(id,{shift:e.shiftKey,ctrl:e.ctrlKey||e.metaKey});focus(state.active||id);if(!modified)api.onActivate?.(id);}
  else {select(id);if(!e.target.closest('button,select,input[type="checkbox"]'))api.onActivate?.(id);}
 },true);
 table.addEventListener('keydown',e=>{
  if(e.isComposing||e.altKey)return;
  const selector=e.target.closest('[data-select-row],[data-select-all]');if(!selector)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='a'){e.preventDefault();e.stopImmediatePropagation();state.all();update();return;}
  if(e.key==='Escape'){e.preventDefault();state.clear();update();return;}
  if(e.key==='Delete'){e.preventDefault();api.remove();return;}
  const order=[...table.querySelectorAll('tbody tr[data-id]')].map(r=>r.dataset.id),i=order.indexOf(state.active||selector.dataset.selectRow);
  const boundary=boundaryDirection(e,i,order.length);
  if(boundary&&api.insertBoundary){e.preventDefault();const id=api.insertBoundary(order[i],boundary);if(id){select(id);focus(id);}return;}
  const next=e.key==='Home'?0:e.key==='End'?order.length-1:e.key==='ArrowUp'?Math.max(0,i-1):e.key==='ArrowDown'?Math.min(order.length-1,i+1):-1;
  if(next>=0&&order[next]){e.preventDefault();select(order[next],{shift:e.shiftKey,ctrl:e.shiftKey&&(e.ctrlKey||e.metaKey)});focus(order[next]);if(!e.shiftKey)api.onActivate?.(order[next]);}
 });
 copy.onclick=()=>{document.activeElement?.blur();api.copy();};
 block.onclick=()=>document.getElementById('blockTool').click();
 return {get ids(){return state.ids;},select,paint,refresh(order,active){state.reconcile(order,active);update();},clear(){state.clear();update();},replace(ids){state.replace(ids);update();}};
}
