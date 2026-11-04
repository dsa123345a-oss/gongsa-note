import {workConnectionJoints,reserveWorkConnectionJoints} from './work-connection-joints.js';
export function hierarchyView(lines){
 const stack=[],result=new Map();
 for(const line of lines){if(line.separateTail)stack.length=0;const level=Number(line.level)||0;if(level)while(stack.length&&stack.at(-1).level<=level)stack.pop();
  result.set(line.id,{depth:stack.length,hidden:stack.some(l=>l.collapsed)});if(level)stack.push(line);
 }return result;
}
export function changeLevel(project,id,level,scope='line'){
 const next=structuredClone(project),line=next.lines.find(l=>l.id===id);
 if(!line)throw Error('먼저 내역 행을 선택하세요.');
 if(!Number.isInteger(level)||level<0||level>9)throw Error('레벨은 0~9입니다.');
 if(!['line','same'].includes(scope))throw Error('변경 범위를 선택하세요.');
 const old=Number(line.level)||0;if(scope==='same'&&!old)throw Error('세부 내역은 현재 행 단위로 레벨을 지정하세요.');
 for(const row of next.lines)if(row.id===id||(scope==='same'&&row.level===old)){row.level=level;delete row.collapsed;}
 return next;
}
export function groupHeadings(project){
 if(project.lines.some(l=>l.level))throw Error('이미 공종 레벨이 있습니다. 공종 추가 또는 레벨 지정으로 편집하세요.');
 const next=structuredClone(project);let group=null;next.lines=next.lines.flatMap(l=>{if(l.group===group)return [l];group=l.group;return [{id:crypto.randomUUID(),level:1,name:l.group||'공종',group:l.group,spec:'',unit:'',qty:null,bucket:'direct',status:'unmatched',rate:null,factor:1,exclude:false,source:'공종명으로 생성'},l];});return next;
}
export function quantityHierarchy(project){
 const next=project.lines.some(l=>l.level)?structuredClone(project):groupHeadings(project);
 if(!next.lines.length||next.lines.some(l=>l.level>=2))return next;
 next.lines.unshift({id:crypto.randomUUID(),level:2,autoHeading:'project',headingScope:'direct',name:next.title||'공사명',group:'',spec:next.location||'',unit:'',qty:null,bucket:'direct',status:'unmatched',rate:null,factor:1,exclude:false,source:'공사 직접공사비 집계'});
 return next;
}
export function appendQuantitySection(project,quantity,file){
 reserveWorkConnectionJoints([...project.lines.filter(l=>l.workConnectionJoints!==undefined).map(l=>({label:l.sourceFile||l.name||'기존 내역',joints:l.workConnectionJoints})),{label:file,joints:quantity.workConnectionJoints}]);
 const incoming=quantityHierarchy({title:quantity.title||file.replace(/\.xlsx$/i,''),location:quantity.location||'',lines:quantity.rows});
 if(incoming.lines.length){incoming.lines[0].workConnectionJoints=workConnectionJoints(quantity.workConnectionJoints);incoming.lines[0].sourceFile=file;}
 if(!project.lines.length)return {...project,...incoming,quantityFile:file};
 const next=quantityHierarchy(project);
 for(const l of [...next.lines,...incoming.lines])if(l.autoHeading==='project')l.autoHeading='section';
 next.lines.push(...incoming.lines);next.quantityFile=[next.quantityFile,file].filter(Boolean).join(' · ');
 return next;
}
export function setupLevels(api){
 const $=id=>document.getElementById(id);
 document.body.insertAdjacentHTML('beforeend',`<dialog id="levelDialog"><div class="dialog-head"><div><h2>레벨 지정</h2><p id="levelTarget"></p></div><button class="icon-btn" id="levelClose" aria-label="레벨 창 닫기">×</button></div><div class="level-fields"><label>레벨 <select id="levelValue">${Array.from({length:10},(_,n)=>`<option value="${n}">${n===0?'0 · 세부 내역':n+' · 공종 소계'}</option>`).join('')}</select></label><label>적용 범위 <select id="levelScope"><option value="line">현재 행만</option><option value="same">같은 레벨 공종 전체</option></select></label><p>숫자가 클수록 상위 공종입니다. 예: L3 대공종 → L2 중공종 → L1 소공종 → L0 세부 내역.</p><p id="levelPreview"></p></div><div class="dialog-actions"><button class="button primary" id="levelApply">레벨 적용</button></div></dialog>`);
 let selected=null;
 const preview=()=>{const p=api.getProject(),row=p.lines.find(l=>l.id===selected),count=$('levelScope').value==='same'?p.lines.filter(l=>l.level===row?.level).length:1;$('levelPreview').textContent=`${count}행 변경 · 공종 행은 자체 단가 대신 아래 세부 내역의 합계를 표시합니다.`;};
 $('levelValue').onchange=$('levelScope').onchange=preview;
 $('levelClose').onclick=()=>$('levelDialog').close();
 $('levelApply').onclick=()=>{try{api.replaceProject(changeLevel(api.getProject(),selected,Number($('levelValue').value),$('levelScope').value));$('levelDialog').close();}catch(e){api.toast(e.message);}};
 return {open(){selected=api.getSelected();const row=api.getProject().lines.find(l=>l.id===selected);if(!row){api.toast('먼저 레벨을 바꿀 내역 행을 선택하세요.');return;}$('levelTarget').textContent=row.name;$('levelValue').value=String(row.level||0);$('levelScope').value='line';$('levelScope').options[1].disabled=!row.level;preview();$('levelDialog').showModal();},generate(){try{api.replaceProject(quantityHierarchy(api.getProject()));api.toast('공사 L2 · 공종 L1 소계 행을 정리했습니다.');}catch(e){api.toast(e.message);}},fold(value){const p=structuredClone(api.getProject());for(const l of p.lines)if(l.level)l.collapsed=value;api.replaceProject(p);}};
}
