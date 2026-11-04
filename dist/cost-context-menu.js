// Reuse the cost editor's existing commands, so save/undo and nested dialogs agree.
export function setupCostContextMenu(dialog){
 const commands=[
  ['원가계산서 초기화','resetCostSheet'],['공사비 역산 · 자리수','reverseCostSheet'],null,
  ['한 줄 삽입','insertCostRow'],['맨 아래 추가','addCharge'],['선택 행 삭제','deleteCostRow'],null,
  ['되살리기','undoProject'],['다시 실행','redoProject'],null,
  ['낙찰률','bidBtn'],['원가 조정 · 요율','costTool'],['조건별 요율','ratePolicyTool'],['공사 기준·요율 이력','costBasisTool'],null,
  ['엑셀 저장','summaryExport'],['인쇄 · PDF','printBtn']
 ];
 const menu=document.createElement('div');menu.id='costContextMenu';menu.className='cost-context-menu';menu.setAttribute('role','menu');menu.setAttribute('aria-label','원가계산서 작업');menu.hidden=true;dialog.append(menu);
 menu.innerHTML=commands.map(c=>c?`<button type="button" role="menuitem" data-cost-command="${c[1]}">${c[0]}</button>`:'<hr role="separator">').join('');
 const hint=document.createElement('span');hint.className='cost-context-hint';hint.textContent='마우스 오른쪽 버튼: 초기화 · 역산 · 행 편집';dialog.querySelector('.cost-caption').append(hint);
 let previousFocus=null;
 const close=(restore=false)=>{menu.hidden=true;if(restore&&previousFocus?.isConnected)previousFocus.focus();};
 const buttons=()=>[...menu.querySelectorAll('button:not(:disabled)')];
 function open(e,x,y){
  e.preventDefault();previousFocus=document.activeElement;
  const row=e.target.closest('[data-cost-row]');if(row)row.click();
  for(const b of menu.querySelectorAll('button')){const command=document.getElementById(b.dataset.costCommand);b.disabled=!command||command.disabled;}
  menu.hidden=false;menu.style.left='0px';menu.style.top='0px';
  const r=menu.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(x,innerWidth-r.width-8))+'px';menu.style.top=Math.max(8,Math.min(y,innerHeight-r.height-8))+'px';buttons()[0]?.focus();
 }
 dialog.addEventListener('contextmenu',e=>{if(e.target.closest('.workspace-window-head'))return;open(e,e.clientX,e.clientY);});
 dialog.addEventListener('keydown',e=>{if(e.key==='ContextMenu'||e.shiftKey&&e.key==='F10'){const r=e.target.getBoundingClientRect();open(e,r.left+20,r.bottom);}});
 menu.addEventListener('click',e=>{const b=e.target.closest('[data-cost-command]');if(!b||b.disabled)return;close();document.getElementById(b.dataset.costCommand)?.click();});
 menu.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true);return;}
  if(e.key==='Tab'){close();return;}
  const list=buttons(),i=list.indexOf(document.activeElement);let at=null;
  if(e.key==='ArrowDown')at=(i+1)%list.length;if(e.key==='ArrowUp')at=(i-1+list.length)%list.length;
  if(e.key==='Home')at=0;if(e.key==='End')at=list.length-1;
  if(at!==null){e.preventDefault();e.stopPropagation();list[at]?.focus();}
 });
 document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))close();});
 dialog.querySelector('.workspace-window-body').addEventListener('scroll',()=>close(),true);
 window.addEventListener('resize',()=>close());dialog.addEventListener('close',()=>close());
}
