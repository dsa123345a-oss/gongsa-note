import {amount} from './calc.js';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const numericKeys=['GN','NU','NC','GU','GC','JU','JC','SU','SC','TU','TC'];
// This is a view of the saved document, never a recalculated replacement.
export function originalEstimate(library){
 const table=library.tables?.find(t=>t.name.toLowerCase()==='estmaindat.dat');
 if(!table||table.error)throw Error(table?.error||'이 파일에는 원본 내역서가 없습니다.');
 let checked=0,unset=0;const differences=[];
 const rows=table.rows.map(row=>{
  let check='stored';
  if(row.Code&&(row.Level||0)===0&&Number.isFinite(row.TU)){
   if(!Number.isFinite(row.GN)){unset++;check='unset';}
   else {
    const labor=row.NU||0,material=row.GU||0,expense=row.JU||0,other=Number((row.TU-labor-material-expense).toFixed(8));
    const calculated=amount({status:'confirmed',qty:row.GN,deduction:row.GN<0?{reason:'EST 원본에 저장된 감액'}:undefined,rate:{labor,material,expense,other,total:row.TU}});
    const expected={labor:row.NC||0,material:row.GC||0,expense:row.JC||0,other:row.SC||0,total:row.TC||0};
    checked++;check=calculated&&Object.keys(expected).every(k=>calculated[k]===expected[k])?'match':'different';
    if(check==='different')differences.push({record:row._record,name:row.Name,expected,calculated});
   }
  }
  return {...row,check};
 });
 return {rows,checked,unset,differences};
}
export function originalEstimateHtml(rows){
 const display=value=>value==null?'':typeof value==='number'?value.toLocaleString('ko-KR',{maximumFractionDigits:15}):esc(value);
 return '<table class="original-est-table"><thead><tr><th rowspan="2">행</th><th rowspan="2">품명</th><th rowspan="2">규격</th><th rowspan="2">단위</th><th rowspan="2">수량</th><th colspan="2">노무비</th><th colspan="2">재료비</th><th colspan="2">경비</th><th colspan="2">기타</th><th colspan="2">합계</th></tr><tr>'+Array.from({length:5},()=>'<th>단가</th><th>금액</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>`<tr data-original-record="${r._record}" class="${r.Level?'original-heading':r.LinkIndex===58?'original-summary':''}"><td class="cell-center">${r._record+1}</td><td class="original-name" title="${esc(r.Code||'')}">${esc(r.Name)}${r.check==='different'?'<small class="error-text">재계산 확인 필요</small>':''}</td><td>${esc(r.Size)}</td><td class="cell-center">${esc(r.Unite)}</td>${numericKeys.map(key=>`<td class="number" data-original-field="${key}">${display(r[key])}</td>`).join('')}</tr>`).join('')+'</tbody></table>';
}
export function setupOriginalEst({getLibraries,toast}){
 const $=id=>document.getElementById(id);let library=null,data=null,page=0;
 $('rawOriginal').insertAdjacentHTML('beforebegin','<button class="button small" id="openOriginalEstimate">원본 내역서 보기</button>');
 document.querySelector('#estToolsDialog .tool-menu').insertAdjacentHTML('beforeend','<button class="button" id="openEstDocument">EST 파일 열기 · 원본 내역</button>');
 document.body.insertAdjacentHTML('beforeend',`<dialog id="originalEstimateDialog"><div class="dialog-head"><div><h2>EST 원본 내역서</h2><p id="originalEstimateSource"></p></div><button class="icon-btn" data-close="originalEstimateDialog" aria-label="닫기">×</button></div><div class="original-toolbar"><label class="button small">다른 EST 파일 열기<input id="originalEstimateFile" type="file" accept=".estx,.ebkx" hidden></label><input id="originalEstimateSearch" type="search" placeholder="품명·규격·코드 검색" aria-label="원본 내역서 검색"><span id="originalEstimateCheck" role="status"></span></div><div id="originalEstimateContent" class="table-wrap"></div><div class="pager"><button class="button small" id="originalEstimatePrev">← 이전</button><span id="originalEstimatePage"></span><button class="button small" id="originalEstimateNext">다음 →</button></div><p class="hint original-note">파일에 저장된 수량·단가·금액을 표시합니다. 빈 수량과 음수도 보존합니다. 원가 요율의 계산 근거와 출력 서식까지 복원한 편집 화면은 아닙니다.</p></dialog>`);
 function render(){
  const q=$('originalEstimateSearch').value.trim().toLowerCase(),rows=data.rows.filter(r=>!q||[r.Name,r.Size,r.Code].some(v=>String(v??'').toLowerCase().includes(q)));
  page=Math.min(page,Math.max(0,Math.ceil(rows.length/100)-1));
  $('originalEstimateContent').innerHTML=originalEstimateHtml(rows.slice(page*100,page*100+100));
  $('originalEstimateSource').textContent=library.name;
  $('originalEstimateCheck').textContent=`저장 행 ${data.rows.length.toLocaleString()}개 · 수량×단가 대조 ${data.checked-data.differences.length}/${data.checked}개 일치${data.unset?' · 수량 미입력 '+data.unset+'개':''}${data.differences.length?' · 재계산 확인 필요 '+data.differences.length+'개':''}`;
  $('originalEstimatePage').textContent=`${rows.length}행 · ${page+1} / ${Math.max(1,Math.ceil(rows.length/100))}`;
  $('originalEstimatePrev').disabled=page===0;$('originalEstimateNext').disabled=(page+1)*100>=rows.length;
 }
 function open(next){try{const draft=originalEstimate(next);library=next;data=draft;page=0;$('originalEstimateSearch').value='';render();if(!$('originalEstimateDialog').open)$('originalEstimateDialog').showModal();}catch(e){toast(e.message);}}
 $('openOriginalEstimate').onclick=()=>{const selected=getLibraries().find(l=>l.id===$('rawLibrary').value);if(selected)open(selected);else $('originalEstimateFile').click();};
 $('openEstDocument').onclick=()=>$('originalEstimateFile').click();
 $('originalEstimateFile').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>80*1024*1024)throw Error('파일은 80MB 이하만 지원합니다.');const {importEst}=await import('./est.js');open(await importEst(await file.arrayBuffer(),file.name));}catch(error){toast(error.message);}finally{e.target.value='';}};
 $('originalEstimateSearch').oninput=()=>{page=0;render();};$('originalEstimatePrev').onclick=()=>{page--;render();};$('originalEstimateNext').onclick=()=>{page++;render();};
 return {open};
}
