// Compact desktop menus reuse the existing commands and their save/undo paths.
export function setupDesktopToolbar(){
 const $=id=>document.getElementById(id),header=document.querySelector('header'),bar=document.querySelector('.resource-toolbar');
 const action=(label,id)=>`<button type="button" data-command="${id}">${label}</button>`;
 const view=(label,id)=>`<button type="button" data-work-view="${id}">${label}</button>`;
 const menus=[
  ['파일',action('저장하기','saveProject')+action('다른 이름으로 저장','saveProjectAs')+action('새 내역서','newProject')+action('작업 열기','openProject')+action('수량산출서 가져오기','quantityInput')+'<hr>'+action('엑셀 내보내기','exportBtn')+action('미리보기','printTool')+action('인쇄','printSelectedTool')],
  ['편집',action('행 추가','addLine')+action('선택 행 복사','copySelectedLines')+action('선택 행 삭제','deleteLine')+action('공종 추가','addHeading')+action('블록 선택 · 일괄 편집','blockTool')+action('되살리기　Ctrl+Z','undoProject')+action('다시 실행　Ctrl+Y','redoProject')],
  ['LEVEL',action('선택 행 레벨 지정','levelTool')+action('공종명으로 소계 만들기','groupLevelTool')+action('공종 모두 접기','collapseLevels')+action('모두 펼치기','expandLevels')],
  ['단가',action('단가 업데이트','priceUpdateBtn')+action('자동 연결','suggestBtn')+action('자동 연결 검토','reviewAuto')+action('여러 단가 추가','batchTool')+action('연결 단가 다시 읽기','refreshRatesBtn')+action('새 일위대가','newAssemblyBtn')+action('새 단가산출','newFormulaBtn')],
  ['재계산',action('전체 재계산　F9','recalcBtn')+action('계산 방식 · 직접 금액','calculationTool')],
  ['원가계산서',view('원가계산서 보기','summary')+action('낙찰률','bidBtn')+action('원가 조정 · 요율','costTool')+action('조건별 요율','ratePolicyTool')+action('공사 기준·요율 이력','costBasisTool')],
  ['수량',action('수량산출 엑셀 가져오기','quantityInput')+action('엑셀 열 지정 가져오기','mappedImportTool')],
  ['작업도구',action('신규급수 수수료','supplyFeesTool')+action('긴급보수 기본 할증','emergencySurcharge')+action('공종·공구 할증','documentSurcharge')+action('감액 항목','deductionTool')+action('노임·자재·장비 기준 / 재계산','resourcePricesBtn')+action('기계경비','machineTool')+action('운반거리 · 작업량','haulTool')+action('표준시장단가','marketTool')+action('동원인원 · 자재 · 장비','resourceTool')+action('데이터 사용 위치','usageTool')+action('전체 적산 도구','estToolsBtn')],
  ['양식',action('설명서 · 예정공정','documentsTool')+action('출력 설정','printTool')],
  ['보기',action('공사 정보','projectSettingsCommand')+action('EST 가져오기 결과','estImportReport')+view('설계내역서','estimate')+view('단가 자료실','catalog')+view('EST 전체 자료','raw')+action('화면 설정','preferencesTool')],
  ['도움말',action('사용 방법','helpBtn')+action('지원 기능','coverageTool')+action('프로그램 업데이트','updateMenuBtn')]
 ];
 const nav=document.createElement('nav');nav.className='desktop-menubar';nav.setAttribute('aria-label','프로그램 메뉴');
 nav.innerHTML=menus.map(([name,body])=>name==='원가계산서'?`<button type="button" class="desktop-menu-direct" data-work-view="summary">${name}</button>`:`<details class="desktop-menu"><summary>${name}</summary><div class="desktop-menu-items">${body}</div></details>`).join('');header.prepend(nav);
 const original=document.createElement('div');original.hidden=true;original.id='originalCommands';header.append(original);
 for(const id of ['newProject','openProject','saveProject','exportBtn'])original.append($(id));
 header.append($('saveState'));document.querySelector('.breadcrumb').hidden=true;document.querySelector('.header-actions').hidden=true;
 bar.querySelector('label')?.remove();
 const paths={labor:'M8 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 18v-5c0-5 10-5 10 0v5M16 4h4M18 2v4M16 10h4M16 14h4',material:'M3 6l9-4 9 4-9 4zM3 6v12l9 4 9-4V6M12 10v12',machine:'M3 16h9l4-5h4v7H3zM7 16V8h5v8M11 8V4h7l3 7M5 21h14',unit:'M4 3h16v18H4zM7 7h10M7 11h4M15 11h2M7 15h4M15 15h2M7 18h10',assembly:'M3 4h18v16H3zM3 9h18M9 9v11M14 9v11',document:'M5 2h10l5 5v15H5zM15 2v6h5M8 12h9M8 16h9M8 19h6',link:'M9 7l3-3a5 5 0 0 1 7 7l-3 3M15 17l-3 3a5 5 0 0 1-7-7l3-3M8 16l8-8',bid:'M5 19L19 5M7 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6M17 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6',db:'M3 5c0-5 18-5 18 0s-18 5-18 0M3 5v14c0 5 18 5 18 0V5M3 12c0 5 18 5 18 0',tools:'M14 3a6 6 0 0 0-7 7L2 15l5 5 5-5a6 6 0 0 0 8-7l-4 4-4-4z',quantity:'M3 5h18v15H3zM3 10h18M8 5v15M13 5v15M18 5v15',sum:'M19 3H6l8 9-8 9h13'};
 const icon=key=>`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[key]}"/></svg>`;
 const decorate=(el,label,key)=>{el.classList.add('est-tool');el.innerHTML=icon(key)+`<span>${label}</span>`;el.title=label;};
 for(const [category,key] of [['노임','labor'],['자재','material'],['장비','machine'],['단가산출','unit'],['일위대가','assembly']]){const b=bar.querySelector(`[data-resource="${category}"]`);decorate(b,b.textContent,key);}
 const make=(label,key,attrs)=>{const b=document.createElement('button');b.type='button';b.className='button';for(const [k,v] of Object.entries(attrs))b.setAttribute(k,v);decorate(b,label,key);return b;};
 const db=$('mainDbBtn');bar.prepend(make('수량산출서 가져오기','quantity',{'data-command':'quantityInput','id':'quantityImportButton'}));bar.insertBefore(make('연결','link',{'data-command':'suggestBtn'}),db);bar.insertBefore(make('내역서','document',{'data-work-view':'estimate'}),db);bar.insertBefore(make('원가','sum',{'data-work-view':'summary'}),db);
 for(const [label,key,id] of [['미리보기','document','printTool'],['인쇄','document','printSelectedTool'],['삽입','quantity','addLine'],['삭제','document','deleteLine'],['되살리기','link','undoProject'],['단가업데이트','db','priceUpdateBtn']])bar.insertBefore(make(label,key,{'data-command':id}),db);
 decorate(db,'메인 DB','db');decorate($('bidBtn'),'낙찰률','bid');decorate($('estToolsBtn'),'작업도구','tools');
 const close=()=>nav.querySelectorAll('details[open]').forEach(d=>d.open=false);
 nav.addEventListener('click',e=>{const summary=e.target.closest('summary');if(summary){for(const d of nav.querySelectorAll('details[open]'))if(d!==summary.parentElement)d.open=false;}else if(e.target.closest('button'))close();});
 document.addEventListener('click',e=>{if(!nav.contains(e.target))close();const command=e.target.closest('[data-command]');if(!command)return;const target=$(command.dataset.command);if(target&&!target.disabled&&!target.hidden)target.click();else if(target&&!target.disabled&&['newProject','openProject','saveProject','saveProjectAs','exportBtn','quantityInput'].includes(target.id))target.click();});
 document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
 for(const id of new Set([...document.querySelectorAll('[data-command]')].map(b=>b.dataset.command))){const target=$(id);if(!target)continue;const sync=()=>document.querySelectorAll(`[data-command="${id}"]`).forEach(b=>b.disabled=!!target.disabled);sync();new MutationObserver(sync).observe(target,{attributes:true,attributeFilter:['disabled']});}
}
