import {workbookFileName} from './project-labels.js';
import {exportPrintExcel} from './print-excel.js';
import {printDocuments} from './est-print.js';
export const excelDocuments=printDocuments;
export function selectedWorkbookSheets(sheets,selected){
 const included=new Set(selected.map(s=>s.name));
 return structuredClone(selected).map(sheet=>{
  for(const row of sheet.rows)row.values=row.values.map(value=>{
   if(!value||typeof value!=='object'||!value.formula)return value;
   const refs=[...value.formula.matchAll(/(?:'((?:[^']|'')+)'|([^\s+\-*/(),=!<>:]+))!/g)].map(m=>(m[1]||m[2]).replaceAll("''","'"));
   if(refs.some(name=>!included.has(name))){if(value.value==null)throw Error('선택하지 않은 시트의 계산값을 확인할 수 없습니다. 관련 시트를 함께 선택하세요.');return value.value;}
   return value;
  });
  return sheet;
 });
}
export function exportSelectedExcel(project,libraries,options={}){return exportPrintExcel(project,libraries,options);}
export function setupExcelSelection(api){
 const dialog=document.createElement('dialog');dialog.id='excelExportDialog';dialog.setAttribute('aria-label','엑셀 내보내기');
 dialog.innerHTML='<div class="dialog-head"><h2>엑셀 내보내기</h2><button class="icon-btn" aria-label="엑셀 내보내기 닫기">×</button></div><div class="export-options"><p>미리보기와 같은 양식으로 저장합니다. 현재 원가계산서의 금액·낙찰률과 출력 설정을 적용합니다.</p><div class="actions"><button class="button" id="excelAll">전체 선택</button><button class="button" id="excelNone">전체 해제</button></div><div id="excelSheetList"></div><p id="excelSelectionNote" role="status"></p><p class="hint">체크한 시트만 저장합니다. 마지막 선택은 다음 실행에도 유지됩니다.</p></div><div class="dialog-actions"><button class="button" id="excelCancel">취소</button><button class="button primary" id="excelSave">선택 항목 엑셀 저장</button></div>';
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);let options={sections:['summary','groups','estimate']},saving=false;
 const remember=()=>api.preferences.set('excel',options);
 function update(){const n=options.sections.length;$('excelSelectionNote').textContent=n?`${n}개 시트 선택`: '내보낼 시트를 하나 이상 선택하세요.';$('excelSave').disabled=!n||saving;}
 function list(){$('excelSheetList').innerHTML=Object.entries(excelDocuments).map(([key,label])=>`<label><input type="checkbox" value="${key}" ${options.sections.includes(key)?'checked':''}>${label}</label>`).join('');update();}
 function changed(){options.sections=[...$('excelSheetList').querySelectorAll('input:checked')].map(x=>x.value);remember();update();}
 $('excelSheetList').onchange=changed;
 $('excelAll').onclick=()=>{$('excelSheetList').querySelectorAll('input').forEach(x=>x.checked=true);changed();};
 $('excelNone').onclick=()=>{$('excelSheetList').querySelectorAll('input').forEach(x=>x.checked=false);changed();};
 dialog.querySelector('.icon-btn').onclick=$('excelCancel').onclick=()=>dialog.close();
 $('excelSave').onclick=async()=>{if(saving)return;saving=true;update();try{
  await remember();await document.fonts.ready;
  const ctx=document.createElement('canvas').getContext('2d'),measure=(s,size)=>{ctx.font=`${size}px GulimChe,굴림체`;return ctx.measureText(s).width;};
  const project=api.snapshot(),printSettings=await api.preferences.get('print')||project.estPrintSettings||{};
  const bytes=exportSelectedExcel(project,api.getLibraries(),{...options,printSettings,measure});
  const result=await api.download(bytes,workbookFileName(project.title),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if(result?.cancelled){$('excelSelectionNote').textContent='엑셀 저장을 취소했습니다.';return;}
  api.toast(`${options.sections.length}개 시트로 엑셀을 내보냈습니다.`);dialog.close();
 }catch(e){$('excelSelectionNote').textContent=e.message;}finally{saving=false;$('excelSave').disabled=!options.sections.length;}};
 return {async open(){if(!api.getProject().lines.length){api.toast('먼저 내역을 추가하세요.');return;}
  const saved=await api.preferences.get('excel');
  options={sections:(saved?.sections||options.sections).filter(k=>k in excelDocuments)};
  if(saved?.sections?.length&&!options.sections.length)options.sections=['summary','groups','estimate'];
  list();dialog.showModal();}};
}
