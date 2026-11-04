import {readWorkbook,extractQuantities} from './workbook.js';
import {supplementGovernmentQuantities} from './quantity-government.js';
import {nextSectionNumber,quantitySiteName,buildQuantityProject,quantitySupplyFeeAvailability} from './quantity-batch.js';
import {sectionTitle} from './project-labels.js';
import {previewSupplyFees,applySupplyFees} from './supply-fees.js';
export function setupQuantityImport(api){
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let entries=[],previewIndex=0,feeDraft=null,feePreview=null,feeChoiceTouched=false,feeDiameterTouched=false;
 $('sheetDialog').innerHTML=`<div class="dialog-head"><div><h2>수량산출서 가져오기</h2><p>파일 순서대로 공구를 만듭니다. 토공·관로도 등 중복 시트 대신 최종 수량 시트를 선택하세요.</p></div><button class="icon-btn" data-close="sheetDialog" aria-label="수량 가져오기 닫기">×</button></div><div class="quantity-batch-controls"><label>가져오기 방식 <select id="quantityMode"><option value="replace">현재 내역 교체</option><option value="append">기존 내역 뒤에 추가</option></select></label><label class="check"><input type="checkbox" id="quantityNumbered">공구별 L2 자동 번호</label><label>시작 공구 <input id="quantityStart" type="number" min="1" max="9999" value="1"></label><label>공사명 <input id="quantityContractTitle" value="상수도긴급보수공사" maxlength="100"></label></div><div class="quantity-batch-list table-wrap" id="quantityFiles"></div><p id="quantityPreviewTitle"></p><p id="quantityGovernmentNote" class="notice" hidden></p><div id="quantityPreview" class="table-wrap preview"></div><div class="dialog-actions"><span id="quantityPreviewCount"></span><button class="button primary" id="confirmQuantity">수량 가져오기</button></div>`;
 $('quantityFiles').insertAdjacentHTML('beforebegin',`<fieldset id="quantitySupplyFees" class="export-options"><label class="check"><input type="checkbox" id="quantitySupplyFeesEnabled">신규급수 수수료 함께 추가</label><span>동일 신청·설계·검사: 설계·자재검사·준공검사 각각 1건</span><div class="actions"><label>적용 계량기 구경 <input id="quantitySupplyFeeDiameter" type="number" min="1" max="2000" step="1" inputmode="numeric" style="width:90px" aria-label="수수료 적용 계량기 구경"> mm</label><button type="button" class="button small" id="quantitySupplyFeeConfirm">이 구경 사용</button><span>관급 계량기 중 가장 큰 구경 · 직접 수정 가능</span></div><p id="quantitySupplyFeeAmounts"></p><p id="quantitySupplyFeeHint" class="hint" role="status"></p></fieldset>`);
 const batchOptions=()=>({append:$('quantityMode').value==='append',numbered:$('quantityNumbered').checked,start:Number($('quantityStart').value),contractTitle:$('quantityContractTitle').value});
 const feeBasis=()=>feeDiameterTouched?'사용자 확인 계량기 구경 · 동일 신청·설계·검사 각각 1건':'수량산출서의 관급 계량기 중 최대 구경 · 동일 신청·설계·검사 각각 1건';
 const messages=values=>(values||[]).map(v=>typeof v==='string'?v:v.message||v.reason||'기존 수수료 확인 필요');
 function renderFees(rebuild=true){
  const options=batchOptions(),context=quantitySupplyFeeAvailability(api.getProject(),entries,options),enabled=$('quantitySupplyFeesEnabled'),diameter=$('quantitySupplyFeeDiameter');
  enabled.disabled=!context.allowed;
  if(!context.allowed)enabled.checked=false;else if(!feeChoiceTouched)enabled.checked=context.defaultEnabled;
  diameter.disabled=!context.allowed||!enabled.checked;
  $('quantitySupplyFeeConfirm').disabled=diameter.disabled;
  feePreview=null;
  if(!context.allowed){feeDraft=null;$('quantitySupplyFeeAmounts').textContent='';$('quantitySupplyFeeHint').textContent=context.reason;return;}
  try{
   if(rebuild)feeDraft=buildQuantityProject(api.getProject(),entries,options);
   if(!feeDraft)return;
   if(!feeDiameterTouched){const suggestion=previewSupplyFees(feeDraft,{infer:true});diameter.value=suggestion.suggestedDiameter??suggestion.diameter??'';}
   const selected=diameter.value.trim()?Number(diameter.value):undefined;
   feePreview=previewSupplyFees(feeDraft,{...(feeDiameterTouched?{diameter:selected}:{}),basis:feeBasis(),infer:!feeDiameterTouched});
   if(feeDiameterTouched&&!diameter.value.trim())feePreview={...feePreview,canApply:false,rows:[],total:0,warnings:['적용 계량기 구경을 입력하세요.']};
   $('quantitySupplyFeeAmounts').textContent=(feePreview.rows||[]).length?(feePreview.rows||[]).map(r=>r.name+' 1건 '+Number(r.amount).toLocaleString('ko-KR')+'원').join(' · ')+' / 합계 '+Number(feePreview.total||0).toLocaleString('ko-KR')+'원':'관급 계량기 구경을 확인하면 수수료 3종의 금액을 표시합니다.';
   const notes=[...messages(feePreview.warnings),...messages(feePreview.conflicts)];
   if(!enabled.checked)notes.unshift(context.kind==='new'?'선택하면 수량과 함께 수수료를 추가합니다.':'신규급수 한 신청 건일 때 선택하세요.');
   if(enabled.checked&&!feePreview.canApply)notes.push('수수료는 추가하지 않고 수량만 가져옵니다. 기존 수수료가 있으면 그대로 유지합니다.');
   if(!notes.length)notes.push('계량기 수와 관계없이 각각 1건입니다. 원인자부담금은 별도로 처리합니다.');
   $('quantitySupplyFeeHint').textContent=[...new Set(notes)].join(' ');
  }catch(error){feeDraft=null;$('quantitySupplyFeeAmounts').textContent='';$('quantitySupplyFeeHint').textContent=error.message;}
 }
 function render(){
  const numbered=$('quantityNumbered').checked,start=Number($('quantityStart').value);
  $('quantityStart').disabled=$('quantityContractTitle').disabled=!numbered;
  $('quantityFiles').innerHTML='<table><thead><tr><th>공구</th><th>수량산출서 · 미리보기</th><th>수량 시트</th><th>L2 공사명에 넣을 현장명</th><th>순서</th></tr></thead><tbody>'+entries.map((e,i)=>`<tr class="${i===previewIndex?'quantity-current':''}"><td>${numbered?start+i+'공구':i+1}</td><td><button class="text-btn" data-quantity-preview="${i}">${esc(e.file)}</button><small>${e.quantity.rows.length}항목 · 미계산 ${e.quantity.rows.filter(l=>l.qty===null).length}건${e.titleWarning?" · "+esc(e.titleWarning):""}</small></td><td><select data-quantity-sheet="${i}" aria-label="${esc(e.file)} 수량 시트">${e.sheets.map((s,j)=>`<option value="${j}" ${j===e.sheet?'selected':''}>${esc(s.name)}</option>`).join('')}</select></td><td><input data-quantity-site="${i}" aria-label="${i+1}번째 파일 현장명" value="${esc(e.site)}" ${!numbered?'disabled':''}></td><td><button class="button small" data-quantity-move="${i}" data-step="-1" aria-label="${i+1}번째 파일 위로" ${i===0?'disabled':''}>↑</button><button class="button small" data-quantity-move="${i}" data-step="1" aria-label="${i+1}번째 파일 아래로" ${i===entries.length-1?'disabled':''}>↓</button></td></tr>`).join('')+'</tbody></table>';
  const entry=entries[previewIndex],q=entry.quantity;
  const name=numbered?sectionTitle(start+previewIndex,entry.site):q.title||entry.file;
  $('quantityPreviewTitle').textContent='L2 미리보기: '+name;
  const supplement=q.governmentSupplement,governmentNotes=[];
  if(supplement?.added)governmentNotes.push(`${supplement.sourceSheets.join(' · ')} 시트에서 관급자재 ${supplement.added}행을 함께 가져옵니다.`);
  if(supplement?.corrected)governmentNotes.push(`다른 시트의 관급자재와 일치하는 ${supplement.corrected}행의 계상 구분을 바로잡았습니다.`);
  governmentNotes.push(...(supplement?.warnings||[]));
  $('quantityGovernmentNote').hidden=!governmentNotes.length;$('quantityGovernmentNote').textContent=governmentNotes.join(' ');
  $('quantityPreview').innerHTML='<table><thead><tr><th>L1 공종</th><th>품명</th><th>규격</th><th>단위</th><th>수량</th><th>원본 셀</th></tr></thead><tbody>'+q.rows.map(l=>`<tr><td>${esc(l.group)}</td><td>${esc(l.name)}</td><td>${esc(l.spec)}</td><td>${esc(l.unit)}</td><td class="number">${l.qty===null?'<strong class="error-text">미계산</strong>':esc(l.qty)}</td><td>${esc(l.source)}</td></tr>`).join('')+'</tbody></table>';
  const invalid=entries.some(e=>!e.quantity.rows.length);
  $('quantityPreviewCount').textContent=`${entries.length}개 파일 · ${entries.reduce((n,e)=>n+e.quantity.rows.length,0)}항목 · 미계산 ${entries.reduce((n,e)=>n+e.quantity.rows.filter(l=>l.qty===null).length,0)}건 (미계산은 0으로 확정하지 않습니다) · 공구 L2 / 공종 L1${invalid?' · 수량이 없는 파일의 시트를 확인하세요.':''}`;
  $('confirmQuantity').disabled=invalid;
  renderFees();
 }
 $('quantityFiles').oninput=e=>{if(e.target.dataset.quantitySite!==undefined){entries[Number(e.target.dataset.quantitySite)].site=e.target.value;const i=Number(e.target.dataset.quantitySite);if(i===previewIndex)$('quantityPreviewTitle').textContent='L2 미리보기: '+sectionTitle(Number($('quantityStart').value)+i,e.target.value);}};
 $('quantityFiles').onchange=e=>{const i=e.target.dataset.quantitySheet;if(i!==undefined){const entry=entries[Number(i)];entry.sheet=Number(e.target.value);entry.quantity=supplementGovernmentQuantities(entry.sheets,entry.sheet);entry.site=quantitySiteName(entry.quantity.title,entry.file);previewIndex=Number(i);render();}};
 $('quantityFiles').onclick=e=>{const preview=e.target.closest('[data-quantity-preview]'),move=e.target.closest('[data-quantity-move]');if(preview){previewIndex=Number(preview.dataset.quantityPreview);render();}if(move){const i=Number(move.dataset.quantityMove),j=i+Number(move.dataset.step);if(j<0||j>=entries.length)return;[entries[i],entries[j]]=[entries[j],entries[i]];previewIndex=j;render();}};
 for(const id of ['quantityNumbered','quantityStart','quantityContractTitle'])$(id).onchange=()=>{if(id==='quantityNumbered'){feeChoiceTouched=false;feeDiameterTouched=false;}render();};
 $('quantityMode').onchange=()=>{feeChoiceTouched=false;feeDiameterTouched=false;$('quantityStart').value=$('quantityMode').value==='append'?nextSectionNumber(api.getProject()):1;render();};
 $('quantitySupplyFeesEnabled').onchange=()=>{feeChoiceTouched=true;renderFees(false);};
 $('quantitySupplyFeeDiameter').oninput=()=>{feeDiameterTouched=true;renderFees(false);};
 $('quantitySupplyFeeConfirm').onclick=()=>{feeDiameterTouched=true;renderFees(false);};
 $('confirmQuantity').onclick=()=>{try{
  const append=$('quantityMode').value==='append';
  let next=buildQuantityProject(api.getProject(),entries,batchOptions()),feeNote='';
  if(!append&&api.getProject().lines.length&&!confirm('현재 내역을 이 수량산출서로 교체할까요? 되살리기로 복구할 수 있습니다.'))return;
  const context=quantitySupplyFeeAvailability(api.getProject(),entries,batchOptions());
  if(context.allowed&&$('quantitySupplyFeesEnabled').checked){
   const raw=$('quantitySupplyFeeDiameter').value.trim(),diameter=raw?Number(raw):undefined,preview=previewSupplyFees(next,{...(feeDiameterTouched?{diameter}:{}),basis:feeBasis(),infer:!feeDiameterTouched});
   if(preview.canApply&&raw){
    const result=applySupplyFees(next,{diameter:preview.diameter??diameter,basis:feeBasis(),replaceExisting:false});
    if(result.report?.blocked)feeNote=' · 기존 수수료 유지';else{next=result.project;next.workType='new';feeNote=' · 수수료 '+Number(preview.total).toLocaleString('ko-KR')+'원 적용';}
   }else feeNote=' · 수수료 미적용: 적용 구경 또는 기존 수수료를 확인하세요';
  }
  api.commit(next);$('sheetDialog').close();api.toast(`${entries.length}개 수량산출서를 L2 공사 · L1 공종으로 가져왔습니다.${feeNote}`);
 }catch(e){api.toast(e.message);}};
 return {async open(files){api.busy('수량산출서의 수량과 참조 수식을 확인하고 있습니다…');try{
  if(files.length>100)throw Error('한 번에 수량산출서 100개까지 선택하세요.');
  const incoming=[];
  for(const f of [...files].sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}))){
   if(f.size>40*1024*1024)throw Error(f.name+': 파일 크기는 40MB 이하만 지원합니다.');
   let sheets;try{sheets=await readWorkbook(await f.arrayBuffer(),{fileName:f.name});}catch(e){throw Error(f.name+': '+e.message);}
   let sheet=sheets.findIndex(s=>s.name==='수량');if(sheet<0)sheet=sheets.findIndex(s=>/수량/.test(s.name)&&extractQuantities(s).rows.length);if(sheet<0)sheet=0;
   if(!sheets.length)throw Error(f.name+': 읽을 시트가 없습니다.');
   const quantity=supplementGovernmentQuantities(sheets,sheet),fileNo=f.name.match(/(\d+)\s*공구/)?.[1],inside=sheets[sheet].rows.slice(0,5).flatMap(r=>Object.values(r.cells)).map(c=>String(c.value)).join(' '),sheetNo=inside.match(/(\d+)\s*공구/)?.[1];incoming.push({file:f.name,sheets,sheet,quantity,titleWarning:fileNo&&sheetNo&&fileNo!==sheetNo?'파일명 '+fileNo+'공구 / 시트 '+sheetNo+'공구 불일치':'',site:quantitySiteName(quantity.title,f.name)});
  }
  if(!incoming.length)return;entries=incoming;previewIndex=0;feeChoiceTouched=false;feeDiameterTouched=false;feeDraft=null;feePreview=null;
  $('quantityMode').value=api.getProject().lines.length?'append':'replace';
  $('quantityNumbered').checked=files.length>1||files.some(f=>/공구|긴급|보수/.test(f.name));
  $('quantityStart').value=api.getProject().lines.length?nextSectionNumber(api.getProject()):1;
  render();$('sheetDialog').showModal();
 }catch(e){api.toast(e.message);}finally{api.idle();$('quantityInput').value='';}}};
}
