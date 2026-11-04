import {removeAssemblyPart} from './assembly-structure.js';
import {calculationModes,manualCalculation} from './calculation-modes.js';
import {refreshComponents} from './est-edit.js';
import {norm} from './calc.js';
import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
export function calculateAssembly(parts,options={}){return calculateAssemblyDetailed(parts,options).result;}
export function setupAssembly(getItems,onSave,getLibraries=()=>[]){
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const labels={labor:'노무',material:'재료',expense:'경비',other:'기타',total:'합계'};
 let parts=[],candidates=[],context=null,pendingRefresh=null,origin=null;
 const input=(i,k,v,w=80)=>`<input style="width:${w}px" data-part-field="${k}" aria-label="구성 ${i+1} ${k}" value="${esc(v)}">`;
 const select=(i,k,v,choices)=>`<select data-part-field="${k}" aria-label="구성 ${i+1} ${k}">${Object.entries(choices).map(([key,label])=>`<option value="${key}" ${key===v?'selected':''}>${label}</option>`).join('')}</select>`;
 const options=()=>({variables:$('assemblyCategory').value==='단가산출'?$('assemblyVariables').value:'',outputQuantity:$('assemblyOutput').value,expenseOnly:$('assemblyExpense').checked,componentDigits:Number($('assemblyDigits').value)});
 function total(){try{const calc=calculateAssemblyDetailed(parts,options()),r=calc.result;
  $('assemblyTotal').textContent=`노무 ${r.labor.toLocaleString()} · 재료 ${r.material.toLocaleString()} · 경비 ${r.expense.toLocaleString()} · 기타 ${r.other.toLocaleString()} → 단위당 ${r.total.toLocaleString()}원 (기준 수량 ${calc.divisor})`;
  $('assemblyVariablesResult').textContent=calc.variables.map(v=>`${v.name} = ${v.value}`).join('  ·  ');
  for(const row of calc.rows){const cell=$('assemblyParts').querySelector(`[data-part-amount="${row.index}"]`);if(cell)cell.textContent=row.amount.total.toLocaleString();}
  $('assemblySave').disabled=!parts.length;return calc;
 }catch(e){$('assemblyTotal').textContent=e.message;$('assemblySave').disabled=true;return null;}}
 function render(){
  $('assemblyParts').innerHTML='<table><thead><tr><th>No.</th><th>구성 품명 / 출처</th><th>단락</th><th>색인</th><th>단위</th><th>수량 · 산식 / 집계 설정</th><th>노무 단가</th><th>재료 단가</th><th>경비 단가</th><th>기타 단가</th><th>계산 금액</th><th>계산 방식</th><th></th></tr></thead><tbody>'+parts.map((p,i)=>{
   const aggregate=p.kind==='percent'||p.kind==='subtotal';
   return `<tr data-part="${i}" class="${aggregate?'assembly-aggregate':''}"><td>${i+1}</td><td>${input(i,'name',p.name,175)}<small class="row-source">${esc(p.source||'직접 입력')} ${esc(p.code||'')}${p.sourceComponent?' · '+labels[p.sourceComponent]+'만 적용':''}${p.fixedPrice?' · 원문 고정 단가':''}</small></td><td>${input(i,'section',p.section||'1',40)}</td><td>${input(i,'sumTag',p.sumTag||'',40)}</td><td>${input(i,'unit',p.unit||'식',42)}</td><td>${aggregate?
    `${select(i,'scope',p.scope||'all',{all:'위쪽 모든 항목',section:'같은 단락',nearest:'같은 단락 최근 비목',tag:'동일 색인 SUM'})}${p.scope==='tag'?`기준 색인 ${input(i,'basisTag',p.basisTag??p.sumTag??'',40)}`:''}${select(i,'basis',p.basis||'labor',labels)}${p.kind==='subtotal'?`시작행 ${input(i,'startRow',p.startRow||1,40)}<small>표시 소계 · 중복 합산 제외</small>`:`${input(i,'percent',p.percent??2,44)}% → ${select(i,'target',p.target||'expense',{...Object.fromEntries(costKeys.map(k=>[k,labels[k]])),components:'각 비목'})}`}`:
    input(i,'qtyExpression',p.qtyExpression??p.qty??1,100)}</td>${costKeys.map(k=>`<td>${aggregate?'—':input(i,k,p[k]??0,80)}</td>`).join('')}<td class="number calculated" data-part-amount="${i}"></td><td>${p.replaceRunning?'<small>위 구성 합계를 대체하는 환산</small>':''}${p.allowNegative?'<small>공제(음수) 허용</small>':''}${p.kind==='subtotal'?'소계':select(i,'calculationMode',p.calculationMode||(p.exclude?'vertical':'auto'),calculationModes)}${manualCalculation(p)?`<div class="manual-component-amounts">${costKeys.map(k=>`<label>${labels[k]} 금액 ${input(i,'manual_'+k,p.manualAmounts?.[k]??0,85)}</label>`).join('')}</div>`:''}</td><td><button class="button small" data-part-delete="${i}" aria-label="구성 ${i+1} 삭제">×</button></td></tr>`;
  }).join('')+'</tbody></table>';total();
 }
 function search(){const terms=$('assemblySearch').value.split(/[\s&]+/).map(norm).filter(Boolean);candidates=terms.length?getItems().filter(i=>terms.every(q=>norm(i.name+' '+i.spec+' '+i.code).includes(q))).slice(0,50):[];$('assemblyResults').innerHTML=candidates.map((p,i)=>`<button class="button small" data-part-add="${i}">${esc(p.name)} ${esc(p.spec)} · ${p.total.toLocaleString()}원/${esc(p.unit)} · ${esc(p.source)}</button>`).join('');}
 $('assemblySearch').oninput=search;
 $('assemblyResults').onclick=e=>{const b=e.target.closest('[data-part-add]');if(b){parts.push({...candidates[Number(b.dataset.partAdd)],qty:1,qtyExpression:'1',section:'1'});render();}};
 $('assemblyManual').onclick=()=>{parts.push({name:'직접 입력',unit:'식',qty:1,section:'1',labor:0,material:0,expense:0,other:0});render();};
 $('assemblyPercent').onclick=()=>{parts.push({kind:'percent',name:'공구손료 · 잡비',unit:'식',scope:$('assemblyCategory').value==='단가산출'?'nearest':'all',basis:'labor',target:'expense',percent:2,section:parts.at(-1)?.section||'1'});render();};
 $('assemblySum').onclick=()=>{parts.push({kind:'percent',name:'색인 합계 비율',unit:'식',scope:'tag',basis:'labor',target:'expense',percent:2,sumTag:'A',section:'1'});render();};
 $('assemblySubtotal').onclick=()=>{parts.push({kind:'subtotal',name:'비목 소계',unit:'식',scope:'section',basis:'labor',target:'labor',startRow:1,section:parts.at(-1)?.section||'1'});render();};
 $('assemblyParts').oninput=e=>{const tr=e.target.closest('[data-part]'),k=e.target.dataset.partField;if(tr&&k){const p=parts[Number(tr.dataset.part)];if(k==='calculationMode'){let current=p.manualAmounts;if(manualCalculation({calculationMode:e.target.value})&&!manualCalculation(p)){try{current=calculateAssemblyDetailed(parts,options()).rows[Number(tr.dataset.part)].amount;}catch(err){$('assemblyTotal').textContent=err.message;render();return;}}p.calculationMode=e.target.value;p.exclude=false;if(manualCalculation(p))p.manualAmounts=Object.fromEntries(costKeys.map(key=>[key,Math.trunc(current?.[key]??0)]));else delete p.manualAmounts;render();return;}if(k.startsWith('manual_')){p.manualAmounts??={};p.manualAmounts[k.slice(7)]=e.target.value.trim()===''?null:Number(e.target.value);}else {p[k]=e.target.value;if(k==='startRow')delete p.startRowInvalid;if(k==='scope'){render();return;}}total();}};
 $('assemblyParts').onclick=e=>{const b=e.target.closest('[data-part-delete]');if(b){parts=removeAssemblyPart(parts,Number(b.dataset.partDelete));render();}};
 $('assemblyCategory').onchange=()=>{$('assemblyVariablePanel').hidden=$('assemblyCategory').value!=='단가산출';total();};
 for(const id of ['assemblyVariables','assemblyOutput','assemblyExpense','assemblyDigits'])$(id).oninput=total;
 $('assemblySave').onclick=async()=>{try{const name=$('assemblyName').value.trim(),unit=$('assemblyUnit').value.trim();if(!name||!unit||!parts.length)throw Error('품명, 단위와 구성 항목을 입력하세요.');const calc=calculateAssemblyDetailed(parts,options());
  const rate={id:crypto.randomUUID(),code:'USER-'+Date.now(),name,spec:$('assemblySpec').value.trim(),unit,category:$('assemblyCategory').value,...calc.result,components:structuredClone(parts),calculation:options(),source:'나의 단가',table:'UserAssembly',record:0,origin};
  $('assemblySave').disabled=true;await onSave(rate,context);$('assemblyDialog').close();
 }catch(e){$('assemblyTotal').textContent=e.message;$('assemblySave').disabled=false;}};
 $('assemblyRefreshPreview').onclick=()=>{try{const lib=getLibraries().find(l=>l.id===$('assemblyRefreshLibrary').value);if(!lib)throw Error('갱신할 DB를 선택하세요.');pendingRefresh=refreshComponents({components:parts,calculation:options()},lib);$('assemblyRefreshInfo').textContent=pendingRefresh.changes.map(c=>`${c.name}: ${c.before.toLocaleString()} → ${c.after.toLocaleString()}`).join(' / ')+(pendingRefresh.skipped.length?` · 일치 없음 ${pendingRefresh.skipped.length}건 유지`:'');$('assemblyRefreshApply').hidden=!pendingRefresh.changes.length;}catch(e){$('assemblyRefreshInfo').textContent=e.message;}};
 $('assemblyRefreshApply').onclick=()=>{if(!pendingRefresh)return;parts=pendingRefresh.item.components;pendingRefresh=null;$('assemblyRefreshApply').hidden=true;render();};
 return {open(item,category,applyContext=null){
  context=applyContext;origin=item?{source:item.source,code:item.code}:null;pendingRefresh=null;$('assemblyApplyLabel').hidden=true;$('assemblyApplyLine').checked=!!context;
  $('assemblySave').textContent=context?'저장 · 내역서에 적용':'나의 단가에 저장';
  $('assemblyRefreshApply').hidden=true;$('assemblyRefreshInfo').textContent=item?.conversionNote||'';
  $('assemblyRefreshLibrary').innerHTML=getLibraries().filter(l=>!l.userLibrary).map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');
  $('assemblyDigits').value=String(item?.calculation?.componentDigits??0);
  parts=item?(item.components?structuredClone(item.components):[{...item,qty:1,qtyExpression:'1',source:item.source+' · 저장 단가 1식'}]):[];
  $('assemblyName').value=item?item.name:'';$('assemblySpec').value=item?.spec||'';$('assemblyUnit').value=item?.unit||'';
  $('assemblyCategory').value=category||(['일위대가','단가산출'].includes(item?.category)?item.category:'일위대가');
  $('assemblyVariables').value=item?.calculation?.variables||'';$('assemblyOutput').value=item?.calculation?.outputQuantity||1;$('assemblyExpense').checked=!!item?.calculation?.expenseOnly;
  $('assemblyVariablePanel').hidden=$('assemblyCategory').value!=='단가산출';$('assemblySearch').value='';$('assemblyResults').innerHTML='';render();$('assemblyDialog').showModal();
 }};
}
