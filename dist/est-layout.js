export function setupEstLayout(api){
 document.body.classList.add('est-desktop');
 const $=id=>document.getElementById(id),header=document.querySelector('header'),bar=document.querySelector('.resource-toolbar'),sidebar=document.querySelector('.sidebar');
 header.after(bar);
 const titleBox=document.createElement('div');titleBox.className='menu-project-title';titleBox.innerHTML='<label for="desktopProjectTitle">공사명</label><input id="desktopProjectTitle" aria-label="공사명" placeholder="공사명을 입력하세요"><button type="button" id="saveProjectTitle" title="공사명 적용 및 작업 파일 저장">저장</button>';header.insertBefore(titleBox,$('saveState'));const caption=$('desktopProjectTitle');caption.value=api.getTitle()||'';caption.oninput=()=>api.setTitle(caption.value);caption.onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();api.save();}};$('saveProjectTitle').onclick=()=>api.save();
 const outline=document.createElement('div');outline.className='outline-controls';outline.innerHTML='<label>레벨 <select id="outlineLevel" aria-label="공종 목록 레벨"><option value="">전체</option>'+Array.from({length:9},(_,i)=>`<option value="${i+1}">L${i+1}</option>`).join('')+'</select></label><button data-command="collapseLevels" title="공종 모두 접기" aria-label="공종 모두 접기">−</button><button data-command="expandLevels" title="모두 펼치기" aria-label="모두 펼치기">＋</button>';
 sidebar.prepend(outline);$('outlineLevel').onchange=api.refresh;
 const settings=document.createElement('dialog');settings.id='projectSettingsDialog';settings.innerHTML='<div class="dialog-head"><h2>공사 정보 · 자료 가져오기</h2><button class="icon-btn" aria-label="공사 정보 닫기">×</button></div>';
 const existing=document.querySelector('.project-settings');existing.open=true;settings.append(existing);document.body.append(settings);settings.querySelector('.icon-btn').onclick=()=>settings.close();
 const command=document.createElement('button');command.id='projectSettingsCommand';command.className='button';command.textContent='공사 정보 · 자료 가져오기';command.onclick=()=>settings.showModal();document.querySelector('#estToolsDialog .tool-menu').append(command);
}
