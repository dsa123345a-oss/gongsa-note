const displayMoney = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:0});
const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8});
import {normalizeSectionTitles} from './project-labels.js';
import {createDeferredTask} from './deferred-task.js';
import {estimateFooterRows,addSeparateCost,setSeparateUnitPrice} from './estimate-footer.js';
import {separateSectionLabel} from './cost-scopes.js';
import {createProjectFiles} from './project-files.js';
import {setupExcelSelection} from './excel-selection.js';
import {createOutputPreferences} from './output-preferences.js';
import {startBlankSession,createCloseController,askSaveBeforeClose,createSavedProjectState} from './session-lifecycle.js';
import {loadDefaultDatabases} from './default-databases.js';
import {upgradeRegisteredLibraryMetadata} from './library-metadata-upgrade.js';
import {hydrateEstProjectMetadata,restoreEstProjectLibrary} from './est-metadata.js';
import {createResourcePricer,resourceLibrary,resourcePricingMessage} from './resource-pricing.js';
import {setupResourcePricing} from './resource-pricing-ui.js';
import {setupPriceUpdate} from './price-update-ui.js';
import {setupQuantityImport} from './quantity-import-ui.js';
import {setupSupplyFees} from './supply-fees-ui.js';
import {createProjectHistory} from './project-history.js';
import {resetCostSheet,insertCostCharge,deleteCostCharge,editCostCharge,connectNamedCostGroup} from './cost-edit.js';
import {setupWorkspaceWindows} from './workspace-windows.js';
import {costSheet,costSheetHtml} from './cost-sheet.js';
import {setupEstLayout} from './est-layout.js';
import {setupEvidenceWorkspace,evidenceContent} from './evidence-workspace.js';
import {collectPriceEvidence} from './price-evidence.js';
import {estimateGrid} from './estimate-grid.js';
import {setupGridKeyboard,insertBoundaryLine} from './grid-keyboard.js';
import {setupRowSelection} from './row-selection.js';
import {editBlock} from './work-core.js';
import {setupLevels,hierarchyView,quantityHierarchy,appendQuantitySection} from './levels.js';
import {setupDesktopToolbar} from './desktop-toolbar.js';
import {setupAutoLink,pendingAuto,planAutoLinks,preferredLibrary} from './auto-link.js';
import {setupWorkflowTools} from './workflow-tools.js';
import {budgetStatus} from './workflow-core.js';
import {setupAdvancedTools} from './advanced-tools.js';
import {synchronizeLinkedCosts} from './calc.js';
import {setupMappedImport} from './mapped-import-ui.js';
import {quoteDetails} from './reference-details.js';
import {calculationModes,aggregateCalculation} from './calculation-modes.js';
import {setupUpdates} from './updates.js';
import {setupWorkTools} from './work-tools.js';
import {setupQuotes} from './quotes.js';
import {editableAssembly,attachMachineBasis} from './est-edit.js';
import {setupEstActions} from './est-actions.js';
import {validateProject,collectEvidence,rateIdentity,resolveRateLibrary} from './project-data.js';
import {createStorage} from './storage.js';
import {hierarchyTotals,calculateAssemblyDetailed} from './estimate-core.js';
import {mergeLibrary,searchLibraries,searchLineLibraries} from './library-search.js';
import {setupAssembly} from './assembly.js';
import {setupRaw} from './raw.js';
import {importEst} from './est.js';
import {importEstProject} from './est-project.js';
import {showEstImportReport} from './est-project-ui.js';
import {setupOriginalEst} from './original-est.js';
import {norm,unitNorm,cleanNumber,amount,totals,suggest,defaultCharges,bidPercent,appliedRate} from './calc.js';
import {readWorkbook,extractQuantities} from './workbook.js';
import {exportEvidenceEstimate} from './evidence-estimate.js';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=n=>n==null?'—':displayNumber.format(Number(n));
const money=n=>n==null?'—':displayMoney.format(Number(n));
const bases={labor:'직접노무비',totalLabor:'직접+간접 노무비',laborMaterial:'직접노무비+직접재료비',totalLaborMaterial:'전체 노무비+직접재료비',health:'앞선 건강보험료',direct:'직접공사비',net:'직접공사비+앞선 제경비',profitBase:'노무비+경비+앞선 제경비',contractBeforeVat:'직접공사비+앞선 제경비+폐기물',government:'관급자재대',fixed:'정액 입력'};
let entryLines=[];
const entryLine={id:'new-estimate-entry',name:'',spec:'',unit:'',qty:1,group:'',bucket:'direct',status:'unmatched',rate:null,factor:1,exclude:false,source:'직접 입력'};
const newState=()=>({schema:1,title:'',location:'',quantityFile:'',lines:[],charges:defaultCharges(),ratesReviewed:false,mappings:{}});
let rowSelection=null;
let selectedLineId=null,workTools=null,workspaceWindows=null,evidenceWorkspace=null,projectHistory=null,selectedCostKey=null;
let project=newState(),libraries=[],view='estimate',group='',page=0,activeLine=null,chosenRate=null,pendingSheets=[],pendingQuantity='',detailIndex=[],saveTimer,priceUpdatePending=null;
const savedProject=createSavedProjectState(project);
let storage;try{storage=await createStorage();}catch(e){document.body.innerHTML='<main><h1>작업 자료를 열지 못했습니다.</h1><p>원본 자료를 보존했습니다. 프로그램을 다시 실행해주세요.</p></main>';throw e;}
let loadedOK=false,changeVersion=0;
const titleEdits=createDeferredTask(()=>{normalizeSectionTitles(project);renderLines();if(workspaceWindows?.isOpen('summary'))renderSummary();changed(true,'project-title');});
function editProjectTitle(value,trim=true){
 project.title=trim?String(value).trim():value;
 for(const l of project.lines)if(l.autoHeading==='project')l.name=project.title||'공사명';
 for(const id of ['projectTitle','desktopProjectTitle']){const input=$(id);if(input&&input!==document.activeElement)input.value=project.title;}
 $('projectCaption').textContent=project.title||'새 설계내역서';$('costProjectName').textContent=project.title||'공사명 미입력';
 titleEdits.schedule();refreshHistory();
}
document.addEventListener('compositionstart',e=>{if(['projectTitle','desktopProjectTitle'].includes(e.target.id))titleEdits.pause();});
document.addEventListener('compositionend',e=>{if(['projectTitle','desktopProjectTitle'].includes(e.target.id))titleEdits.resume();});
document.addEventListener('focusout',e=>{if(['projectTitle','desktopProjectTitle'].includes(e.target.id)){titleEdits.resume();titleEdits.flush();}});
const get=key=>storage.get(key),put=(key,value)=>storage.put(key,value);
function toast(s){$('toast').textContent=s;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
function busy(s){$('progressText').textContent=s;$('progress').hidden=false;}
function idle(){$('progress').hidden=true;}
function changed(recordHistory=true,historyKey){if(!loadedOK)return;titleEdits.flush();project=synchronizeLinkedCosts(project);project.evidence=collectEvidence(project,libraries);if(recordHistory){const a=document.activeElement,key=a?.dataset?.field||a?.dataset?.chargeField;projectHistory?.record(project,historyKey??(key?[a.closest('[data-id]')?.dataset.id||a.closest('[data-charge]')?.dataset.charge,key].join(':'):''));}refreshHistory();const version=++changeVersion;clearTimeout(saveTimer);$('saveState').textContent='저장 중…';saveTimer=setTimeout(async()=>{try{await put('project',project);if(version!==changeVersion)return;$('saveState').textContent='임시 보관됨';}catch{$('saveState').textContent='파일로 작업을 저장하세요';}},450);}
const allItems=()=>libraries.flatMap(l=>l.items);
function signature(l){return [norm(l.group),norm(l.name),norm(l.spec),unitNorm(l.unit)].join('|');}
function switchView(v){view='estimate';document.body.dataset.view='estimate';$('estimateView').hidden=false;if(v==='estimate'){workspaceWindows?.closeAll();evidenceWorkspace?.close();}else workspaceWindows?.open(v);$('viewName').textContent='설계내역서';if(v==='catalog')renderCatalog();if(v==='summary')renderSummary();if(v==='raw')rawView.refresh();document.querySelectorAll('[data-work-view]').forEach(b=>b.classList.toggle('active',b.dataset.workView==='estimate'?!evidenceWorkspace?.category:workspaceWindows?.isOpen(b.dataset.workView)));}
function render(){
 libraries.forEach(attachMachineBasis);
 project=synchronizeLinkedCosts(project);
 if($('desktopProjectTitle'))$('desktopProjectTitle').value=project.title||'';
 $('projectCaption').textContent=project.title||'새 설계내역서';$('projectTitle').value=project.title;$('projectLocation').value=project.location;
 $('quantityLabel').textContent=project.quantityFile||'기존 툴에서 만든 .xlsx · .xlsm 파일';
 $('estLabel').textContent=libraries.length?`${libraries.length}개 자료 · ${num(allItems().length)}개 단가`:'공사 메인 .ebkx · 월별 .estx';
 $('catalogBadge').textContent=libraries.length;
 $('ratesReviewed').checked=project.ratesReviewed;
 renderStats();renderLines();renderLibraries();if(workspaceWindows?.isOpen('raw'))rawView.refresh();if(workspaceWindows?.isOpen('catalog'))renderCatalog();if(workspaceWindows?.isOpen('summary'))renderSummary();workTools?.applyPreferences();evidenceWorkspace?.refresh();
}
function renderStats(){
 project=synchronizeLinkedCosts(project);
 if(workspaceWindows?.isOpen('summary')&&!document.activeElement?.closest('#chargeTable'))renderSummary();
 for(const l of project.lines.filter(l=>l.surcharge)){const tr=document.querySelector(`#estimateTable tr[data-id="${l.id}"]`);if(!tr)continue;const a=amount(l),r=l.rate;tr.querySelector('.line-total').textContent=a?money(a.total):'미확정';const unit=tr.querySelector('.unit-cost button');if(unit)unit.textContent=r?num(r.total):'—';for(const cell of tr.querySelectorAll('[data-cost-key]'))cell.textContent=a?money(a[cell.dataset.costKey]):'—';for(const cell of tr.querySelectorAll('[data-unit-cost-key]'))cell.textContent=r?num(r[cell.dataset.unitCostKey]):'—';tr.classList.toggle('unconfirmed-row',!a);}
 $('bidState').title=(project.costWarnings||[]).join(' ');if(project.costWarnings?.length)toast(project.costWarnings.join(' '));
 $('bidState').textContent=project.lines.some(l=>l.rate?.evidenceBid)?'근거자료 낙찰 적용':project.lines.some(l=>!l.level&&bidPercent(l)!==100)?'낙찰률 적용 · 내역별 확인':'설계금액 · 낙찰률 미적용';
 const pending=project.lines.filter(pendingAuto).length;$('reviewAuto').hidden=!pending;$('reviewAuto').textContent=`자동 연결 검토 ${pending}`;
 const included=project.lines.filter(l=>!l.exclude&&!l.level),confirmed=included.filter(l=>amount(l)!==null).length,t=totals(project.lines,project.charges);
 for(const r of estimateFooterRows(project)){const tr=[...$('estimateTable').querySelectorAll('[data-estimate-summary]')].find(el=>el.dataset.estimateSummary===r.id);if(tr){tr.querySelector('[data-summary-amount]').textContent=money(r.amount);const small=tr.querySelector('small');if(small)small.textContent=r.rate||'';if(r.costs){const cells=tr.querySelectorAll('td.number');['labor','material','expense','other'].forEach((k,i)=>{if(cells[i+1])cells[i+1].textContent=money(r.costs[k]);});}}}
 let budget=document.getElementById('contractBudgetStatus');if(!budget){budget=document.createElement('p');budget.id='contractBudgetStatus';document.querySelector('.stats').after(budget);}const bs=budgetStatus(project);budget.hidden=!bs.limit;budget.className='budget-status'+(bs.exceeded||bs.partial?' error-text':'');budget.textContent=`${bs.discounted?'낙찰 적용':'설계'} 도급액 ${money(bs.amount)}원 · 한도 ${money(bs.limit)}원 미만 · ${bs.exceeded?'한도 도달·초과':'남은 금액'} ${money(Math.abs(bs.remaining))}원${bs.partial?' · 미확정 제외 부분합':''}`;
 $('lineCount').innerHTML=`${included.length}<small>개</small>`;$('matchedCount').innerHTML=`${confirmed}<small>/ ${included.length}</small>`;
 $('directAmount').innerHTML=`${included.length?money(t.direct):'—'}<small>원</small>`;
 $('totalAmount').innerHTML=`${included.length?money(t.grand):'—'}<small>원</small>`;
 $('totalHint').textContent=project.costWarnings?.length?project.costWarnings.join(' '):t.missing?`미연결 ${t.missing}건 제외 부분합`:'제경비·관급·별도비 포함';
 if(pending)$('totalHint').textContent+=` · 자동 연결 검토 ${pending}건`;
 $('totalHint').classList.toggle('error-text',!!t.missing||!!project.costWarnings?.length);
 $('rowHint').textContent=project.lines.length?`${project.quantityFile||'직접 작성'} · 전체 ${project.lines.length}행`:'품명 칸에 입력하거나 수량산출서를 가져오세요.';
 $('validationText').textContent=t.missing?`${t.missing}건의 단가 또는 수량 확인이 필요합니다. 표시 금액은 확정 항목의 부분합입니다.`:'엑셀 원본 수량 보존 · 확정한 단가로 계산';
 $('validationText').classList.toggle('error-text',!!t.missing);
}
function renderLines(){
 const groups=[...new Set(project.lines.filter(l=>!l.level).map(l=>l.group))],subtotals=hierarchyTotals(project.lines),hierarchy=hierarchyView(project.lines);
 $('groupFilters').innerHTML=`<button class="chip ${!group?'active':''}" data-group="">전체</button>`+groups.map(g=>`<button class="chip ${group===g?'active':''}" data-group="${esc(g)}">${esc(g)}</button>`).join('');
 const headings=project.lines.filter(l=>l.level),outlineLevel=$('outlineLevel')?.value||'';
 $('projectTree').innerHTML='<button data-group="" class="tree-heading">전체 설계내역</button>'+(headings.length?headings.filter(l=>!outlineLevel||String(l.level)===outlineLevel).map(l=>`<button class="tree-sub" style="padding-left:${8+(hierarchy.get(l.id)?.depth||0)*12}px" data-scroll-id="${l.id}"><b>L${l.level}</b> ${l.separateTail&&separateSectionLabel(l)?esc(separateSectionLabel(l))+' ':''}${esc(l.name)}<small>${money(subtotals.get(l.id)?.total)}</small></button>`).join(''):groups.map(g=>{const t=totals(project.lines.filter(l=>l.group===g),[]);return `<button data-group="${esc(g)}" class="${group===g?'active':''}">▸ ${esc(g)}<small>${money(t.direct+t.government+t.waste+t.fees)}</small></button>`;}).join(''));

 const show=$('showExcluded').checked,status=$('statusFilter').value;
 const lines=project.lines.filter(l=>(status||!hierarchy.get(l.id)?.hidden)&&(show||!l.exclude)&&(!group||l.group===group)&&(!status||l.level||(status==='auto'?pendingAuto(l):status==='confirmed'?l.status==='confirmed':l.status!=='confirmed')));
 if($('matchDialog').open&&!project.lines.some(l=>l.id===activeLine?.id))$('matchDialog').close();
 if(!lines.some(l=>l.id===selectedLineId))selectedLineId=null;
 rowSelection?.refresh(lines.map(l=>l.id),selectedLineId);
 $('deleteLine').disabled=!(rowSelection?.ids.length||selectedLineId);
 if(!project.lines.length){
  const options={selectedLineId,subtotals,hierarchy,esc,num,money};
  const table=$('estimateTable');
  table.classList.add('empty-estimate');
  table.innerHTML=estimateGrid([{...entryLine,qty:null}],options);
  table.querySelector('table').style.height='auto';
  workTools?.applyPreferences();
  const rowHeight=table.querySelector('tbody tr').getBoundingClientRect().height||32;
  const headerHeight=table.querySelector('thead').getBoundingClientRect().height;
  const count=Math.max(1,Math.min(100,Math.floor((table.clientHeight-headerHeight)/rowHeight)));
  entryLines=Array.from({length:count},(_,i)=>({...entryLine,id:entryLine.id+'-'+i,qty:null}));
  table.innerHTML=estimateGrid(entryLines,options);
  rowSelection?.refresh(entryLines.map(l=>l.id),selectedLineId);
  workTools?.applyPreferences();
  return;
 }
 $('estimateTable').classList.remove('empty-estimate');
 if(!lines.length){$('estimateTable').innerHTML='<div class="empty-state"><strong>이 조건에 해당하는 내역이 없습니다.</strong></div>';return;}
 $('estimateTable').innerHTML=estimateGrid(lines,{selectedLineId,subtotals,hierarchy,esc,num,money,directTotal:totals(project.lines,project.charges),project});
 rowSelection?.paint();
 workTools?.applyPreferences();
}

function renderLibraries(){
 const options='<option value="">모든 자료</option>'+libraries.map(l=>`<option value="${l.id}">${esc(l.name)}</option>`).join('');
 for(const name of ['libraryFilter','matchLibrary']){const old=$(name).value;$(name).innerHTML=options;$(name).value=old;}
 $('libraryCards').innerHTML=libraries.length?libraries.map(l=>`<div class="library-card"><button class="icon-btn" data-remove-library="${l.id}" aria-label="자료 삭제">×</button><strong>${esc(l.name)}</strong><p>${l.isMain?'✓ 현재 메인 DB':`<button class="button small" data-main-library="${l.id}">메인 DB로 사용</button>`}</p><p>데이터 v${esc(l.version)} · ${num(l.items.length)}개 단가</p><p>${l.stats.map(s=>`${esc(s.category)} ${num(s.count)}`).join(' · ')}</p></div>`).join(''):'<div class="hint">EST .estx 또는 .ebkx 파일을 가져오면 단가를 검색할 수 있습니다.</div>';
 const hints=libraries.filter(l=>l.chargeHints?.length);
 $('chargeHints').innerHTML=hints.map(l=>`<div class="hint-box">${esc(l.name)}에 저장된 요율이 있습니다.<br><button class="button small" data-charge-hints="${l.id}">저장된 요율 검토·적용</button></div>`).join('');
}
function renderCatalog(){
 const groups=searchLibraries(libraries,$('catalogSearch').value,$('categoryFilter').value,$('libraryFilter').value);detailIndex=[];
 renderCategories('catalogCategories',$('categoryFilter').value);
 $('catalogTable').innerHTML=dbPanels(groups,catalogPages,i=>{const n=detailIndex.push(i)-1;return `<div class="catalog-result"><div><strong>${esc(i.name)}</strong><small>${esc(i.spec||'규격 없음')} · ${esc(i.unit)} · ${esc(i.category)}</small><small>${esc(i.code)}</small></div><div class="price"><strong>${num(i.total)} 원</strong><small>노무 ${num(i.labor)} · 재료 ${num(i.material)} · 경비 ${num(i.expense)}</small><button class="button small" data-detail="${n}">근거</button> <button class="button small" data-catalog-add="${n}" aria-label="${esc(i.name+' '+i.spec)} 내역에 추가">＋ 내역에 추가</button></div></div>`;});
 $('pageInfo').textContent=`${groups.length}개 DB · ${num(groups.reduce((n,g)=>n+g.items.length,0))}개 단가 · 각 창에서 페이지를 넘길 수 있습니다.`;
}
function renderSummary(){const t=totals(project.lines,project.charges);$('ratesReviewed').checked=!!project.ratesReviewed;
 $('costProjectName').textContent=project.title||'공사명 미입력';
 $('chargeTable').innerHTML=costSheetHtml(project,{esc,money});selectCost(selectedCostKey);
 $('summaryTotals').textContent=t.missing?`미연결·수량 미확정 ${t.missing}건 제외 부분합`:'확정 내역 기준';
 $('summaryTotals').classList.toggle('error-text',!!t.missing);
}
async function saveUserRate(rate,context){for(const k of ['labor','material','expense','other','total'])if(!Number.isFinite(rate[k])||rate[k]<0||rate[k]>1e14)throw Error('단가의 숫자 범위를 확인하세요.');const target=context?project.lines.find(l=>l.id===context.lineId):null;if(context&&(!target||rateIdentity(target.rate)!==context.identity))throw Error('내역 단가가 바뀌었습니다. 편집창을 다시 여세요.');if(target)validateProject({...project,lines:project.lines.map(l=>l.id===target.id?{...l,rate}:l)});const previous=libraries.find(l=>l.userLibrary);const lib=previous?{...previous,items:[...previous.items]}:{id:crypto.randomUUID(),name:'나의 단가',userLibrary:true,version:'1',items:[],stats:[],details:[],tables:[]};rate.library=lib.id;lib.items.push(rate);lib.stats=['일위대가','단가산출','자재','노임','장비','표준시장단가'].map(category=>({category,count:lib.items.filter(i=>i.category===category).length}));const next=[...libraries.filter(l=>l.id!==lib.id),lib];await put('libraries',next);libraries=next;if(target){target.rate=structuredClone(rate);target.status='confirmed';project.ratesReviewed=false;changed();}render();switchView(target?'estimate':'catalog');toast(target?'편집 단가를 저장하고 해당 내역에 적용했습니다.':'나의 단가에 저장했습니다. 내역에 추가할 수 있습니다.');}
const assemblyEditor=setupAssembly(allItems,saveUserRate,()=>libraries),quoteEditor=setupQuotes(saveUserRate);
$('createAssembly').onclick=()=>assemblyEditor.open();
const rawView=setupRaw(()=>libraries,download);
async function importLibraries(files){busy('EST 파일의 품목과 단가를 읽고 있습니다…');try{let next=libraries;for(const f of files){if(f.size>80*1024*1024)throw Error('파일은 80MB 이하만 지원합니다.');if(next.some(l=>l.name===f.name)&&!confirm(f.name+' 자료가 이미 있습니다. 같은 이름의 DB를 새 파일로 교체할까요? 기존 연결 단가는 유지됩니다.'))continue;const lib=await importEst(await f.arrayBuffer(),f.name);const errors=lib.tables.filter(t=>t.error);if(errors.length&&!confirm(f.name+'의 '+errors.length+'개 표를 읽지 못했습니다. 나머지 표만 가져올까요?'))continue;next=mergeLibrary(next,lib);}await put('libraries',next);libraries=next;render();$('libraryFilter').value='';catalogPages.clear();if(workspaceWindows?.isOpen('catalog'))renderCatalog();toast('단가 자료를 가져왔습니다. 같은 코드라도 자료 파일을 확인하세요.');}catch(e){toast(e.message);}finally{idle();$('estInput').value='';}}

document.body.insertAdjacentHTML('beforeend','<input id="folderDbInput" type="file" webkitdirectory multiple hidden>');
$('folderDbInput').onchange=async event=>{const files=[...event.target.files].filter(f=>/\.(estx|ebkx)$/i.test(f.name));try{if(!files.length){toast('폴더에 ESTX/EBKX 파일이 없습니다.');return;}if(files.length>100)throw Error('폴더 파일이 100개를 넘습니다. 하위 폴더를 나눠 선택하세요.');await importLibraries(files.map(f=>({name:f.webkitRelativePath||f.name,size:f.size,arrayBuffer:()=>f.arrayBuffer()})));switchView('catalog');}catch(error){toast(error.message);}finally{event.target.value='';}};

function propose(show=true){const plans=planAutoLinks(project,libraries,'',preferredLibrary(project,libraries));let count=0;for(const p of plans){if(p.rate){p.line.proposed=p.rate.id;p.line.status='proposed';count++;}else delete p.line.proposed;}renderLines();renderStats();changed();if(show)toast(libraries.length?`${count}개 항목의 후보를 찾았습니다. ‘후보 확인’을 눌러 확정하세요.`:'먼저 EST 단가 자료를 가져오세요.');}
function openMatch(id,{preserveFocus=false}={}){const previousFocus=document.activeElement;if(project.lines.find(l=>l.id===id)?.surcharge){toast('할증 설정 버튼에서 기준과 요율을 수정하세요.');return;}activeLine=project.lines.find(l=>l.id===id);if(!activeLine||activeLine.level){$('matchDialog').close();return;}selectedLineId=id;rowSelection?.select(id);$('estimateTable').querySelectorAll('[data-id]').forEach(r=>r.classList.toggle('selected-line',r.dataset.id===id));chosenRate=null;$('matchTitle').textContent=activeLine.name||'단가 연결';$('matchSource').textContent=`현재 내역: ${activeLine.spec||'규격 없음'} · ${num(activeLine.qty)} ${activeLine.unit} / ${activeLine.source||'직접 입력'}`;$('matchSearch').value=activeLine.name||'';$('matchLibrary').value='';matchCategory='';matchPages.clear();$('confirmMatch').disabled=true;renderMatches();document.body.classList.add('matching-open');if(!$('matchDialog').open)$('matchDialog').show();if(preserveFocus&&previousFocus?.isConnected)previousFocus.focus({preventScroll:true});}
function showRowMatch(id){
 const line=project.lines.find(l=>l.id===id);
 if(!line||line.level||line.exclude||line.surcharge||line.deduction||line.status==='confirmed'&&line.rate){if($('matchDialog').open)$('matchDialog').close();return;}
 openMatch(id,{preserveFocus:true});
}
let candidateList=[],matchCategory='';
const matchPages=new Map(),catalogPages=new Map();
const categories=[['','전체'],['일위대가','일위'],['단가산출','단산'],['자재','자재'],['노임','노임'],['장비','장비'],['표준시장단가','시장'],['내역단가','내역']];
function renderCategories(id,value){$(id).innerHTML=categories.map(([v,label])=>`<button type="button" class="chip ${value===v?'active':''}" aria-pressed="${value===v}" data-category="${v}">${label}</button>`).join('');}
function dbPanels(groups,pages,renderItem){return groups.map(({library:l,items,related})=>{const last=Math.max(0,Math.ceil(items.length/30)-1),p=Math.min(pages.get(l.id)||0,last);pages.set(l.id,p);return `<section class="db-window ${l.isMain?'main-db':'added-db'}" aria-label="${esc(l.name)} 검색 결과"><div class="db-window-head"><span class="db-tag">${l.isMain?'기본 메인 DB':'추가 DB'}</span><strong>${esc(l.name)}</strong><span>${related?"관련 이름 ":""}${num(items.length)}건</span></div>${related?'<p class="related-notice">이름이 비슷한 후보입니다.<br>재질·공법이 다를 수 있으니 원본 근거를 확인하세요.</p>':'<p class="related-notice exact-notice">검색어 일치 항목부터, 비슷한 이름 순으로 표시합니다.<br>규격과 단가를 비교한 뒤 선택하세요.</p>'}<div class="db-window-body">${items.length?items.slice(p*30,p*30+30).map(renderItem).join(''):'<p class="db-empty">이 DB에는 검색 결과가 없습니다.<br>검색어를 줄이거나 다른 구분을 선택하세요.</p>'}</div><div class="db-window-footer"><button class="button small" data-db-page="${l.id}" data-step="-1" ${p===0?'disabled':''}>이전</button><span>${p+1} / ${last+1}</span><button class="button small" data-db-page="${l.id}" data-step="1" ${p===last?'disabled':''}>다음</button></div></section>`;}).join('')||'<p class="db-empty">먼저 DB 파일을 추가하세요.</p>';}
function renderMatches(){if(!activeLine)return;
 const groups=searchLineLibraries(libraries,activeLine,$('matchSearch').value,matchCategory,$('matchLibrary').value);candidateList=[];
 renderCategories('matchCategories',matchCategory);
 $('matchResults').innerHTML=dbPanels(groups,matchPages,i=>{const n=candidateList.push(i)-1;return `<label class="candidate ${chosenRate?.id===i.id?'selected':''}" data-candidate="${n}"><input type="radio" name="candidate" ${chosenRate?.id===i.id?'checked':''}><div><strong>${esc(i.name)}</strong><small>${esc(i.spec||'규격 없음')} · ${esc(i.unit)} · ${esc(i.category)}</small><small>${esc(i.code)}</small></div><div class="price">${num(i.total)}<small>원 / ${esc(i.unit)}</small></div></label>`;});
 const terms=$('matchSearch').value.split(/[\s&]+/).map(norm).filter(Boolean),seen=new Set();
 const used=project.lines.filter(l=>l.rate&&!l.level).map(l=>l.rate).filter(r=>{const key=r.source+'|'+r.code+'|'+r.id;if(seen.has(key))return false;seen.add(key);return (!matchCategory||r.category===matchCategory)&&terms.every(q=>norm(r.name+' '+r.spec+' '+r.code).includes(q));});
 $('projectRateMatches').innerHTML=used.length?'<strong>현재 내역에서 사용 중인 단가</strong>'+used.slice(0,20).map(r=>{const n=candidateList.push(r)-1;return `<button class="button small" data-candidate="${n}">${esc(r.name)} ${esc(r.spec)} · ${num(r.total)}원 · ${esc(r.source)}</button>`;}).join(''):'';
 renderSelected();}
function resetMatchSearch(){chosenRate=null;matchPages.clear();$('confirmMatch').disabled=true;renderMatches();}
function renderSelected(){$('confirmMatch').disabled=!chosenRate;if(!chosenRate){$('selectedRate').innerHTML='항목을 한 번 클릭하면 입력하고 연결 창을 닫습니다.';return;}
 if(chosenRate.manual){$('selectedRate').innerHTML='<div class="manual-grid">'+[['labor','노무비'],['material','재료비'],['expense','경비'],['other','기타']].map(([k,n])=>`<label>${n}<input type="number" min="0" step="any" data-manual-field="${k}" value="${chosenRate[k]||0}" aria-label="직접 ${n}"></label>`).join('')+'</div>';return;}
 const mismatch=norm(chosenRate.spec)!==norm(activeLine.spec)||unitNorm(chosenRate.unit)!==unitNorm(activeLine.unit);
 chosenRate=createResourcePricer(project,libraries).reprice(chosenRate).rate;
 $('selectedRate').innerHTML=`<div class="selection-origin">선택한 DB: <strong>${esc(chosenRate.source)}</strong><br>${esc(chosenRate.name)} · ${esc(chosenRate.spec)} · ${esc(chosenRate.code)}</div>${mismatch?'<span class="error-text">규격 또는 단위가 원본과 다릅니다. 선택한 단가를 현재 수량에 그대로 적용합니다.</span>':'선택한 단가를 현재 내역에 적용합니다.'}<div class="breakdown">${[['labor','노무비'],['material','재료비'],['expense','경비'],['other','기타']].map(([k,n])=>`<span>${n}<strong>${num(chosenRate[k])}</strong></span>`).join('')}</div>${chosenRate.resourcePricing?'<p class="'+(chosenRate.resourcePricing.ready?'hint':'error-text')+'">노임·자재·장비: '+esc(chosenRate.resourcePricing.master)+' · '+(chosenRate.resourcePricing.mode==='direct-material'?'직접 자재는 선택 DB 단가 유지':chosenRate.resourcePricing.ready?(chosenRate.resourcePricing.warnings?.length?'재계산 완료 · 기존 단가 유지 '+chosenRate.resourcePricing.warnings.length+'건':'산출 구성 재계산 완료'):esc(chosenRate.resourcePricing.issues.map(i=>(i.resource?.name||'')+' '+i.reason).join(' / ')))+'</p>':''}<button class="mini-link" id="matchDetailBtn">선택 단가의 근거 보기</button>`;
}
function confirmRate(){if(!chosenRate||!activeLine||!$('matchDialog').open)return;activeLine=project.lines.find(l=>l.id===activeLine.id);if(!activeLine||activeLine.level){$('matchDialog').close();return;}const factor=1;
 if(chosenRate.manual){for(const input of $('selectedRate').querySelectorAll('[data-manual-field]')){const n=Number(input.value);if(input.value===''||!Number.isFinite(n)||n<0){toast('직접 단가를 올바르게 입력하세요.');return;}chosenRate[input.dataset.manualField]=n;}chosenRate.total=['labor','material','expense','other'].reduce((s,k)=>s+chosenRate[k],0);}
 if(!chosenRate.manual)chosenRate=createResourcePricer(project,libraries).reprice(chosenRate).rate;
 try{amount({...activeLine,rate:chosenRate,status:'confirmed',factor});}catch(e){toast(e.message);return;}const originalSignature=signature(activeLine.autoMatch?.before||activeLine);delete activeLine.autoMatch;if(!chosenRate.manual)delete activeLine.manualSeparate;activeLine.rate=structuredClone(chosenRate);if(chosenRate.resourcePricing?.master&&!project.resourcePriceLibrary)project.resourcePriceLibrary={id:chosenRate.resourcePricing.masterId,name:chosenRate.resourcePricing.master};activeLine.name=chosenRate.name;activeLine.spec=chosenRate.spec||'';activeLine.unit=chosenRate.unit||'';activeLine.status=chosenRate.resourcePricing?.ready===false?'proposed':'confirmed';activeLine.factor=factor;project.mappings[originalSignature]={source:chosenRate.source,code:chosenRate.code,name:chosenRate.name,spec:chosenRate.spec,factor};renderStats();renderLines();changed();$('matchTitle').textContent=activeLine.name;$('matchSource').textContent=`현재 내역: ${activeLine.spec||'규격 없음'} · ${num(activeLine.qty)} ${activeLine.unit}`;renderSelected();$('matchDialog').close();toast(resourcePricingMessage(chosenRate));}
function showDetail(item,lineId=null){
 $('detailTitle').textContent=item.name;
 $('detailSource').textContent=`${item.spec} · ${item.unit} / ${item.source} / ${item.code}`;
 const lib=resolveRateLibrary(item,libraries),saved=project.evidence?.find(e=>rateIdentity(e.rate)===rateIdentity(item));
 const isUnitCost=item.category==='단가산출'||item.table==='CostTitleDat'||/^D/.test(item.code||'');
 const prefix=isUnitCost?'CostMainDat':{일위대가:'HeadMainDat',장비:'MachMainDat'}[item.category]||({U:'HeadMainDat',E:'MachMainDat'}[item.code?.[0]]);
 const rawDetails=(saved?.rows?.length?saved.rows:null)||lib?.details?.find(([key])=>key===prefix+':'+item.code)?.[1]||[];
 const details=isUnitCost?rawDetails:(item.components?calculateAssemblyDetailed(item.components,item.calculation||{}).rows.map(p=>({Code:p.code||p.kind,Name:p.name+(p.qtyExpression?' · '+p.qtyExpression:''),Size:p.spec,GN:p.qty,TU:p.total,TC:p.amount.total})):rawDetails);
 if(isUnitCost){
  // The catalog can inspect a rate before it is applied to a project. Read the
  // same evidence as the workspace without changing readiness or any prices.
  const detailRate=structuredClone(item),pending=detailRate.resourcePricing?.ready===false;
  if(pending)detailRate.resourcePricing.ready=true;
  const detailProject={lines:[{id:'detail-rate',name:item.name,qty:1,status:'confirmed',rate:detailRate}],evidence:[{rate:detailRate,rows:rawDetails},...(project.evidence||[])]};
  let node;
  try{node=collectPriceEvidence(detailProject,libraries).lineNodes.get('detail-rate');}
  catch(error){node={rate:detailRate,kind:'단가산출',sheet:0,raw:rawDetails,issues:[error.message],verified:false};}
  if(pending){node.rate.resourcePricing=structuredClone(item.resourcePricing);node.issues.unshift('노임·자재·장비 기준 적용 대기 · 현재 저장 단가 표시');}
  $('detailContent').innerHTML='<div class="detail-data basis-formula-detail">'+evidenceContent(node)+(item.evidenceBid?'<p class="notice">근거 낙찰 '+esc(item.evidenceBid.percent)+'% · 비목 단가에 적용, 내역 이중 낙찰 방지 · 원단가 복원 가능</p>':'')+'</div>';
 }else{
  $('detailContent').innerHTML=`<div class="detail-data"><div class="breakdown">${[['labor','노무비'],['material','재료비'],['expense','경비'],['other','기타'],['total','합계 단가']].map(([k,n])=>`<span>${n}<strong>${num(item[k])}</strong></span>`).join('')}</div><p class="hint">${item.quoteMethod?'사용자 조사단가':item.components?'사용자 작성 산식을 재계산한 근거':'원본 테이블'} ${esc(item.table||'직접 입력')} · 레코드 ${item.record??'—'}. ${item.quoteMethod?'저장한 조사 가격과 적용 방법으로 계산한 금액입니다.':item.components?'작성 단가의 구성과 계산 결과입니다.':'아래는 원본 저장값이며 재계산한 근거가 아닙니다.'}</p>${details.length?`<table><thead><tr><th>코드</th><th>품명 / 원문</th><th>규격</th><th>수량</th><th>단가</th><th>금액</th></tr></thead><tbody>${details.map(r=>`<tr><td>${esc(r.Code)}</td><td>${esc(r.Name||r.LineData||'')}</td><td>${esc(r.Size||'')}</td><td class="number">${num(r.GN)}</td><td class="number">${num(r.TU)}</td><td class="number">${num(r.TC)}</td></tr>`).join('')}</tbody></table>`:item.quoteMethod?'':'<p>이 항목의 연결 근거가 현재 자료에 없거나 아직 지원되지 않습니다. 단가와 비목은 원본에 저장된 값을 사용합니다.</p>'}${item.evidenceBid?'<p class="notice">근거 낙찰 '+esc(item.evidenceBid.percent)+'% · 비목 단가에 적용, 내역 이중 낙찰 방지 · 원단가 복원 가능</p>':''}${item.quoteMethod?'<h3>조사단가 적용 근거</h3><table><tbody>'+quoteDetails(item).map(row=>'<tr>'+row.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table>':''}${!item.quoteMethod&&item.prices?.some(v=>v!=null)?`<h3>원본 단가 열</h3><p>${item.prices.map((p,i)=>`${esc(lib?.sourceLabels?.[i]||'단가 '+(i+1))}: ${num(p)}`).join(' · ')}</p>`:''}</div>`;
 }
 $('detailContent').insertAdjacentHTML('beforeend','<button class="button" id="copyAssembly">이 단가를 복사해 일위대가 만들기</button>');
 $('copyAssembly').textContent=item.components?'구성 · 잡비 편집':'구성 · 잡비를 편집용 사본으로 열기';
 $('copyAssembly').onclick=()=>{try{if(item.evidenceBid)throw Error('근거 낙찰을 100%로 복원한 다음 구성을 편집하세요.');const editable=item.components?item:editableAssembly(item,details,lib?.items||[]);$('detailDialog').close();assemblyEditor.open(editable,null,lineId?{lineId,identity:rateIdentity(item)}:null);}catch(e){toast(e.message);}};
 if(['자재','노임'].includes(item.category)){$('detailContent').insertAdjacentHTML('beforeend','<button class="button" id="compareQuotes">조사단가 6종 비교 · 적용</button>');$('compareQuotes').onclick=()=>{$('detailDialog').close();quoteEditor.open(item,lib?.sourceLabels||[],lineId?{lineId,identity:rateIdentity(item)}:null);};}
 $('detailDialog').showModal();
}
async function download(bytes,name,type){
 if(storage.runtime){
  if(type==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')return projectFiles.exportDocument(bytes,name,'xlsx');
  if(type==='application/pdf')return projectFiles.exportDocument(bytes,name,'pdf');
 }
 const url=URL.createObjectURL(new Blob([bytes],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);return {saved:true,name};
}
const outputPreferences=createOutputPreferences(storage,e=>toast('출력 선택 저장 실패: '+e.message));
const projectFiles=createProjectFiles({desktop:!!storage.runtime,download});
let fileBusy=false;
async function saveProject(saveAs=false){
 if(fileBusy)return {cancelled:true};fileBusy=true;
 try{document.activeElement?.blur();titleEdits.flush();const snapshot=validateProject({...project,evidence:collectEvidence(project,libraries),savedAt:new Date().toISOString()});const result=await projectFiles.save(snapshot,saveAs);if(result.saved){savedProject.markSaved(snapshot);const superseded=savedProject.isDirty(project);$('saveState').textContent=superseded?'저장 후 변경 있음':'파일에 저장됨';$('saveState').title=result.path||result.name;toast(result.name+(superseded?' 저장 중 추가 편집이 있어 다시 저장해야 합니다.':' 저장 완료'));return {...result,superseded};}return result;}catch(e){toast(e.message);return {error:e.message};}finally{fileBusy=false;}
}
async function beforeReplace(){document.activeElement?.blur();titleEdits.flush();if(!savedProject.isDirty(project))return true;const answer=await askSaveBeforeClose({replacing:true});if(answer==='cancel')return false;if(answer==='save'){const result=await saveProject();return !!result.saved&&!result.superseded;}return true;}
async function chooseProject(){try{if(!await beforeReplace())return;if(storage.runtime){const selected=await projectFiles.open();if(!selected.cancelled)await openProject(selected.file,selected.token);}else $('projectInput').click();}catch(e){toast(e.message);}}

let openingProject=false;
async function openProject(f,token=null){
 if(openingProject)return;openingProject=true;
 try{
  if(f.size>30*1024*1024)throw Error('작업 파일은 30MB 이하만 지원합니다.');
  let data,sourceLibrary;
  if(/\.(estx|ebkx)$/i.test(f.name)){
   busy('EST 공사 내역과 원가계산서를 읽고 있습니다.');
   const result=await importEstProject(await f.arrayBuffer(),f.name);data=result.project;sourceLibrary=result.library;idle();
   if(!await showEstImportReport(data,true))return;
   // Include source evidence in the saved work file for use on another PC.
   const {originalBytes,...portable}=sourceLibrary;data.estLibrary=portable;
  }else{
   data=validateProject(JSON.parse(await f.text()));
   sourceLibrary=data.estLibrary;
  }

  if(sourceLibrary){
   if(!Array.isArray(sourceLibrary.items)||!Array.isArray(sourceLibrary.details)||!Array.isArray(sourceLibrary.tables))throw Error('저장된 EST 근거 자료가 올바르지 않습니다.');
   const restored=await upgradeRegisteredLibraryMetadata([sourceLibrary]),recovered=restoreEstProjectLibrary(restored.libraries[0],libraries);sourceLibrary=recovered.library;data={...data,estLibrary:recovered.portable};
   const next=[...libraries.filter(l=>l.id!==sourceLibrary.id),{...sourceLibrary,isMain:false,isProjectSource:true}];
   await put('libraries',next);libraries=next;
  }
  data=hydrateEstProjectMetadata(data,libraries).project;
  await projectFiles.activate(token);
  project={...newState(),...data};projectHistory=createProjectHistory(project);group='';selectedLineId=null;$('statusFilter').value='';
  render();changed();if(!/\.(estx|ebkx)$/i.test(f.name))savedProject.markSaved(project);else savedProject.markSaved(newState());toast('공사 내역을 열었습니다.'+(data.estImport?' EST 원본은 보존되며, 저장하면 공사노트 파일로 저장됩니다.':''));
 }catch(e){toast(e.message);}finally{idle();openingProject=false;$('projectInput').value='';}
}
const estReportButton=document.createElement('button');estReportButton.id='estImportReport';estReportButton.style.display='none';document.body.append(estReportButton);
estReportButton.onclick=()=>project.estImport?showEstImportReport(project):toast('현재 작업에는 EST 가져오기 기록이 없습니다.');

const excelSelection=setupExcelSelection({preferences:outputPreferences,getProject:()=>project,getLibraries:()=>libraries,snapshot:()=>({...project,evidence:collectEvidence(project,libraries)}),download,toast});
async function exportFile(){const t=totals(project.lines,project.charges);if(t.warnings?.length){toast(t.warnings.join(' '));return;}if(!project.lines.some(l=>!l.exclude)){toast('먼저 내역을 추가하세요.');return;}if(t.missing&&!confirm(`미확정 ${t.missing}건은 금액이 빈 상태로 표시됩니다. 검토용 엑셀로 저장할까요?`))return;try{await excelSelection.open();}catch(e){toast(e.message);}}

document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
document.addEventListener('click',e=>{const close=e.target.closest('[data-close]');if(close)$(close.dataset.close).close();});
$('quantityInput').onchange=e=>{const files=[...e.target.files];e.target.value='';if(files.length)quantityImporter.open(files);};$('estInput').onchange=e=>e.target.files.length&&importLibraries([...e.target.files]);
$('projectTitle').oninput=e=>editProjectTitle(e.target.value,false);$('projectLocation').oninput=e=>{project.location=e.target.value;changed();};
$('showExcluded').onchange=renderLines;$('statusFilter').onchange=renderLines;$('groupFilters').onclick=e=>{const b=e.target.closest('[data-group]');if(b){group=b.dataset.group;renderLines();}};
// The first empty row becomes project data only when the user edits it.
function activateEntry(id){
 if(project.lines.length)return;
 const entry=entryLines.find(l=>l.id===id);
 if(!entry)return;
 project.lines.push({...entry,qty:1});
 selectedLineId=id;
 const table=$('estimateTable');
 table.classList.remove('empty-estimate');
 for(const row of table.querySelectorAll('tbody tr[data-id]'))if(row.dataset.id!==id)row.remove();
 const selector=table.querySelector('[data-select-row]');if(selector)selector.textContent='1';
 rowSelection?.refresh([id],id);
}
function beginEntry(event){
 if(event.type==='click'&&!event.target.closest('button[data-match],button[data-copy],button[data-bid-line]'))return;
 activateEntry(event.target.closest('[data-id]')?.dataset.id);
}
for(const type of ['input','change','click'])$('estimateTable').addEventListener(type,beginEntry,true);
$('estimateTable').oninput=e=>{const input=e.target.closest('[data-field="qty"],[data-separate-price]'),row=e.target.closest('[data-id]');if(!input||!row)return;const l=project.lines.find(l=>l.id===row.dataset.id),previous=l.qty,previousRate=l.rate,isPrice=input.hasAttribute('data-separate-price');try{if(isPrice){if(input.value==='')return;Object.assign(l,setSeparateUnitPrice(l,input.value));}else{l.qty=input.value===''?null:cleanNumber(input.value);if(l.qty!=null&&l.qty<0&&!l.deduction)l.qty=null;}const a=amount(l);renderStats();if(isPrice){const rate=appliedRate(l);row.querySelectorAll('[data-unit-cost-key]').forEach(cell=>cell.textContent=num(rate[cell.dataset.unitCostKey]));}row.querySelectorAll('.cost-cell').forEach(cell=>cell.textContent=a?money(a[cell.dataset.costKey]):'—');row.querySelector('.line-total').textContent=a?money(a.total):'미확정';row.classList.toggle('unconfirmed-row',!a);const h=hierarchyTotals(project.lines);for(const tr of $('estimateTable').querySelectorAll('.heading-row')){const value=h.get(tr.dataset.id);if(value){tr.querySelectorAll('[data-cost-key]').forEach(cell=>cell.textContent=money(value[cell.dataset.costKey]));tr.querySelector('[data-heading-total]').textContent=money(value.total);tr.querySelector('[data-heading-note]').textContent=`L${value.level} 공종 소계${value.missing?' · 미확정 '+value.missing+'건':''}`;}}for(const b of $('projectTree').querySelectorAll('[data-scroll-id]')){const small=b.querySelector('small'),value=h.get(b.dataset.scrollId);if(small&&value)small.textContent=money(value.total);}for(const b of $('projectTree').querySelectorAll('[data-group]')){const small=b.querySelector('small');if(small){const t=totals(project.lines.filter(l=>l.group===b.dataset.group),[]);small.textContent=money(t.direct+t.government+t.waste+t.fees);}}changed();}catch(error){l.qty=previous;l.rate=previousRate;input.value=isPrice?previousRate?.total??0:previous??'';toast(error.message);}};
$('estimateTable').onchange=e=>{if(e.target.matches('[data-separate-price]')){const id=e.target.closest('[data-id]').dataset.id;try{project.lines=project.lines.map(l=>l.id===id?setSeparateUnitPrice(l,e.target.value):l);renderStats();renderLines();changed();}catch(error){toast(error.message);}return;}const input=e.target.closest('[data-field]'),row=e.target.closest('[data-id]');if(!input||!row)return;const l=project.lines.find(l=>l.id===row.dataset.id),f=input.dataset.field;if(f==='qty')return;if(f==='include')l.exclude=!input.checked;else if(f==='level'){const n=Number(input.value);l.level=Number.isInteger(n)&&n>=0&&n<=9?n:0;if(l.level>=2)l.headingScope='direct';}else if(f==='qty'){l.qty=input.value===''?null:cleanNumber(input.value);if(l.level!=null&&(!Number.isInteger(l.level)||l.level<0||l.level>9))throw Error('공종 레벨은 0부터 9까지입니다.');if(l.qty!=null&&l.qty<0){toast('수량은 0 이상이어야 합니다.');l.qty=null;}}else{l[f]=input.value;if(l.level&&f==='bucket')l.costScope=input.value;if(l.autoHeading==='project'&&f==='name'){project.title=l.name;$('projectTitle').value=l.name;$('desktopProjectTitle').value=l.name;}if(['name','spec','unit'].includes(f)&&!l.manualSeparate){l.status='unmatched';l.rate=null;delete l.autoMatch;}}renderStats();renderLines();changed();};
$('estimateTable').onclick=e=>{if(e.target.closest('[data-open-cost-summary]')){switchView('summary');return;}if(e.target.closest('[data-add-separate]')){try{const result=addSeparateCost(project,$('estimateTable').querySelector('[data-separate-kind]').value,$('estimateTable').querySelector('[data-separate-section]').value);project=result.project;selectedLineId=result.line.id;group='';$('statusFilter').value='';renderStats();renderLines();changed();const input=$('estimateTable').querySelector(`tr[data-id="${selectedLineId}"] [data-separate-price]`);input?.scrollIntoView({block:'center'});input?.focus();input?.select();}catch(error){toast(error.message);}return;}const fold=e.target.closest('[data-fold]');if(fold){const l=project.lines.find(l=>l.id===fold.dataset.fold);l.collapsed=!l.collapsed;renderLines();changed();return;}const tr=e.target.closest('[data-id]');if(tr&&!rowSelection){selectedLineId=tr.dataset.id;$('deleteLine').disabled=false;if($('matchDialog').open&&activeLine?.id!==selectedLineId)openMatch(selectedLineId);$('estimateTable').querySelectorAll('[data-id]').forEach(r=>r.classList.toggle('selected-line',r.dataset.id===selectedLineId));}const copy=e.target.closest('[data-copy]'),up=e.target.closest('[data-move-up]'),down=e.target.closest('[data-move-down]');if(copy||up||down){const id=copy?.dataset.copy||up?.dataset.moveUp||down?.dataset.moveDown,idx=project.lines.findIndex(l=>l.id===id);if(copy)project.lines.splice(idx+1,0,{...structuredClone(project.lines[idx]),id:crypto.randomUUID()});else{const dest=idx+(up?-1:1);if(dest>=0&&dest<project.lines.length)[project.lines[idx],project.lines[dest]]=[project.lines[dest],project.lines[idx]];}renderStats();renderLines();changed();return;}const m=e.target.closest('[data-match]'),d=e.target.closest('[data-delete]'),detail=e.target.closest('[data-detail-line]');if(m)openMatch(m.dataset.match);if(d){project.lines=project.lines.filter(l=>l.id!==d.dataset.delete);renderStats();renderLines();changed();}if(detail){const l=project.lines.find(l=>l.id===detail.dataset.detailLine);if(l?.rate)showDetail(l.rate,l.id);}};
$('suggestBtn').onclick=()=>autoLink.open();$('reviewAuto').onclick=()=>autoLink.review();
$('addLine').onclick=()=>{
 const idx=project.lines.findIndex(l=>l.id===selectedLineId),anchor=project.lines[idx];
 const line={id:crypto.randomUUID(),name:'새 항목',spec:'',unit:'',qty:1,group:anchor?.group||group||'직접 입력',bucket:'direct',status:'unmatched',rate:null,factor:1,exclude:false,source:'직접 입력'};
 project.lines.splice(idx<0?project.lines.length:idx+1,0,line);selectedLineId=line.id;$('statusFilter').value='';
 renderStats();renderLines();changed();const input=$('estimateTable').querySelector('.selected-line [data-field="name"]');input?.focus();input?.select();if($('matchDialog').open)openMatch(line.id);
};
$('deleteLine').onclick=()=>{
 const ids=new Set(rowSelection?.ids.length?rowSelection.ids:selectedLineId?[selectedLineId]:[]);if(!ids.size)return;
 project.lines=project.lines.filter(l=>!ids.has(l.id));selectedLineId=null;rowSelection?.clear();renderStats();renderLines();changed();toast(ids.size+'개 행을 삭제했습니다. 되살리기로 복원할 수 있습니다.');
};
$('matchSearch').oninput=resetMatchSearch;$('matchLibrary').onchange=resetMatchSearch;
$('matchCategories').onclick=e=>{const b=e.target.closest('[data-category]');if(b){matchCategory=b.dataset.category;resetMatchSearch();}};
$('catalogCategories').onclick=e=>{const b=e.target.closest('[data-category]');if(b){$('categoryFilter').value=b.dataset.category;catalogPages.clear();renderCatalog();}};
$('matchResults').onclick=e=>{const pager=e.target.closest('[data-db-page]');if(pager){matchPages.set(pager.dataset.dbPage,(matchPages.get(pager.dataset.dbPage)||0)+Number(pager.dataset.step));renderMatches();return;}const candidate=e.target.closest('[data-candidate]');if(candidate&&selectCandidate(candidate)){e.preventDefault();confirmRate();}};

// Keep result nodes in place between clicks so the native double-click reaches
// the same row; rebuilding the list here cancels dblclick on some WebViews.
$('matchDialog').addEventListener('close',()=>document.body.classList.toggle('matching-open',$('matchDialog').open));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&$('matchDialog').open&&!document.querySelector('dialog:modal'))$('matchDialog').close();});
function selectCandidate(element){
 const rate=candidateList[Number(element.dataset.candidate)];if(!rate)return false;chosenRate=rate;
 for(const candidate of document.querySelectorAll('#matchResults [data-candidate],#projectRateMatches [data-candidate]')){
  const selected=candidateList[Number(candidate.dataset.candidate)]?.id===rate.id;
  candidate.classList.toggle('selected',selected);const radio=candidate.querySelector('input[type=radio]');if(radio)radio.checked=selected;
 }
 renderSelected();return true;
}
for(const id of ['matchResults','projectRateMatches'])$(id).ondblclick=e=>{const candidate=e.target.closest('[data-candidate]');if(candidate&&selectCandidate(candidate)){e.preventDefault();confirmRate();}};

$('manualRateBtn').onclick=()=>{chosenRate={manual:true,id:crypto.randomUUID(),name:activeLine.name,spec:activeLine.spec,unit:activeLine.unit,code:'직접입력',source:'사용자 입력',labor:0,material:0,expense:0,other:0,total:0};$('confirmMatch').disabled=true;renderSelected();};
$('selectedRate').onclick=e=>{if(e.target.closest('#matchDetailBtn')&&chosenRate)showDetail(chosenRate);};$('confirmMatch').onclick=confirmRate;
for(const name of ['catalogSearch','categoryFilter','libraryFilter'])$(name).addEventListener(name==='catalogSearch'?'input':'change',()=>{catalogPages.clear();renderCatalog();});

$('catalogTable').onclick=e=>{const pager=e.target.closest('[data-db-page]');if(pager){catalogPages.set(pager.dataset.dbPage,(catalogPages.get(pager.dataset.dbPage)||0)+Number(pager.dataset.step));renderCatalog();return;}const d=e.target.closest('[data-detail]'),a=e.target.closest('[data-catalog-add]');if(d)showDetail(detailIndex[Number(d.dataset.detail)]);if(a){const rate=detailIndex[Number(a.dataset.catalogAdd)];project.lines.push({id:crypto.randomUUID(),name:rate.name,spec:rate.spec,unit:rate.unit,qty:1,group:group||'추가 공종',bucket:rate.government?'government':'direct',status:'proposed',rate:null,proposed:rate.id,factor:1,exclude:false,source:'단가 자료실에서 추가'});switchView('estimate');render();changed();openMatch(project.lines.at(-1).id);chosenRate=rate;renderMatches();}};
$('libraryCards').onclick=async e=>{const main=e.target.closest('[data-main-library]');if(main){for(const l of libraries)l.isMain=l.id===main.dataset.mainLibrary;await put('libraries',libraries);render();$('libraryFilter').value='';renderCatalog();return;}const b=e.target.closest('[data-remove-library]');if(!b)return;if(!confirm('이 프로그램에서 해당 단가 자료를 지울까요? 이미 연결한 내역 단가와 보관한 근거는 유지됩니다.'))return;libraries=libraries.filter(l=>l.id!==b.dataset.removeLibrary);if(libraries.length&&!libraries.some(l=>l.isMain))libraries[0].isMain=true;await put('libraries',libraries);render();};
$('chargeTable').oninput=e=>{const f=e.target.dataset.chargeField,i=e.target.closest('[data-charge]')?.dataset.charge;if(!['rate','fixed','profitRate','name'].includes(f)||i==null)return;const value=f==='name'?e.target.value:cleanNumber(e.target.value);if(value===null||typeof value==='number'&&(value<0||value>1e14)){e.target.setCustomValidity('0 이상의 숫자를 입력하세요.');return;}e.target.setCustomValidity('');project.charges[i]=editCostCharge(project.charges[i],f,value);project.ratesReviewed=false;$('ratesReviewed').checked=false;renderStats();for(const r of costSheet(project).rows){const row=[...$('chargeTable').querySelectorAll('[data-cost-row]')].find(el=>el.dataset.costRow===r.id);if(!row)continue;row.querySelector('.number').textContent=money(r.amount);const basis=row.querySelector('.cost-basis span');if(basis&&r.charge){basis.textContent=r.charge.link||r.charge.ruleSet?r.basis:r.charge.base==='fixed'?'정액':money(r.charge.baseValue)+' × '+r.charge.rate+'%';basis.title=r.basis;}}changed();};
$('chargeTable').onchange=e=>{if(e.target.dataset.chargeField==='formula'){const i=Number(e.target.closest('[data-charge]').dataset.charge);try{const next=structuredClone(project);next.charges[i]=editCostCharge(next.charges[i],'formula',e.target.value);project=validateProject(next);renderSummary();renderStats();changed();}catch(error){toast(error.message);e.target.setCustomValidity(error.message);e.target.reportValidity();}return;}if(e.target.dataset.costVisible){project.costVisibility={...project.costVisibility,[e.target.dataset.costVisible]:e.target.checked};renderSummary();changed();return;}const f=e.target.dataset.chargeField,i=e.target.closest('[data-charge]')?.dataset.charge;if(f==null||i==null)return;if(['rate','fixed','profitRate'].includes(f)&&(cleanNumber(e.target.value)===null||Number(e.target.value)<0||Number(e.target.value)>1e14)){toast('0 이상의 숫자를 입력하세요.');renderSummary();return;}project.charges[i]=editCostCharge(project.charges[i],f,['rate','fixed','profitRate'].includes(f)?cleanNumber(e.target.value):e.target.value);if(f==='name'){const linked=connectNamedCostGroup(project,project.charges[i].key);project=linked.project;if(linked.connected)toast(linked.name+' 하위 내역 합계를 원가계산서에 연결했습니다.');}project.ratesReviewed=false;$('ratesReviewed').checked=false;renderSummary();renderStats();changed();};
function commitCost(next){project=validateProject(next);renderSummary();renderStats();changed();}
function selectCost(key){selectedCostKey=key;for(const row of $('chargeTable').querySelectorAll('[data-cost-row]'))row.classList.toggle('cost-selected',row.dataset.costRow==='charge:'+key);$('deleteCostRow').disabled=!project.charges.some(c=>c.key===key);}
$('chargeTable').addEventListener('focusin',e=>{const i=e.target.closest('[data-charge]')?.dataset.charge;selectCost(i==null?null:project.charges[Number(i)]?.key);});
$('chargeTable').onclick=e=>{const row=e.target.closest('[data-cost-row]');if(row){const i=row.dataset.charge;selectCost(i==null?null:project.charges[Number(i)]?.key);}const b=e.target.closest('[data-charge-delete]');if(b){commitCost(deleteCostCharge(project,project.charges[Number(b.dataset.chargeDelete)].key));selectCost(null);}};
function addCostRow(insert){const r=insertCostCharge(project,insert?selectedCostKey:null);commitCost(r.project);selectCost(r.key);const row=[...$('chargeTable').querySelectorAll('[data-cost-row]')].find(el=>el.dataset.costRow==='charge:'+r.key);row?.scrollIntoView({block:'nearest'});row?.querySelector('input')?.focus();}
$('addCharge').onclick=()=>addCostRow(false);$('insertCostRow').onclick=()=>addCostRow(true);
$('deleteCostRow').onclick=()=>{try{commitCost(deleteCostCharge(project,selectedCostKey));selectCost(null);}catch(e){toast(e.message);}};
document.body.insertAdjacentHTML('beforeend','<dialog id="resetCostDialog"><div class="dialog-head"><h2>원가계산서 초기화</h2><button class="icon-btn" data-close="resetCostDialog" aria-label="초기화 취소">×</button></div><div style="padding:16px 22px"><p>기본 비목과 지정 요율로 돌아갑니다. 추가 비목과 자동 연동 설정은 제거합니다.</p><p>간접노무비 19.1% · 산재 3.56% · 고용 1.01%<br>석면 0.006% · 임금채권 0.09% · 기타경비 5.5%<br>일반관리비 8% · 이윤 15% · 부가세 10%</p><p>내역의 단가·수량은 유지합니다. 초기화 후 되살리기로 복구할 수 있습니다.</p></div><div class="dialog-actions"><button class="button" data-close="resetCostDialog">취소</button><button class="button primary" id="confirmResetCost">기본 요율로 초기화</button></div></dialog>');
$('resetCostSheet').onclick=()=>$('resetCostDialog').showModal();
$('confirmResetCost').onclick=()=>{commitCost(resetCostSheet(project));selectCost(null);$('resetCostDialog').close();};
$('reverseCostSheet').onclick=()=>workTools.openCost('costReverseTab').catch(e=>toast(e.message));
$('chargeHints').onclick=e=>{const b=e.target.closest('[data-charge-hints]');if(!b)return;const lib=libraries.find(l=>l.id===b.dataset.chargeHints);const text=lib.chargeHints.map(h=>h.name+': '+h.rate+'%').join('\n');if(!confirm(`다음은 원본 파일에 저장된 요율입니다. 현재 공사의 적용 가능 여부는 별도 확인이 필요합니다.\n\n${text}\n\n일치하는 항목에 적용할까요?`))return;for(const c of project.charges){const h=lib.chargeHints.find(h=>norm(h.name)===norm(c.name));if(h)c.rate=h.rate;}project.ratesReviewed=false;$('ratesReviewed').checked=false;renderSummary();renderStats();changed();};
$('ratesReviewed').onchange=e=>{project.ratesReviewed=e.target.checked;renderStats();changed();};
$('saveProject').onclick=()=>saveProject();$('openProject').onclick=chooseProject;$('projectInput').onchange=e=>e.target.files[0]&&openProject(e.target.files[0]);$('exportBtn').onclick=exportFile;$('summaryExport').onclick=exportFile;$('printBtn').onclick=()=>window.print();
$('newProject').onclick=()=>{if(project.lines.length&&!confirm('새 내역서를 만들까요? 현재 작업은 파일로 먼저 저장하세요.'))return;const mappings=project.mappings;project=newState();project.mappings=mappings;group='';render();switchView('estimate');changed();};
$('helpBtn').onclick=()=>$('helpDialog').showModal();$('clearSaved').onclick=async()=>{if(!confirm('등록 단가 자료와 현재 작업을 초기화할까요? 공사 보관함, 원본 파일과 별도 저장 파일은 유지됩니다.'))return;libraries=[];project=newState();await put('libraries',[]);await put('project',project);render();toast('프로그램 보관 자료를 초기화했습니다.');};
try{
 const l=await get('libraries');if(l!=null&&!Array.isArray(l))throw Error('단가 자료 형식을 확인하세요.');
 if(l?.some(lib=>!lib.estMetadataVersion&&lib.originalBytes))busy('등록 DB의 원본 비고를 복원하고 있습니다…');
 const restored=await upgradeRegisteredLibraryMetadata(l||[]);libraries=restored.libraries;
 if(restored.changed){try{await put('libraries',libraries);}catch{toast('원본 비고를 읽었으나 보관하지 못했습니다. 다음 실행에서 다시 확인합니다.');}}
 project=await startBlankSession(storage,newState(),validateProject);project.evidence=collectEvidence(project,libraries);render();savedProject.markSaved(project);loadedOK=true;projectHistory=createProjectHistory(project);
 if(restored.warnings.length)toast(restored.warnings.length+'개 DB의 일부 비고를 복원하지 못했습니다. 원래 단가 자료는 유지했습니다.');
}catch(e){document.querySelector('main').innerHTML='<h1>저장 자료를 열지 못했습니다.</h1><p>기존 자료를 덮어쓰지 않았습니다. 프로그램을 다시 실행해주세요.</p><p>'+esc(e.message)+'</p>';document.querySelectorAll('header button,.nav,#clearSaved').forEach(b=>b.disabled=true);throw e;}finally{idle();}

if(storage.runtime){
 document.body.classList.add('desktop-app');
 $('saveState').textContent='새 내역서';
 $('clearSaved').textContent='이 프로그램의 자료 초기화';
 $('storageLocation').textContent='이 컴퓨터에 자료 보관';
 if(!libraries.length&&storage.runtime.seedNeeded){busy('기본 메인 DB를 처음 등록하고 있습니다…');try{
  const defaults=await loadDefaultDatabases(libraries,storage.runtime,importEst);await put('libraries',defaults);libraries=defaults;render();toast('10월 메인 DB와 상수도 메인 DB가 준비됐습니다.');
 }catch(e){toast(e.message);}finally{idle();}}

}

$('projectRateMatches').onclick=e=>{const b=e.target.closest('[data-candidate]');if(b&&selectCandidate(b)){e.preventDefault();confirmRate();}};
$('mainDbBtn').onclick=()=>switchView('catalog');
$('newAssemblyBtn').onclick=()=>assemblyEditor.open(null,'일위대가');
$('newFormulaBtn').onclick=()=>assemblyEditor.open(null,'단가산출');
$('recalcBtn').onclick=()=>{render();toast('현재 확정 단가로 내역과 원가계산서를 다시 계산했습니다.');};
$('addHeading').onclick=()=>{if($('matchDialog').open)$('matchDialog').close();const line={id:crypto.randomUUID(),level:1,name:'새 공종',group:group||'공종',spec:'',unit:'',qty:null,bucket:'direct',exclude:false,status:'unmatched',factor:1};const at=project.lines.findIndex(l=>l.id===selectedLineId);project.lines.splice(at<0?project.lines.length:at,0,line);selectedLineId=line.id;render();changed();};
$('projectTree').onclick=e=>{const b=e.target.closest('[data-group]'),h=e.target.closest('[data-scroll-id]');if(b){group=b.dataset.group;switchView('estimate');renderLines();}if(h){group='';switchView('estimate');selectedLineId=h.dataset.scrollId;renderLines();document.querySelector(`[data-id="${selectedLineId}"]`)?.scrollIntoView({block:'center'});}};
document.addEventListener('click',e=>{const b=e.target.closest('[data-resource]'),v=e.target.closest('[data-work-view]');if(v)switchView(v.dataset.workView);if(!b)return;const category=b.dataset.resource,query='';
 if(view==='estimate'&&selectedLineId&&!e.target.closest('.worktabs')){openMatch(selectedLineId);if(activeLine&&!activeLine.level){matchCategory=category;if(query)$('matchSearch').value=query;resetMatchSearch();}}
 else {switchView('catalog');$('categoryFilter').value=category;if(query)$('catalogSearch').value=query;catalogPages.clear();renderCatalog();}
});
document.addEventListener('keydown',e=>{if(e.key==='F9'){e.preventDefault();$('recalcBtn').click();}if(e.key==='F12'&&$('detailDialog').open){e.preventDefault();$('detailDialog').close();}});
$('estimateTable').ondblclick=e=>{const id=e.target.closest('[data-id]')?.dataset.id,l=project.lines.find(l=>l.id===id);if(l?.rate&&!e.target.closest('input,select,button'))showDetail(l.rate,l.id);};

const estActions=setupEstActions({getProject:()=>project,getLibraries:()=>libraries,getGroup:()=>group,getSelected:()=>selectedLineId,commit:()=>{render();changed();},toast});
document.addEventListener('click',e=>{if(e.shiftKey||e.ctrlKey||e.metaKey)return;const b=e.target.closest('[data-bid-line]');if(b){selectedLineId=b.dataset.bidLine;$('bidBtn').click();$('bidScope').value='line';$('bidScope').dispatchEvent(new Event('change'));}});

$('estToolsBtn').onclick=()=>$('estToolsDialog').showModal();
document.addEventListener('click',e=>{if(e.target.closest('#estToolsDialog .tool-menu button'))$('estToolsDialog').close();},true);

const mappedImporter=setupMappedImport({getProject:()=>project,toast,replaceProject:next=>{project=validateProject(next);group='';selectedLineId=null;render();switchView('estimate');changed();},addLibrary:async lib=>{const next=[...libraries,lib];await put('libraries',next);libraries=next;render();switchView('catalog');}});
workTools=setupWorkTools({outputPreferences,openFolderImport:()=>$('folderDbInput').click(),openMappedImport:()=>mappedImporter.open(),getProject:()=>project,getLibraries:()=>libraries,getSelected:()=>selectedLineId,getSelectedIds:()=>rowSelection?.ids||[],getGroup:()=>group,storage,newState,saveUserRate,download,toast,openAssembly:rate=>assemblyEditor.open(rate,'단가산출'),commit:()=>{render();changed();},replaceProject:next=>{project=next;group='';selectedLineId=null;render();changed();},flush:async()=>{clearTimeout(saveTimer);project.evidence=collectEvidence(project,libraries);await put('project',project);await storage.settled?.();},goToLine:id=>{group='';selectedLineId=id;switchView('estimate');renderLines();document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'center'});}});

setupResourcePricing({getProject:()=>project,getLibraries:()=>libraries,toast,replaceProject:next=>{project=validateProject(next);render();changed();}});
async function runPriceUpdate(task){priceUpdatePending=task();try{return await priceUpdatePending;}finally{priceUpdatePending=null;}}
setupPriceUpdate({getProject:()=>project,getLibraries:()=>libraries,storage,toast,
 apply:result=>runPriceUpdate(async()=>{clearTimeout(saveTimer);$('saveState').textContent='단가 업데이트 저장 중…';await put('project',project);await put('libraries',libraries);await storage.applyPriceUpdate(result.project,result.libraries);project=validateProject(result.project);libraries=result.libraries;projectHistory=createProjectHistory(project);render();refreshHistory();$('saveState').textContent='단가 업데이트 저장됨';}),
 restore:()=>runPriceUpdate(async()=>{clearTimeout(saveTimer);$('saveState').textContent='이전 자료로 복원 중…';await storage.restorePriceUpdate();const [p,l]=await Promise.all([get('project'),get('libraries')]);project=validateProject(p);libraries=l;projectHistory=createProjectHistory(project);render();refreshHistory();$('saveState').textContent='업데이트 전 자료로 복원됨';})
});
const autoLink=setupAutoLink({getProject:()=>project,getLibraries:()=>libraries,toast,openMatch,setPriority:value=>{project.autoLinkPriority=value;changed();},replaceProject:next=>{project=validateProject(next);render();changed();}});
$('estToolsBtn').disabled=false;
setupUpdates(storage.runtime);

setupAdvancedTools({exportFile,getProject:()=>project,download,toast,replaceProject:next=>{project=validateProject(next);render();changed();}});
setupWorkflowTools({exportFile,getProject:()=>project,getLibraries:()=>libraries,getSelected:()=>selectedLineId,download,toast,replaceProject:next=>{project=validateProject(next);render();changed();}});
setupSupplyFees({getProject:()=>project,toast,replaceProject:next=>{project=validateProject(next);render();changed();}});
setupOriginalEst({getLibraries:()=>libraries,toast});
const levelTools=setupLevels({getProject:()=>project,getSelected:()=>selectedLineId,toast,replaceProject:next=>{project=validateProject(next);render();changed();}});
for(const [id,label,run] of [['levelTool','레벨 지정',()=>levelTools.open()],['groupLevelTool','공종명으로 소계 만들기',()=>levelTools.generate()],['collapseLevels','공종 모두 접기',()=>levelTools.fold(true)],['expandLevels','모두 펼치기',()=>levelTools.fold(false)]]){const button=document.createElement('button');button.id=id;button.className='button';button.textContent=label;button.onclick=run;$('estToolsDialog').querySelector('.tool-menu').append(button);}
function refreshHistory(){for(const [id,enabled] of [['undoProject',projectHistory?.canUndo||titleEdits.pending],['redoProject',projectHistory?.canRedo&&!titleEdits.pending]]){if($(id))$(id).disabled=!enabled;document.querySelectorAll(`[data-command="${id}"]`).forEach(b=>b.disabled=!enabled);}}
function travelHistory(redo=false){document.activeElement?.blur();titleEdits.flush();const next=redo?projectHistory.redo():projectHistory.undo();if(!next)return;project=validateProject(next);render();changed(false);toast(redo?'다시 실행했습니다.':'직전 편집을 되살렸습니다.');}
for(const [id,label,redo] of [['undoProject','되살리기',false],['redoProject','다시 실행',true]]){const b=document.createElement('button');b.id=id;b.className='button';b.textContent=label;b.onclick=()=>travelHistory(redo);$('estToolsDialog').querySelector('.tool-menu').append(b);}
document.addEventListener('keydown',e=>{if(!e.ctrlKey||e.altKey)return;const key=e.key.toLowerCase();if(!['z','y'].includes(key))return;const editing=e.target.closest('input,textarea,[contenteditable=true]');if(editing&&!editing.closest('#estimateTable,#chargeTable'))return;if(document.querySelector('dialog:modal'))return;e.preventDefault();travelHistory(key==='y'||e.shiftKey);});
const quantityImporter=setupQuantityImport({getProject:()=>project,busy,idle,toast,commit:next=>{project=validateProject(next);group='';selectedLineId=null;propose(false);switchView('estimate');render();changed();}});
function addBoundaryRow(id,direction){
 activateEntry(id);
 const result=insertBoundaryLine(project.lines,id,direction);if(!result)return null;
 project.lines=result.lines;selectedLineId=result.line.id;$('statusFilter').value='';
 if($('matchDialog').open)$('matchDialog').close();
 renderStats();renderLines();changed();rowSelection?.select(result.line.id);return result.line.id;
}
rowSelection=setupRowSelection({insertBoundary:addBoundaryRow,onChange:(id,ids)=>{selectedLineId=id;if($('matchDialog').open&&(ids.length!==1||activeLine?.id!==id))$('matchDialog').close();},onActivate:showRowMatch,remove:()=>$('deleteLine').click(),copy:()=>{try{const ids=rowSelection.ids;if(!ids.length)return;const before=new Set(project.lines.map(l=>l.id));project=editBlock(project,ids,'copy');const added=project.lines.filter(l=>!before.has(l.id)).map(l=>l.id);selectedLineId=added.at(-1);renderStats();renderLines();rowSelection.replace(added);changed();toast(added.length+'개 행을 복사했습니다.');}catch(e){toast(e.message);}}});
setupGridKeyboard({insertBoundary:addBoundaryRow,selectRow:(id,options={})=>{rowSelection.select(id,options);if(!options.shift&&!options.ctrl)showRowMatch(id);}});
rowSelection.refresh([...$('estimateTable').querySelectorAll('tbody tr[data-id]')].map(r=>r.dataset.id),selectedLineId);
const saveAsButton=document.createElement('button');saveAsButton.id='saveProjectAs';saveAsButton.hidden=true;saveAsButton.onclick=()=>saveProject(true);document.body.append(saveAsButton);
setupDesktopToolbar();refreshHistory();
setupEstLayout({getTitle:()=>project.title,refresh:renderLines,setTitle:editProjectTitle,save:()=>saveProject()});
workspaceWindows=setupWorkspaceWindows();
evidenceWorkspace=setupEvidenceWorkspace({getProject:()=>project,getLibraries:()=>libraries,getSelected:()=>selectedLineId,closeWindows:()=>workspaceWindows.closeAll(),goToLine:id=>{group='';selectedLineId=id;switchView('estimate');renderLines();document.querySelector(`[data-id="${id}"]`)?.scrollIntoView({block:'center'});},edit:(node,line)=>{selectedLineId=line.id;if(node.verified&&node.calc&&!line.rate.evidenceBid)assemblyEditor.open({...line.rate,components:node.parts,calculation:node.calculation},null,{lineId:line.id,identity:rateIdentity(line.rate)});else showDetail(line.rate,line.id);}});


function fitHeadingRows(){for(const el of $('estimateTable').querySelectorAll('textarea.heading-name,textarea.grid-group')){el.style.height='0px';el.style.height=Math.max(30,el.scrollHeight+2)+'px';}}
new ResizeObserver(fitHeadingRows).observe($('estimateTable'));
new MutationObserver(fitHeadingRows).observe($('estimateTable'),{childList:true,subtree:true});
$('estimateTable').addEventListener('input',e=>{if(e.target.matches('textarea.heading-name,textarea.grid-group'))fitHeadingRows();});
let fileDragDepth=0;
const draggedFiles=e=>Array.from(e.dataTransfer?.types||[]).includes('Files');
document.addEventListener('dragenter',e=>{if(draggedFiles(e)){e.preventDefault();fileDragDepth++;document.body.classList.add('quantity-dragging');}});
document.addEventListener('dragover',e=>{if(draggedFiles(e)){e.preventDefault();e.dataTransfer.dropEffect='copy';}});
document.addEventListener('dragleave',e=>{if(draggedFiles(e)&&--fileDragDepth<=0){fileDragDepth=0;document.body.classList.remove('quantity-dragging');}});
document.addEventListener('drop',e=>{if(!draggedFiles(e))return;e.preventDefault();fileDragDepth=0;document.body.classList.remove('quantity-dragging');const files=Array.from(e.dataTransfer.files);if(files.some(f=>!/\.(xlsx|xlsm)$/i.test(f.name))){toast('수량산출서 .xlsx 또는 .xlsm 파일을 끌어놓으세요.');return;}if(files.length)quantityImporter.open(files);});

$('chargeTable').addEventListener('keydown',e=>{if(e.key==='Enter'&&e.target.dataset.chargeField==='formula'){e.preventDefault();$('chargeTable').onchange({target:e.target});}});

// The same close transaction is used by the window X and updater restart.
globalThis.gongsaPrepareClose=createCloseController({
 getProject:()=>project,newState,isDirty:()=>savedProject.isDirty(project),ask:askSaveBeforeClose,
 beforePrompt:async()=>{if(priceUpdatePending)await priceUpdatePending;document.activeElement?.blur();clearTimeout(saveTimer);project.evidence=collectEvidence(project,libraries);await put('project',project);await storage.settled?.();await outputPreferences.settled();},
 save:()=>saveProject(),
 clearDraft:async()=>{clearTimeout(saveTimer);await put('project',newState());await storage.settled?.();},
 onError:e=>{$('saveState').textContent='저장 실패 · 종료 중단';toast('종료하지 못했습니다: '+e.message);}
});

$('newProject').onclick=async()=>{try{if(!await beforeReplace())return;await projectFiles.reset();project=newState();projectHistory=createProjectHistory(project);group='';selectedLineId=null;render();switchView('estimate');changed();savedProject.markSaved(project);}catch(e){toast(e.message);}};
document.addEventListener('keydown',e=>{if(!(e.ctrlKey||e.metaKey)||e.altKey||document.querySelector('dialog:modal'))return;const key=e.key.toLowerCase();if(key==='s'){e.preventDefault();saveProject(e.shiftKey);}else if(key==='o'){e.preventDefault();chooseProject();}else if(key==='p'){e.preventDefault();$('printSelectedTool').click();}});

// Explorer double-clicks use the same validation and save-before-replace path.
// A bare EXE launch still starts blank; only explicit file requests enter here.
async function receiveProjectLaunch(){
 try{
  if(!fileBusy&&!openingProject&&!priceUpdatePending&&!document.querySelector('dialog:modal')){
   const selected=await projectFiles.next();
   if(selected&&await beforeReplace()){await openProject(selected.file,selected.token);switchView('estimate');}
  }
 }catch(e){toast('작업 파일을 열지 못했습니다: '+e.message);}
 finally{setTimeout(receiveProjectLaunch,1000);}
}
if(storage.runtime)receiveProjectLaunch();
if(!project.lines.length&&!document.querySelector('dialog[open]'))$('estimateTable').querySelector('[data-field="name"]')?.focus({preventScroll:true});

window.addEventListener('resize',()=>{
 if(!project.lines.length){
  const field=document.activeElement?.dataset.field;
  renderLines();
  if(field)$('estimateTable').querySelector('[data-field="'+field+'"]')?.focus({preventScroll:true});
 }
});
