export function hasProjectWork(project,empty){
 return !!(project.lines?.length||project.title?.trim()||project.location?.trim()||project.quantityFile||JSON.stringify(project.charges)!==JSON.stringify(empty.charges));
}

// Compare only at save/open/close boundaries, never on every keystroke.
// A save timestamp is metadata; undoing back to the saved contents is clean.
export function createSavedProjectState(initial){
 const stamp=project=>{const {savedAt,...content}=project;return JSON.stringify(content);};
 let saved=initial==null?null:stamp(initial);
 return {markSaved:project=>{saved=stamp(project);},isDirty:project=>saved!==stamp(project)};
}

// Recover the previous draft into the archive, but never display it on launch.
// Write the archive first so a failed write cannot erase the only draft.
export async function startBlankSession(storage,empty,validate){
 const old=await storage.get('project');
 if(old!=null){
  const prior=validate(old);
  if(hasProjectWork(prior,empty)){
   const archive=await storage.get('workbench')||{projects:[],templates:[],printStyles:[]};
   if(!Array.isArray(archive.projects)||!Array.isArray(archive.templates)||!Array.isArray(archive.printStyles))throw Error('공사 보관함 형식을 확인하세요.');
   const compare=p=>{const {archiveId,archivedAt,...rest}=p;return JSON.stringify(rest);};
   if(!archive.projects.some(p=>compare(p)===compare(prior))){
    archive.projects.unshift({...prior,archiveId:crypto.randomUUID(),archivedAt:new Date().toISOString()});
    await storage.put('workbench',archive);
   }
  }
 }
 await storage.put('project',empty);
 return empty;
}

export function createCloseController(api){
 let pending=null,approved=null;
 async function prepare(options={}){
  await api.beforePrompt();
  const current=JSON.stringify(api.getProject());
  const dirty=api.isDirty?api.isDirty():hasProjectWork(api.getProject(),api.newState());
  const choice=approved===current||!dirty?'discard':options.save?'save':await api.ask();
  if(choice==='cancel')return {ok:false,cancelled:true};
  if(choice==='save'){const result=await api.save();if(result?.cancelled)return {ok:false,cancelled:true};if(result?.error)throw Error(result.error);}
  if(JSON.stringify(api.getProject())!==current)throw Error('저장 또는 종료 확인 중 작업이 변경되었습니다. 변경 내용을 확인한 뒤 다시 종료하세요.');
  await api.clearDraft();
  if(JSON.stringify(api.getProject())!==current){await api.beforePrompt();throw Error('종료 준비 중 작업이 변경되어 종료를 중단했습니다. 변경 내용은 임시 보관했습니다.');}
  approved=current;
  return {ok:true};
 }
 return options=>{
  if(!pending)pending=prepare(options).catch(e=>{api.onError(e);return {ok:false,error:e.message};}).finally(()=>pending=null);
  return pending;
 };
}

export function askSaveBeforeClose({replacing=false}={}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.id='saveBeforeClose';
  dialog.innerHTML=`<div class="dialog-head"><h2>저장하시겠습니까?</h2></div><p>현재 작업을 공사노트 파일로 저장할 수 있습니다.</p><p>${replacing?'저장하지 않으면 현재 편집 내용은 새 작업에 이어지지 않습니다.':'다음 실행은 빈 내역서로 시작합니다. 저장한 파일은 파일 → 작업 열기에서 여세요.'}</p><div class="dialog-actions"><button class="button" data-choice="cancel" autofocus>취소</button><button class="button" data-choice="discard">저장 안 함</button><button class="button primary" data-choice="save">${replacing?'저장':'저장 후 종료'}</button></div>`;
  const finish=value=>{dialog.close();dialog.remove();resolve(value);};
  dialog.addEventListener('click',e=>{const choice=e.target.closest('[data-choice]')?.dataset.choice;if(choice)finish(choice);});
  dialog.addEventListener('cancel',e=>{e.preventDefault();finish('cancel');});
  document.body.append(dialog);dialog.showModal();
 });
}
