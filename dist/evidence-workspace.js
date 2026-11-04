const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8});
import {collectPriceEvidence} from './price-evidence.js';
import {norm} from './calc.js';
import {estFormulaDisplay} from './est-formula-display.js';
import {measurePrintText} from './print-typography.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>displayNumber.format(Number(n||0));
const labels={labor:'노무비',material:'재료비',expense:'경비',other:'기타',total:'합계'};
export const evidenceCategory=node=>node.kind==='일위대가'&&/^D/.test(node.rate.code||'')?'단가산출':node.kind;
export function evidenceEntries(project,libraries,category,query=''){
 const graph=collectPriceEvidence(project,libraries),q=norm(query);
 const contains=(root,target,seen=new Set())=>{if(!root||seen.has(root))return false;if(root===target)return true;seen.add(root);return [...root.children.values()].some(child=>contains(child,target,seen));};
 return graph.nodes.filter(n=>evidenceCategory(n)===category&&(!q||norm(n.rate.name+' '+n.rate.spec+' '+n.rate.code+' '+n.rate.source).includes(q))).map(node=>{const lines=project.lines.filter(l=>contains(graph.lineNodes.get(l.id),node));return {node,lines,editNode:graph.lineNodes.get(lines[0]?.id)};});
}
export function evidenceContent(node){
 if(evidenceCategory(node)==='단가산출')return estFormulaContent(node);
 const r=node.rate,cols=a=>['total','labor','material','expense','other'].map(k=>`<td class="number">${num(a[k])}</td>`).join('');
 const head='<colgroup><col class="basis-description"><col span="5"></colgroup><thead><tr><th>산 출 근 거</th><th>합계</th><th>노무비</th><th>재료비</th><th>경비</th><th>기타</th></tr></thead>';
 let rows='';
 if(node.verified&&node.calc){
  if(node.calc.variables.length)rows+=`<tr><td colspan="6"><div class="basis-variables">${node.calc.variables.map(v=>`<span><b>${esc(v.name)}</b> = ${esc(v.expression)} = <strong>${num(v.value)}</strong></span>`).join('')}</div></td></tr>`;
  rows+=node.calc.rows.map((p,i)=>{
   const formula=p.qtyExpression??p.qty,lines=p.kind?(p.kind==='subtotal'?['표시 소계 · 합산 제외']:[`${labels[p.basis||'labor']} 기준 ${num(p.basisValue)} × ${esc(p.percent??p.qty)}%`]):['labor','material','expense','other'].filter(k=>p[k]||p.amount[k]).map(k=>`${labels[k]}: ${num(p[k])} × (${esc(formula)}) = <b>${num(p.amount[k])}</b>`);
   return `<tr class="${p.kind?'basis-subtotal':''}"><td><strong>${i+1}. ${esc(p.name||p.kind)}</strong><span class="basis-spec">${esc(p.spec||'')} ${esc(p.unit||'')}</span>${lines.map(x=>`<div class="basis-equation">${x}</div>`).join('')}${p.manualAmounts?'<small>직접 입력 금액 적용</small>':''}${p.exclude||['vertical','both'].includes(p.calculationMode)?'<small>세로 집계 제외</small>':''}</td>${cols(p.amount)}</tr>`;
  }).join('');
  rows+=`<tr class="basis-result"><td>산출 단가 · 기준 수량 ${num(node.calc.divisor)}${r.sourceComponent?' · '+labels[r.sourceComponent]+'만 계상':''}</td>${cols(r)}</tr>`;
 }else if(node.raw.length){
  rows+=node.raw.filter(x=>!x.TitleCode).map(x=>`<tr><td><strong>${esc(x.Name||x.LineData||x.Code||'')}</strong><div>${esc(x.Size||'')}</div>${x.GN!=null?`<div class="basis-equation">수량 ${num(x.GN)} × 저장 단가 ${num(x.TU)}</div>`:''}</td>${cols({total:x.TC,labor:x.NC,material:x.GC,expense:x.JC})}</tr>`).join('');
  rows+=`<tr class="basis-result"><td>현재 적용 단가 · 원본 저장 근거</td>${cols(r)}</tr>`;
 }else rows=`<tr class="basis-result"><td>${node.sheet>=2?'적용 기초단가':'현재 적용 단가'}<div class="basis-equation">${esc(r.spec||'')} · ${esc(r.unit||'')}</div></td>${cols(r)}</tr>`;
 return `<h2>${esc(r.name)}</h2><p class="basis-caption">${esc(r.spec||'규격 없음')} · ${esc(r.unit||'')} · ${esc(r.code||'')}<br>${esc(r.priceReference?.source||r.source||'직접 입력')}</p>${node.issues.length?`<p class="basis-notice">${node.issues.map(esc).join('<br>')}</p>`:''}<table class="basis-table">${head}<tbody>${rows}</tbody></table>`;
}
function estFormulaContent(node){
 const r=node.rate,display=estFormulaDisplay(node),warnings=[...new Set([...(node.issues||[]),...display.warnings])];
 const width=Math.max(880,...display.rows.map(p=>measurePrintText(p.text,14)/.67+24));
 const values=a=>[a.total,a.labor,a.material,Number(a.expense||0)+Number(a.other||0)];
 const rows=display.rows.map(p=>`<tr class="basis-est-${esc(p.kind||'formula')}${p.bold?' basis-est-bold':''}"${p.blockId?` data-formula-block="${esc(p.blockId)}"`:''}><td class="basis-est-description"><div class="basis-est-line">${esc(p.text)||'&nbsp;'}</div></td>${(p.amount?values(p.amount):Array(4).fill(null)).map(v=>`<td class="number">${v==null||v===0?'':num(v)}</td>`).join('')}</tr>`).join('');
 return `<h2>${esc(r.name)}</h2><p class="basis-caption">${esc(r.spec||'규격 없음')} · ${esc(r.unit||'')} · ${esc(r.code||'')}<br>${esc(r.priceReference?.source||r.source||'직접 입력')}</p>${warnings.length?`<p class="basis-notice">${warnings.map(esc).join('<br>')}</p>`:''}<table class="basis-table basis-est-formula" style="min-width:${Math.ceil(width)}px"><colgroup><col style="width:67%"><col style="width:9%"><col span="3" style="width:8%"></colgroup><thead><tr><th>산 출 근 거</th><th>합계</th><th>노무비</th><th>재료비</th><th>경비</th></tr></thead><tbody>${rows}</tbody></table>`;
}
export function setupEvidenceWorkspace(api){
 const tabs=document.querySelector('.worktabs'),panel=document.createElement('section');let category='',entries=[],selected=null,resume='';
 const css=document.createElement('link');css.rel='stylesheet';css.href='evidence-workspace.css';document.head.append(css);
 panel.id='evidenceWorkspace';panel.hidden=true;panel.innerHTML='<aside class="basis-list"><div class="basis-search"><input type="search" aria-label="사용 단가 검색" placeholder="품명·규격 검색"><button type="button" class="button small">전체보기</button></div><div class="basis-list-caption"></div><div class="basis-list-scroll" role="listbox" aria-label="현재 공사 사용 단가"></div></aside><div class="basis-divider" role="separator" aria-label="단가 목록 너비" aria-orientation="vertical" tabindex="0"></div><section class="basis-detail"><div class="basis-actions"><span>현재 공사에 사용한 단가</span><button type="button" class="button small" data-basis-edit>산출근거 수정</button><button type="button" class="button small" data-basis-ledger>내역 위치</button></div><div class="basis-paper"></div></section>';
 document.body.append(panel);tabs.setAttribute('aria-label','내역·산출근거 작업 탭');
 const list=panel.querySelector('.basis-list-scroll'),search=panel.querySelector('input'),paper=panel.querySelector('.basis-paper');
 function active(){tabs.querySelectorAll('button').forEach(b=>{const yes=category?b.dataset.resource===category:b.dataset.workView==='estimate';b.classList.toggle('active',yes);if(yes)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});}
 function detail(){const entry=entries.find(e=>e.node.id===selected),node=entry?.node;paper.innerHTML=node?evidenceContent(node):'<div class="basis-empty">이 공사에 사용된 해당 단가가 없습니다.<br>내역서에서 단가를 연결하면 여기에 표시됩니다.</div>';const edit=panel.querySelector('[data-basis-edit]');edit.disabled=!entry?.lines.length;edit.textContent=entry&&entry.editNode!==node?'사용 내역에서 수정':'산출근거 수정';panel.querySelector('[data-basis-ledger]').disabled=!entry?.lines.length;}
 function renderList(){list.innerHTML=entries.map(({node},i)=>`<button type="button" role="option" aria-selected="${node.id===selected}" data-basis-id="${node.id}"><span class="basis-index">${i+1}</span><span><strong>${esc(node.rate.name)}</strong><small>${esc(node.rate.spec||'규격 없음')} · ${esc(node.rate.unit||'')}</small><small>${esc(node.rate.priceReference?.source||node.rate.source||'직접 입력')}${node.rate.sourceComponent?' · '+labels[node.rate.sourceComponent]+'만':''}</small></span><b>${num(node.rate.total)}</b></button>`).join('');panel.querySelector('.basis-list-caption').textContent=`${category==='장비'?'기계경비':category} · ${entries.length}건`;detail();}
 function refresh(){if(!category)return;const old=entries.find(e=>e.node.id===selected),lineId=old?.lines[0]?.id;entries=evidenceEntries(api.getProject(),api.getLibraries(),category,search.value);selected=(entries.find(e=>lineId&&e.lines.some(l=>l.id===lineId))||entries.find(e=>e.lines.some(l=>l.id===api.getSelected()))||entries.find(e=>e.node.id===selected)||entries[0])?.node.id;renderList();}
 function open(value){category=value;panel.hidden=false;document.body.classList.add('evidence-workspace-open');search.value='';entries=[];selected=null;api.closeWindows();refresh();active();}
 function close(){category='';panel.hidden=true;document.body.classList.remove('evidence-workspace-open');active();}
 tabs.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.resource){e.stopPropagation();open(b.dataset.resource);}else if(b.dataset.workView==='estimate')close();});
 tabs.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const buttons=[...tabs.querySelectorAll('button')],i=buttons.indexOf(e.target);if(i<0)return;e.preventDefault();const target=buttons[e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length];target.focus();target.click();});
 search.oninput=()=>{entries=evidenceEntries(api.getProject(),api.getLibraries(),category,search.value);selected=entries[0]?.node.id;renderList();};panel.querySelector('.basis-search button').onclick=()=>{search.value='';refresh();};
 list.onclick=e=>{const b=e.target.closest('[data-basis-id]');if(b){selected=b.dataset.basisId;renderList();list.querySelector(`[data-basis-id="${selected}"]`)?.focus();}};
 list.onkeydown=e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key)||!entries.length)return;e.preventDefault();const i=entries.findIndex(x=>x.node.id===selected),at=e.key==='Home'?0:e.key==='End'?entries.length-1:Math.max(0,Math.min(entries.length-1,i+(e.key==='ArrowDown'?1:-1)));selected=entries[at].node.id;renderList();list.querySelector(`[data-basis-id="${selected}"]`)?.focus();};
 panel.querySelector('[data-basis-ledger]').onclick=()=>{const line=entries.find(e=>e.node.id===selected)?.lines[0];if(line){close();api.goToLine(line.id);}};
 panel.querySelector('[data-basis-edit]').onclick=()=>{const entry=entries.find(e=>e.node.id===selected);if(entry?.lines.length){resume=category;api.edit(entry.editNode,entry.lines[0]);}};
 document.getElementById('assemblyDialog').addEventListener('close',()=>{if(resume){const next=resume;resume='';open(next);}});
 document.getElementById('detailDialog').addEventListener('close',()=>queueMicrotask(()=>{if(!document.getElementById('assemblyDialog').open)resume='';}));
 const divider=panel.querySelector('.basis-divider');let width=320;
 function resize(next){width=Math.max(220,Math.min(innerWidth*.48,next));panel.style.setProperty('--basis-list-width',width+'px');divider.setAttribute('aria-valuemin','220');divider.setAttribute('aria-valuemax',Math.max(220,Math.round(innerWidth*.48)));divider.setAttribute('aria-valuenow',Math.round(width));}
 divider.onkeydown=e=>{if(['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();resize(width+(e.key==='ArrowRight'?20:-20));}};
 divider.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();divider.setPointerCapture(e.pointerId);const start=e.clientX,initial=width;divider.onpointermove=v=>resize(initial+v.clientX-start);divider.onpointerup=divider.onpointercancel=()=>{divider.onpointermove=null;};};
 function place(){const bar=document.querySelector('.resource-toolbar');panel.style.top=Math.ceil(bar.getBoundingClientRect().bottom)+'px';panel.style.bottom=Math.ceil(tabs.getBoundingClientRect().height)+'px';resize(width);}
 new ResizeObserver(place).observe(document.querySelector('.resource-toolbar'));new ResizeObserver(place).observe(tabs);window.addEventListener('resize',place);active();place();
 return {open,close,refresh,get category(){return category;}};
}
