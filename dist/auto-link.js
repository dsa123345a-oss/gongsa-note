import {createResourcePricer,resourceLibrary} from './resource-pricing.js';
import {referencedQuantityRate} from './quantity-contract.js';
import {nameNorm,textSimilarity,compareSpecs,specNorm,pipeWork,compatibleUnits,compatibleWork,incompatibleWorkReason,wasteMatchIssue} from './match-similarity.js';
import {norm,unitNorm,amount} from './calc.js';
import {connectionKind,learningIndex,learnedChoices,targetIdentity,getActiveLearning} from './connection-learning.js';

export const lineSignature=l=>[norm(l.group),norm(l.name),norm(l.spec),unitNorm(l.unit)].join('|');
export const pendingAuto=l=>!!l.autoMatch&&!l.autoMatch.reviewed&&l.status==='confirmed';
export const retryableAuto=l=>!!l.autoMatch?.before&&!l.autoMatch.reviewed&&!l.level&&!l.exclude&&!l.surcharge&&!l.deduction;
export function resetPendingAutoLinks(project,ids=null){
 const next=structuredClone(project);for(const l of next.lines){if(!retryableAuto(l)||ids&&!ids.has(l.id))continue;const before=l.autoMatch.before;for(const k of ['name','spec','unit'])l[k]=before[k];l.factor=before.factor??1;l.rate=null;l.status='unmatched';delete l.originalExpenseRate;delete l.autoMatch;delete l.proposed;}return next;
}
export function applyReplannedLinks(project,rows,batchId){return applyAutoLinks(resetPendingAutoLinks(project,new Set(rows.filter(r=>r.rate).map(r=>r.line.id))),rows,batchId);}

export function incompatibleAutoLinks(project){return project.lines.filter(l=>!l.level&&l.rate&&l.autoMatch?.before&&!l.autoMatch.reviewed&&!compatibleWork(l.autoMatch.before,l.rate));}
export function resetIncompatibleAutoLinks(project){
 const next=structuredClone(project),ids=new Set(incompatibleAutoLinks(project).map(l=>l.id));
 for(const l of next.lines){if(!ids.has(l.id))continue;const before=l.autoMatch.before;
  l.autoRepair={name:l.rate.name,spec:l.rate.spec,source:l.rate.source,reason:incompatibleWorkReason(before,l.rate)||'단위가 다름'};
  for(const key of ['name','spec','unit'])l[key]=before[key];
  l.rate=null;l.status='unmatched';l.factor=before.factor??1;delete l.originalExpenseRate;delete l.autoMatch;delete l.proposed;
 }
 return next;
}

// Rank by names and specifications, never by cheapest price or DB code alone.
export function preferredLibrary(project,libraries){
 const saved=project.autoLinkPriority;
 if(saved?.id==='')return '';
 return (libraries.find(l=>l.id===saved?.id)||libraries.find(l=>l.name===saved?.name)||libraries.find(l=>!l.isMain&&!l.userLibrary&&!/\d{4}-\d{2}-main\.estx$/i.test(l.name))||libraries.find(l=>l.isMain)||libraries[0])?.id||'';
}
export function planAutoLinks(project,libraries,libraryId='',priorityId='',profile=getActiveLearning()){
 const items=libraries.filter(l=>!libraryId||l.id===libraryId).flatMap(l=>l.items.map(item=>({item,identity:targetIdentity(item),name:norm(item.name),matchingName:nameNorm(item.name),spec:norm(item.spec),unit:unitNorm(item.unit),source:l.name,library:l.id})));
 const cache=new Map(),nameScores=new Map(),learned=learningIndex(project.connectionLearningEnabled===false?{rules:[]}:profile),kind=connectionKind(project),pricer=(project.resourcePriceLibrary||resourceLibrary(project,libraries))?createResourcePricer(project,libraries):null;
 return project.lines.filter(l=>!l.level&&!l.exclude&&!l.surcharge&&!l.deduction&&l.status!=='confirmed').map(line=>{
  const signature=lineSignature(line),site=/폐기물/.test(nameNorm(line.name))?[line.sourceFile||'',line.location||''].join('|'):'',cacheKey=signature+'|'+site+'|'+(line.specError||'')+'|'+JSON.stringify(line.dbReference||null);if(cache.has(cacheKey))return {...cache.get(cacheKey),line};
  const unresolved=wasteMatchIssue(line);if(unresolved){const result={line,reason:unresolved+' · 원본 규격 확인 후 연결',recommended:false,exact:false,score:0};cache.set(cacheKey,result);return result;}
  const reference=referencedQuantityRate(line,items);
  if(reference){
   const priced=reference.rate&&pricer?pricer.reprice(reference.rate):null;
   const result={line,rate:priced?.rate||reference.rate,reason:reference.reason+(priced?' · '+(priced.ready?'기준 노임·자재·장비 재계산':'기준가격 확인 필요'):''),recommended:!!reference.rate&&priced?.ready!==false,exact:!!reference.rate,score:reference.rate?100:0};
   cache.set(cacheKey,result);return result;
  }
  const name=norm(line.name),matchingName=nameNorm(line.name),spec=norm(line.spec),unit=unitNorm(line.unit),saved=project.mappings?.[signature],found=[],seen=new Set();
  if(!nameScores.has(matchingName))nameScores.set(matchingName,new Map());const scores=nameScores.get(matchingName);
  const choices=learnedChoices(line,kind,learned),choiceMap=new Map();for(const choice of choices){if(!choiceMap.has(choice.identity)||choiceMap.get(choice.identity).bonus<choice.bonus)choiceMap.set(choice.identity,choice);}
  for(const entry of items){
   const {item}=entry;if(!name||!entry.name)continue;
   if(!['labor','material','expense','other','total'].every(k=>Number.isFinite(item[k])))continue;
   if(item.total<0||['labor','material','expense'].some(k=>item[k]<0))continue;
   const knowledge=choiceMap.get(entry.identity);
   let n=scores.get(entry.matchingName);if(n===undefined){n=textSimilarity(matchingName,entry.matchingName);scores.set(entry.matchingName,n);}if(n<0.48&&!knowledge?.strong)continue;
   if(!compatibleWork(line,item))continue;
   const key=JSON.stringify([entry.library,entry.source,item.code,entry.name,entry.spec,entry.unit,item.labor,item.material,item.expense,item.other]);if(seen.has(key))continue;seen.add(key);
   const comparison=compareSpecs(line.spec,item.spec,{diameterAliases:pipeWork(line)&&pipeWork(item)}),numericMismatch=comparison.mismatch;
   const remembered=!!saved&&saved.source===item.source&&saved.code===item.code&&norm(saved.name)===entry.name&&norm(saved.spec)===entry.spec;
   const score=70*n+comparison.score+(/자재/.test(line.group)&&item.category==='자재'?4:0)+(remembered?100:0)+(knowledge?.bonus||0);
   const exact=nameNorm(line.name)===nameNorm(item.name)&&specNorm(line.spec)===specNorm(item.spec);
   found.push({item,score,exact,numericMismatch,dimensionMatch:comparison.numeric===1&&!numericMismatch,rangeMatch:comparison.rangeMatch,equivalentDiameter:comparison.equivalentDiameter,remembered,knowledge,priority:!!priorityId&&entry.library===priorityId});
  }
  // A supported association may select another DB only when that target is absent
  // from the preferred DB. Manual choices in the preferred DB still take priority.
  // Priority means the requested item exists in that DB. A different pipe
  // diameter is only a fallback when no same-name, matching size is available.
  const exactSize=pipeWork(line)&&found.some(r=>r.dimensionMatch&&nameNorm(r.item.name)===matchingName);
  const eligible=exactSize?found.filter(r=>r.remembered||r.dimensionMatch):found;
  const supported=eligible.some(r=>r.knowledge?.strong)?eligible.filter(r=>r.knowledge?.strong||r.remembered):[],pool=supported.length?supported:eligible;
  pool.sort((a,b)=>Number(b.priority)-Number(a.priority)||Number(b.remembered)-Number(a.remembered)||b.score-a.score||Number(b.item.table==='EstMainDat')-Number(a.item.table==='EstMainDat'));const best=pool[0],second=pool.find((r,i)=>i>0&&r.priority===best.priority&&(targetIdentity(r.item)!==targetIdentity(best.item)||r.item.total!==best.item.total));
  const detail=!best?'비슷한 단가 없음 · 직접 연결':best.numericMismatch?'규격 수치 다름 · 확인 필요':best.equivalentDiameter?'관경 13·15·16 동일 후보 기준 · 확인 필요':best.remembered?'이전에 직접 연결한 단가':second&&best.score-second.score<4?'비슷한 후보 여러 개 · 확인 필요':best.exact?'품명·규격 일치':!spec?'원본 규격 없음 · 확인 필요':'유사 품명·규격 · 확인 필요';
  const learnedNote=best?.knowledge?.exact?`상수도 연결 사례 ${best.knowledge.rule.projectCount}개 공사 · ${Math.round(best.knowledge.confidence*100)}% 일치 · `:best?.knowledge?'유사 규격 연결 사례 참고 · ':'';
  // A sparse history must not veto a current, unambiguous DB match. Explicit
  // name aliases can also identify a single non-dimensional work item.
  const sameName=best&&nameNorm(line.name)===nameNorm(best.item.name);
  const equivalentPool=best?found.filter(r=>r.priority===best.priority&&nameNorm(r.item.name)===nameNorm(line.name)):[];
  const uniqueAlias=sameName&&!pipeWork(line)&&new Set(equivalentPool.map(r=>targetIdentity(r.item))).size===1;
  const conflict=!best?.remembered&&!best?.exact&&!(sameName&&best.dimensionMatch)&&!uniqueAlias&&choices.some(c=>c.exact)&&!choices.some(c=>c.strong);
  const missingDiameter=!best?.remembered&&!/\d/.test(line.spec||'')&&/sts|pe|pvc|xl|밸브|계량기|수도미터|관보온|관로해빙|나사식접합/i.test(nameNorm(line.name));
  const reason=(best&&priorityId?(best.priority?'1순위 DB · ':'다른 DB에서 찾음 · '):'')+learnedNote+(missingDiameter?'관경 누락 · 확인 필요 · ':'')+(conflict?'사례 부족·서로 다른 연결 있음 · 확인 필요 · ':'')+detail+(best&&!compatibleUnits(line,best.item)?` · DB 단위 ${best.item.unit} 적용 (수량 유지)`:'');
  const priced=best&&pricer?pricer.reprice(best.item):null;
  const result={line,rate:priced?.rate||best?.item,reason:reason+(priced?' · '+(priced.ready?'기준 노임·자재 재계산':'노임·자재 확인 필요: '+priced.issues.map(i=>(i.resource?.name||'')+' '+i.reason).join(' / ')):''),recommended:!!best&&!conflict&&!missingDiameter,learning:best?.knowledge?{exact:best.knowledge.exact,strong:best.knowledge.strong,projects:best.knowledge.rule.projectCount,agreement:best.knowledge.confidence}:null,exact:best?.exact||false,score:best?Math.round(Math.min(100,best.score)):0};cache.set(cacheKey,result);return result;
 });
}

export function applyAutoLinks(project,rows,batchId){
 const selected=new Map(rows.filter(r=>r.rate).map(r=>[r.line.id,r]));
 const next=structuredClone(project);
 next.lines=next.lines.map(line=>{
  const match=selected.get(line.id);if(!match||line.level||line.exclude||line.status==='confirmed'||wasteMatchIssue(line)||!compatibleWork(line,match.rate))return line;
  const before=structuredClone(line),rate=structuredClone(match.rate);
  if(rate.resourcePricing?.master&&!next.resourcePriceLibrary)next.resourcePriceLibrary={id:rate.resourcePricing.masterId,name:rate.resourcePricing.master};
  const result={...line,name:rate.name,spec:rate.spec||'',unit:rate.unit||'',rate,status:rate.resourcePricing?.ready===false?'proposed':'confirmed',factor:1,autoMatch:{batchId,reviewed:false,reason:match.reason,score:match.score,before}};
  amount(result);return result;
 });return next;
}

export function setupAutoLink(api){
 const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 document.body.insertAdjacentHTML('beforeend',`<dialog id="autoLinkDialog" class="auto-link-dialog"><div class="dialog-head"><div><h2>단가 자동 연결</h2><p>상수도 연결 사례와 품명·규격을 비교하고 단위는 DB 기준으로 적용합니다. 직접 확인한 연결은 유지합니다.</p></div><button class="icon-btn" id="autoLinkClose" aria-label="자동 연결 창 닫기">×</button></div><div class="auto-link-controls"><label>산출 구성 1순위 DB <select id="autoLinkLibrary" aria-label="자동 연결 1순위 DB"></select></label><label>노임·자재 기준 DB <select id="autoResourceLibrary"></select></label><button class="button" id="autoLinkRepair">기존 오연결 해제</button><span id="autoLinkCount"></span></div><p class="auto-priority-note">검증된 연결 항목을 1순위 DB에서 먼저 찾고, 없으면 다른 DB에서 찾습니다. 재질·본체/뚜껑·시공/자재를 구분합니다. 사례가 부족하거나 서로 다른 항목에 연결된 경우에는 선택을 비워 두므로 확인 후 선택하세요.</p><div class="auto-link-controls learning-controls"><label>공사 구분 <select id="autoLearningKind"><option value="auto">공사명으로 판단</option><option value="new">신규급수</option><option value="emergency">긴급보수</option><option value="any">공통 기준</option></select></label><label><input type="checkbox" id="autoLearningEnabled" checked> 상수도 학습 기준 사용</label><label><input type="checkbox" id="autoLearningRetry"> 미검토 자동 연결도 다시 추천</label><span id="autoLearningInfo"></span></div><div class="auto-link-results"><table><thead><tr><th><input type="checkbox" id="autoLinkAll" checked aria-label="연결 후보 전체 선택"></th><th>현재 품명·규격</th><th>자동 선택 단가·규격</th><th>출처 DB</th><th>비교 결과</th></tr></thead><tbody id="autoLinkRows"></tbody></table></div><p class="auto-link-note">연결 후 품명·규격·단위는 단가에서 가져오며 수량은 유지합니다. 자동 연결 금액은 합계에 포함됩니다. ‘자동 연결 검토’에서 원래 규격과 비교해 수정하거나 되돌릴 수 있습니다.</p><div class="dialog-actions"><button class="button" id="autoLinkCancel">취소</button><button class="button primary" id="autoLinkApply">선택 항목 일괄 연결</button></div></dialog><dialog id="autoReviewDialog" class="auto-link-dialog"><div class="dialog-head"><div><h2>자동 연결 검토</h2><p>원래 내역과 연결 결과를 비교하고, 틀린 행만 수정하세요.</p></div><button class="icon-btn" id="autoReviewClose" aria-label="자동 연결 검토 닫기">×</button></div><div class="auto-link-results"><table><thead><tr><th>원래 품명·규격</th><th>연결 품명·규격</th><th>출처 DB</th><th>비교 결과</th><th>검토</th></tr></thead><tbody id="autoReviewRows"></tbody></table></div><div class="dialog-actions"><button class="button" id="autoReviewUndo">남은 자동 연결 되돌리기</button><button class="button primary" id="autoReviewDone">남은 항목 검토 완료</button></div></dialog>`);
 let plans=[];
 function previewProject(){const p=structuredClone(api.getProject());p.connectionLearningKind=$('autoLearningKind').value==='auto'?undefined:$('autoLearningKind').value;p.connectionLearningEnabled=$('autoLearningEnabled').checked;return $('autoLearningRetry').checked?resetPendingAutoLinks(p):p;}
 function learningInfo(){const p=previewProject(),n=getActiveLearning().rules.filter(r=>r.kind!=='any').length;$('autoLearningInfo').textContent=`기본 내장 ${n}개 연결 기준 · ${{new:'신규급수',emergency:'긴급보수',any:'공통'}[connectionKind(p)]} 적용`;}
 function count(){const n=$('autoLinkRows').querySelectorAll('[data-auto-select]:checked').length;$('autoLinkCount').textContent=`미연결 ${plans.length}행 · 연결 선택 ${n}행`;$('autoLinkApply').disabled=!n;}
 function preview(){const bad=incompatibleAutoLinks(api.getProject());$('autoLinkRepair').disabled=!bad.length;$('autoLinkRepair').textContent=`기존 오연결 ${bad.length}건 해제`;plans=planAutoLinks(previewProject(),api.getLibraries(),'', $('autoLinkLibrary').value);learningInfo();$('autoLinkRows').innerHTML=plans.map((r,i)=>`<tr><td><input type="checkbox" data-auto-select="${i}" ${!r.rate?'disabled':r.recommended?'checked':''} aria-label="${esc(r.line.name)} 자동 연결"></td><td>${esc(r.line.name)}<small>${esc(r.line.spec)} · ${esc(r.line.unit)}</small></td><td>${esc(r.rate?.name||'—')}<small>${esc(r.rate?.spec||'')} · ${esc(r.rate?.unit||'')}</small><small>${r.rate?Number(r.rate.total).toLocaleString('ko-KR')+'원':''}</small></td><td>${esc(r.rate?.source||'—')}</td><td>${esc(r.reason)}</td></tr>`).join('');$('autoLinkAll').checked=plans.some(r=>r.rate)&&plans.filter(r=>r.rate).every(r=>r.recommended);$('autoLinkAll').indeterminate=plans.some(r=>r.rate&&r.recommended)&&plans.some(r=>r.rate&&!r.recommended);count();}
 $('autoLinkClose').onclick=$('autoLinkCancel').onclick=()=>$('autoLinkDialog').close();
 $('autoResourceLibrary').onchange=()=>{const lib=api.getLibraries().find(l=>l.id===$('autoResourceLibrary').value);const p=structuredClone(api.getProject());p.resourcePriceLibrary={id:lib.id,name:lib.name};api.replaceProject(p);preview();};
 $('autoLinkLibrary').onchange=()=>{const id=$('autoLinkLibrary').value;api.setPriority({id,name:api.getLibraries().find(l=>l.id===id)?.name||''});preview();};$('autoLinkRows').onchange=count;
 $('autoLearningKind').onchange=$('autoLearningEnabled').onchange=$('autoLearningRetry').onchange=preview;
 $('autoLinkRepair').onclick=()=>{const count=incompatibleAutoLinks(api.getProject()).length;api.replaceProject(resetIncompatibleAutoLinks(api.getProject()));preview();api.toast(`${count}건의 잘못된 자동 연결을 해제하고 원래 품명으로 다시 찾았습니다. 수량은 유지했습니다.`);};
 $('autoLinkAll').onchange=()=>{for(const box of $('autoLinkRows').querySelectorAll('[data-auto-select]:enabled'))box.checked=$('autoLinkAll').checked;count();};
 $('autoLinkApply').onclick=()=>{try{const rows=[...$('autoLinkRows').querySelectorAll('[data-auto-select]:checked')].map(b=>plans[Number(b.dataset.autoSelect)]);const base=structuredClone(api.getProject());base.connectionLearningKind=$('autoLearningKind').value==='auto'?undefined:$('autoLearningKind').value;base.connectionLearningEnabled=$('autoLearningEnabled').checked;api.replaceProject(($('autoLearningRetry').checked?applyReplannedLinks:applyAutoLinks)(base,rows,crypto.randomUUID()));$('autoLinkDialog').close();api.toast(`${rows.length}행을 자동 연결했습니다. 표시된 행에서 틀린 연결만 수정하세요.`);}catch(e){api.toast(e.message);}};
 function review(){const lines=api.getProject().lines.filter(pendingAuto);$('autoReviewRows').innerHTML=lines.map(l=>`<tr><td>${esc(l.autoMatch.before?.name)}<small>${esc(l.autoMatch.before?.spec)} · ${esc(l.autoMatch.before?.unit)}</small></td><td>${esc(l.name)}<small>${esc(l.spec)} · ${esc(l.unit)}</small><small>${Number(l.rate.total).toLocaleString('ko-KR')}원</small></td><td>${esc(l.rate.source)}</td><td>${esc(l.autoMatch.reason)}</td><td><button class="button small" data-auto-fix="${l.id}">수정</button> <button class="button small" data-auto-done="${l.id}">맞음</button></td></tr>`).join('');if(!lines.length)$('autoReviewDialog').close();}
 function markReviewed(ids){const p=structuredClone(api.getProject());for(const l of p.lines){if(!pendingAuto(l)||!ids.has(l.id))continue;l.autoMatch.reviewed=true;p.mappings[lineSignature(l.autoMatch.before)]={source:l.rate.source,code:l.rate.code,name:l.rate.name,spec:l.rate.spec,factor:l.factor};}api.replaceProject(p);review();}
 $('autoReviewRows').onclick=e=>{const fix=e.target.closest('[data-auto-fix]'),done=e.target.closest('[data-auto-done]');if(fix){$('autoReviewDialog').close();api.openMatch(fix.dataset.autoFix);}if(done)markReviewed(new Set([done.dataset.autoDone]));};
 $('autoReviewDone').onclick=()=>markReviewed(new Set(api.getProject().lines.filter(pendingAuto).map(l=>l.id)));
 $('autoReviewUndo').onclick=()=>{const p=structuredClone(api.getProject());p.lines=p.lines.map(l=>{if(!pendingAuto(l))return l;const restored={...l};for(const k of ['name','spec','unit','rate','status','factor','proposed']){if(k in l.autoMatch.before)restored[k]=structuredClone(l.autoMatch.before[k]);else delete restored[k];}delete restored.autoMatch;return restored;});api.replaceProject(p);$('autoReviewDialog').close();api.toast('아직 검토하지 않은 자동 연결을 되돌렸습니다. 수량 수정은 유지됩니다.');};
 $('autoReviewClose').onclick=()=>$('autoReviewDialog').close();
 return {open(){const p=api.getProject();$('autoLearningKind').value=p.connectionLearningKind||'auto';$('autoLearningEnabled').checked=p.connectionLearningEnabled!==false;$('autoLearningRetry').checked=false;$('autoLearningRetry').disabled=!p.lines.some(retryableAuto);if(!api.getLibraries().length){api.toast('먼저 단가 DB를 추가하세요.');return;}$('autoLinkLibrary').innerHTML='<option value="">우선순위 없이 전체 비교</option>'+api.getLibraries().map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');$('autoLinkLibrary').value=preferredLibrary(api.getProject(),api.getLibraries());$('autoResourceLibrary').innerHTML=api.getLibraries().map(l=>`<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('');$('autoResourceLibrary').value=resourceLibrary(api.getProject(),api.getLibraries())?.id||'';preview();$('autoLinkDialog').showModal();},review(){review();if(api.getProject().lines.some(pendingAuto))$('autoReviewDialog').showModal();}};
}
