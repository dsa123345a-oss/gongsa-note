import {setupCostContextMenu} from './cost-context-menu.js';
// Move the live panels, preserving their handlers and the ledger beneath them.
export function setupWorkspaceWindows(){
 const windows=new Map();let front=20;
 for(const [key,title] of [['summary','원가계산서'],['catalog','단가 자료실 · 메인 DB'],['raw','EST 전체 자료']]){
  const panel=document.getElementById(key+'View'),dialog=document.createElement('dialog');
  dialog.id=key+'Window';dialog.className='workspace-window';dialog.setAttribute('aria-labelledby',key+'WindowTitle');
  dialog.innerHTML=`<div class="dialog-head workspace-window-head"><h2 id="${key}WindowTitle">${title}</h2><span class="window-hint">제목줄을 끌어 이동 · 오른쪽 아래에서 크기 조절</span><button class="icon-btn" aria-label="${title} 닫기">×</button></div><div class="workspace-window-body"></div>`;
  dialog.querySelector('.workspace-window-body').append(panel);panel.hidden=false;document.body.append(dialog);
  dialog.querySelector('button').onclick=()=>dialog.close();
  dialog.addEventListener('pointerdown',()=>{dialog.style.zIndex=++front;});
  dialog.addEventListener('close',()=>document.querySelector(`[data-work-view="${key}"]`)?.classList.remove('active'));
  windows.set(key,dialog);
  if(key==='summary')setupCostContextMenu(dialog);
 }
 // Existing tool dialogs also move by their title bar. Modal editing remains modal.
 document.addEventListener('pointerdown',e=>{
  const head=e.target.closest('.dialog-head'),dialog=head?.closest('dialog[open]');
  if(!dialog||dialog.id==='matchDialog'||e.button!==0||e.target.closest('button,input,select,a'))return;
  const box=dialog.getBoundingClientRect(),x=e.clientX,y=e.clientY;
  Object.assign(dialog.style,{position:'fixed',width:box.width+'px',left:box.left+'px',top:box.top+'px',right:'auto',bottom:'auto',margin:'0'});
  head.setPointerCapture(e.pointerId);e.preventDefault();
  const move=ev=>{dialog.style.left=Math.max(0,Math.min(innerWidth-dialog.offsetWidth,box.left+ev.clientX-x))+'px';dialog.style.top=Math.max(0,Math.min(innerHeight-40,box.top+ev.clientY-y))+'px';};
  const end=()=>{head.removeEventListener('pointermove',move);head.removeEventListener('pointerup',end);head.removeEventListener('pointercancel',end);};
  head.addEventListener('pointermove',move);head.addEventListener('pointerup',end);head.addEventListener('pointercancel',end);
 });
 const clamp=()=>{for(const dialog of windows.values()){if(!dialog.open)continue;const r=dialog.getBoundingClientRect();if(r.right>innerWidth)dialog.style.left=Math.max(0,innerWidth-r.width)+'px';if(r.top>innerHeight-40)dialog.style.top=Math.max(0,innerHeight-40)+'px';}};
 window.addEventListener('resize',clamp);
 document.addEventListener('keydown',e=>{if(e.key!=='Escape'||document.querySelector('dialog:modal'))return;const top=[...windows.values()].filter(d=>d.open).sort((a,b)=>Number(b.style.zIndex)-Number(a.style.zIndex))[0];if(top){e.preventDefault();top.close();}});
 return {
  isOpen:key=>!!windows.get(key)?.open,
  open(key){const dialog=windows.get(key);if(!dialog)return;dialog.style.zIndex=++front;if(!dialog.open)dialog.show();clamp();},
  closeAll(){for(const dialog of windows.values())if(dialog.open)dialog.close();}
 };
}
