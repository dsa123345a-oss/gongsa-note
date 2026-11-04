export function updateControls(state, posting = false) {
 const restarting = ['preparing','installing'].includes(state.phase);
 const busy = posting || ['checking','downloading'].includes(state.phase) || restarting;
 return {busy,restarting,checkDisabled:busy || state.phase === 'unconfigured',download:!!state.canDownload,install:state.phase === 'ready',cancel:state.phase === 'downloading'};
}

export function setupUpdates(runtime) {
 if (!runtime?.desktop) return;
 fetch('./api/update/started',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).catch(()=>{});
 const button = document.createElement('button'); button.id = 'updateMenuBtn';
 button.className = 'button'; button.textContent = '프로그램 업데이트';
 document.querySelector('#estToolsDialog .tool-menu').append(button);
 const dialog = document.createElement('dialog');
 dialog.id = 'updateDialog';
 dialog.innerHTML = `<div class="dialog-head"><h2>프로그램 업데이트</h2><button class="icon-btn" aria-label="닫기">×</button></div><p class="update-version"></p><p class="update-status" role="status" aria-live="polite"></p><progress max="100" value="0" hidden aria-label="다운로드 진행률"></progress><p class="update-progress" hidden></p><pre class="update-notes" hidden></pre><p class="update-hint">다운로드 중에는 이 창을 닫고 작업을 계속할 수 있습니다.<br>재시작 전 현재 작업과 단가 DB를 저장·백업합니다.</p><div class="dialog-actions"><button class="button" data-update="cancel" hidden>다운로드 취소</button><button class="button" data-update="check">새 버전 확인</button><button class="button primary" data-update="download" hidden>업데이트 받기</button><button class="button primary" data-update="install" hidden>저장 후 재시작</button></div>`;
 document.body.append(dialog);
 const status = dialog.querySelector('.update-status'), progress = dialog.querySelector('progress'), notes = dialog.querySelector('.update-notes'), detail = dialog.querySelector('.update-progress');
 const check = dialog.querySelector('[data-update="check"]'), download = dialog.querySelector('[data-update="download"]'), install = dialog.querySelector('[data-update="install"]'), cancel = dialog.querySelector('[data-update="cancel"]'), close = dialog.querySelector('.icon-btn');
 dialog.querySelector('.update-version').textContent = `공사노트 v${runtime.version}`;
 let timer, loading = false, posting = false, errorText = '', lastState = {phase:'idle',message:'업데이트 상태를 확인하고 있습니다…'};
 function render() {
  const controls = updateControls(lastState, posting);
  status.textContent = errorText || lastState.message;
  check.disabled = controls.checkDisabled;
  download.hidden = !controls.download; download.disabled = controls.busy;
  install.hidden = !controls.install; install.disabled = controls.busy;
  cancel.hidden = !controls.cancel; cancel.disabled = posting;
  close.disabled = posting || controls.restarting;
  progress.hidden = !controls.cancel; progress.value = lastState.progress || 0;
  detail.hidden = progress.hidden;
  detail.textContent = `${lastState.progress || 0}% · ${((lastState.received || 0)/1048576).toFixed(1)} / ${((lastState.total || 0)/1048576).toFixed(1)} MB`;
  notes.textContent = lastState.notes || ''; notes.hidden = !lastState.notes;
 }
 async function request(action) {
  const response = await fetch('./api/update/' + action, action === 'status' ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const result = await response.json();
  if (!response.ok) throw Error(result.error || '업데이트 상태를 확인하지 못했습니다.');
  return result;
 }
 async function refresh() {
  if (loading || posting) return;
  loading = true;
  try { lastState = await request('status'); }
  catch (error) {
   if (!updateControls(lastState).restarting) errorText = error.message;
  } finally { loading = false; render(); }
 }
 for (const action of [check, download, install, cancel]) action.onclick = async () => {
  if (posting) return;
  posting = true; errorText = ''; render();
  try {
   if (action === install) {
    status.textContent = '현재 작업을 저장하고 있습니다…';
    const saved = await globalThis.gongsaPrepareClose({save:true});
    if (!saved.ok) throw Error('저장하지 못해 업데이트를 중단했습니다. 작업 파일을 별도로 저장하세요.');
   }
   await request(action.dataset.update);
   if (action === install) lastState = {...lastState,phase:'preparing',message:'자료를 백업하고 있습니다. 완료되면 새 버전으로 다시 시작합니다…'};
  } catch (error) { errorText = error.message; }
  finally { posting = false; render(); await refresh(); }
 };
 button.onclick = async () => {
  dialog.showModal(); await refresh();
  if (lastState.phase === 'idle' && !errorText) check.click();
  clearInterval(timer); timer = setInterval(refresh,1000);
 };
 close.onclick = () => dialog.close();
 dialog.addEventListener('cancel', event => { if (posting || updateControls(lastState).restarting) event.preventDefault(); });
 dialog.addEventListener('close', () => clearInterval(timer));
}
