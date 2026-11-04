import {previewSupplyFees,applySupplyFees} from './supply-fees.js';

export function setupSupplyFees(api){
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>Number(n||0).toLocaleString('ko-KR');
 const dialog=document.createElement('dialog');dialog.id='supplyFeesDialog';dialog.style.width='min(680px, calc(100vw - 40px))';
 dialog.innerHTML=`<div class="dialog-head"><div><h2>신규급수 수수료</h2><p>동일 신청·설계·검사로 처리하는 공사 전체에 각각 1건을 적용합니다.</p></div><button class="icon-btn" data-close="supplyFeesDialog" aria-label="수수료 창 닫기">×</button></div><div class="supply-fee-body"><div class="work-fields"><label>적용 계량기 구경 (mm)<input id="supplyFeeDiameter" type="number" min="1" max="2000" step="1" placeholder="구경 선택 또는 입력"></label><button class="button" id="supplyFeeInfer">관급 계량기에서 최대 구경 찾기</button></div><p id="supplyFeeBasis" class="hint"></p><div id="supplyFeeRows" class="table-wrap"></div><details><summary>구경 확인에 사용한 내역</summary><div id="supplyFeeCandidates" class="table-wrap"></div></details><label class="check" id="supplyFeeReplaceLabel" hidden><input type="checkbox" id="supplyFeeReplace">기존 설계·자재검사·준공검사 수수료를 위 3건으로 교체</label><p id="supplyFeeMessage" role="status"></p><p class="hint">계량기 수량을 곱하지 않습니다. 수수료는 제경비·부가세·낙찰률 적용에서 제외하며 원인자부담금과 별도로 합산합니다.</p></div><div class="dialog-actions"><button class="button" data-close="supplyFeesDialog">취소</button><button class="button primary" id="supplyFeeApply">수수료 적용</button></div>`;
 document.body.append(dialog);
 let basis='',inferred=null;
 function preview(){
  const p=api.getProject(),diameter=$('supplyFeeDiameter').value;
  let report;try{report=previewSupplyFees(p,{diameter:diameter===''?null:Number(diameter),basis,replaceExisting:$('supplyFeeReplace').checked});}catch(e){$('supplyFeeMessage').textContent=e.message;$('supplyFeeApply').disabled=true;return null;}
  const existing=(report.existing||[]).filter(r=>!r.generated);
  $('supplyFeeReplaceLabel').hidden=!existing.length;
  $('supplyFeeRows').innerHTML='<table><thead><tr><th>항목</th><th>수량</th><th>단위</th><th>금액</th></tr></thead><tbody>'+(report.rows||[]).map(r=>`<tr><td>${esc(r.name)}</td><td class="cell-center">1</td><td class="cell-center">건</td><td class="number">${money(r.amount)}</td></tr>`).join('')+`</tbody><tfoot><tr><th colspan="3">수수료 합계</th><th class="number">${money(report.total)}원</th></tr></tfoot></table>`;
  const candidates=inferred?.candidates||report.candidates||[];
  $('supplyFeeCandidates').innerHTML=candidates.length?'<table><thead><tr><th>품명</th><th>규격</th><th>구경</th></tr></thead><tbody>'+candidates.map(c=>`<tr><td>${esc(c.name||c.line?.name||'')}</td><td>${esc(c.spec||c.line?.spec||'')}</td><td>${esc(c.diameter)} mm</td></tr>`).join('')+'</tbody></table>':'<p>관급 계량기 구경을 확정할 내역이 없습니다. 계량기를 확인하고 구경을 입력하세요.</p>';
  $('supplyFeeBasis').textContent=basis||'같은 신청의 관급 계량기 중 가장 큰 구경을 적용합니다. 관로·새들·보호통 규격은 사용하지 않습니다.';
  $('supplyFeeMessage').textContent=[...(report.warnings||[]),existing.length?'기존 수수료가 있습니다. 교체를 선택하지 않으면 기존 금액을 유지합니다.':''].join(' ');
  const blockedByExisting=existing.length&&!$('supplyFeeReplace').checked;
  const emergency=p.workType==='emergency'||/긴급보수/.test(p.title||'');
  if(emergency)$('supplyFeeMessage').textContent='긴급보수 공사에는 신규급수 수수료를 자동 추가하지 않습니다.';
  $('supplyFeeApply').disabled=emergency||diameter===''||!report.canApply||!!blockedByExisting;
  return report;
 }
 function infer(){
  inferred=previewSupplyFees(api.getProject(),{infer:true});
  $('supplyFeeDiameter').value=inferred.diameterConfirmed?inferred.diameter??'':'';
  basis=inferred.diameterConfirmed?'관급 계량기 중 가장 큰 구경 · 동일 신청·설계·검사 1건':'';
  preview();
  if(!inferred.canApply)$('supplyFeeMessage').textContent=(inferred.warnings||[]).join(' ')||'관급 계량기 구경을 확인하여 입력하세요.';
 }
 function open(){
  const p=api.getProject();$('supplyFeeReplace').checked=false;inferred=previewSupplyFees(p,{infer:true});
  const current=previewSupplyFees(p);
  $('supplyFeeDiameter').value=current.diameterConfirmed?current.diameter??'':'';
  basis=current.diameterConfirmed?current.basis:'';
  preview();
  if(!current.diameterConfirmed)$('supplyFeeMessage').textContent=(current.warnings||[]).join(' ');
  dialog.showModal();
 }
 $('supplyFeeInfer').onclick=infer;
 $('supplyFeeDiameter').oninput=()=>{basis='사용자 확인 계량기 구경 · 동일 신청·설계·검사 1건';preview();};
 $('supplyFeeReplace').onchange=preview;
 $('supplyFeeApply').onclick=()=>{try{
  const diameter=$('supplyFeeDiameter').value;if(!diameter)throw Error('적용 계량기 구경을 입력하세요.');
  const result=applySupplyFees(api.getProject(),{diameter:Number(diameter),basis,replaceExisting:$('supplyFeeReplace').checked});
  if(result.report?.blocked)throw Error((result.report.warnings||[]).join(' ')||'기존 수수료와 적용 범위를 확인하세요.');
  api.replaceProject(result.project);dialog.close();api.toast('설계·자재검사·준공검사 수수료를 각각 1건으로 적용했습니다.');
 }catch(e){$('supplyFeeMessage').textContent=e.message;}};
 const button=document.createElement('button');button.id='supplyFeesTool';button.className='button';button.textContent='신규급수 수수료';button.onclick=open;$('estToolsDialog').querySelector('.tool-menu').append(button);
 document.addEventListener('click',e=>{if(e.target.closest('[data-supply-fees]'))open();});
 return {open};
}
