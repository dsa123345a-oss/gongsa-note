const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
import {costSheet} from './cost-sheet.js';
import {printSettings,printedLines} from './print-settings.js';
import {quoteDetails,safetyDetails} from './reference-details.js';
import {hierarchyTotals} from './estimate-core.js';
import {aggregateCalculation,calculationModes} from './calculation-modes.js';
import {amount,totals} from './calc.js';
import {calculateAssemblyDetailed} from './estimate-core.js';
import {resourceReport,scheduleRows} from './work-core.js';
import {collectPriceEvidence} from './price-evidence.js';
import {rateIdentity} from './project-data.js';
import {estFormulaDisplay} from './est-formula-display.js';
import {measurePrintText} from './print-typography.js';
export const escapeHtml=s=>String(s??'').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const e=escapeHtml,n=v=>v==null?'—':displayNumber.format(Number(v));
export const printSections={description:'공사설명서',summary:'원가계산서',groups:'공종 총괄표',estimate:'설계내역서',evidence:'일위·단가산출 근거',quotes:'조사단가 비교표',resources:'동원인원·자재·장비',schedule:'예정공정표'};
export const printCss=`body{font-family:"Malgun Gothic",sans-serif;color:#17212e;background:white} .print-page{page-break-before:always;padding:12px 0}.print-page:first-child{page-break-before:auto}.print-page h1{color:#17212e;text-align:center;font-size:1.7em;margin:12px 0 24px}.print-page h2{color:#17212e;font-size:1.15em}.print-page table{border-collapse:collapse;width:100%;font-size:inherit}.print-page th,.print-page td{border:1px solid #9da5ae;padding:var(--row-padding,5px) 6px;vertical-align:middle;overflow-wrap:anywhere}.print-page th{text-align:center;background:#eef0f2}.print-page td.number{text-align:right;font-variant-numeric:tabular-nums}.print-page tr{break-inside:avoid}.print-page .print-break{break-before:page;page-break-before:always}.print-page thead{display:table-header-group}.print-page .print-note{font-size:.9em;color:#59616b;white-space:pre-wrap}.print-page .cover-title{margin:70px 0;font-size:2em;text-align:center}.print-page .description{white-space:pre-wrap;line-height:1.8}.print-page .gantt{height:12px;background:#dbe2e9}.print-page .gantt span{display:block;height:100%;background:#526b85}.print-page .cover-meta{margin:35px auto;max-width:650px}.print-page .cover-meta th{width:25%}.print-page .legacy-est-formula{table-layout:fixed;font-family:GulimChe,굴림체,monospace}.print-page .legacy-est-formula td{white-space:pre;overflow-wrap:normal;padding:1px 3px;line-height:1.2;vertical-align:top}.print-page .legacy-est-formula .formula-emphasis{font-weight:600}`;
const table=(headers,rows,breakRows=new Set())=>'<table><thead><tr>'+headers.map(x=>'<th>'+e(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map((row,index)=>'<tr'+(breakRows.has(index)?' class="print-break"':'')+'>'+row.map(x=>'<td'+(typeof x==='number'?' class="number"':'')+'>'+e(typeof x==='number'?n(x):x)+'</td>').join('')+'</tr>').join('')+'</tbody></table>';
const unitCost=r=>r.category==='단가산출'||r.table==='CostTitleDat'||/^D/.test(r.code||'');
function unitCostTable(node,settings){
 const display=estFormulaDisplay(node),groups=[];
 for(const r of display.rows){const last=groups.at(-1);if(r.blockId&&last?.[0].blockId===r.blockId)last.push(r);else groups.push([r]);}
 const size=settings.documents.evidence?.size||settings.size,width=((settings.orientation==='portrait'?210:297)-2*settings.margin)*72/25.4;
 const headers=['산 출 근 거','합계','노무비','재료비','경비'],widths=[67,9,8,8,8];
 const rows=groups.map(group=>{
  const formula=group.map(r=>r.text).join('\n'),amounts=group.map(r=>r.amount?[r.amount.total,r.amount.labor,r.amount.material,(r.amount.expense||0)+(r.amount.other||0)]:Array(4).fill(null));
  // One multiline row keeps EST's fraction numerator/bar/denominator together
  // even in the legacy measured-page paginator. Every line uses one font size.
  const fontSize=Math.min(size,(width*.67-8)/Math.max(1,...group.flatMap(r=>String(r.text).split('\n')).map(s=>measurePrintText(s,1))));
  const classes=[group.some(r=>r.breakBefore)&&'print-break',group.some(r=>r.bold)&&'formula-emphasis'].filter(Boolean).join(' ');
  return '<tr'+(classes?' class="'+classes+'"':'')+' style="font-size:'+fontSize+'pt"><td class="formula-source">'+e(formula)+'</td>'+Array.from({length:4},(_,i)=>'<td class="number">'+amounts.map(a=>a[i]==null||a[i]===0?'':e(n(a[i]))).join('\n')+'</td>').join('')+'</tr>';
 }).join('');
 const warnings=[...new Set([...(node.issues||[]),...display.warnings])];
 return (warnings.length?'<p class="print-note">'+warnings.map(e).join('\n')+'</p>':'')+'<table class="legacy-est-formula"><thead><tr>'+headers.map((h,i)=>'<th style="width:'+widths[i]+'%">'+e(h)+'</th>').join('')+'</tr></thead><tbody>'+rows+'</tbody></table>';
}
export function printPack(project,libraries,options={}){
 const settings=printSettings(options);const check=totals(project.lines,project.charges);if(check.warnings?.length)throw Error(check.warnings.join(' '));
 const t=totals(project.lines,project.charges),meta=project.documents||{},resources=resourceReport(project,libraries),schedule=scheduleRows(project),rows=project.lines.filter(l=>!l.exclude&&!l.level),warning=t.missing?`검토용 · 단가/수량 미확정 ${t.missing}건을 제외한 부분합`:'현재 원가계산서 기준';
 const section=(key,html)=>`<section class="print-page" data-section="${key}" style="font-size:${settings.documents[key]?.size||settings.size}pt;--row-padding:${settings.documents[key]?.rowPadding||settings.rowPadding}px"><h1>${printSections[key]}</h1><p>${e(project.title)} · ${e(project.location)}</p><p class="print-note">${e(warning)}</p>${html}</section>`;
 const content={},hierarchy=hierarchyTotals(project.lines);
 content.description=section('description',`<div class="description">${e(meta.description||'공사 목적·개요·시공 조건을 입력하세요.')}</div>`);
 content.summary=section('summary',table(['비목','항목','구분','약어','금액','요율 / 정액','산출근거'],costSheet(project).rows.filter(r=>r.visible).map(r=>[r.group,r.name,r.code,r.abbr,r.amount,r.charge?(r.charge.base==='fixed'?r.charge.fixed:r.charge.rate+'%'):'',r.basis])));
 content.summary=content.summary.replace('</section>',t.charges.filter(c=>c.comparison).map(c=>'<h2>'+e(c.name)+' · 비교 근거(합산 제외)</h2>'+table(['항목','값'],safetyDetails(c))).join('')+'</section>');
 const quoteRates=new Map([...(project.evidence||[]).map(e=>e.rate),...rows.map(l=>l.rate).filter(Boolean)].filter(r=>r.quoteMethod).map(r=>[r.id||JSON.stringify([r.source,r.code]),r]));
 content.quotes=section('quotes',[...quoteRates.values()].map(r=>'<h2>'+e(r.name+' '+(r.spec||''))+'</h2>'+table(['항목 / 출처','가격 / 설정','페이지 · 근거','선택'],quoteDetails(r).map(row=>[...row,...Array(Math.max(0,4-row.length)).fill('')]))).join('')||'<p>적용한 조사단가가 없습니다.</p>');
 const groupSummary=project.lines.some(l=>l.level)?project.lines.filter(l=>l.level&&!l.exclude).map(l=>{const h=hierarchy.get(l.id);return ['L'+l.level+' '+l.name,h.labor,h.material,h.expense+h.other,h.total,h.missing];}):[...new Set(rows.map(l=>l.group))].map(g=>{const subset=rows.filter(l=>l.group===g&&aggregateCalculation(l)),v=subset.map(amount).filter(Boolean);return [g,...['labor','material'].map(k=>v.reduce((s,a)=>s+a[k],0)),v.reduce((s,a)=>s+a.expense+a.other,0),v.reduce((s,a)=>s+a.total,0),subset.length-v.length];});
 content.groups=section('groups',table(['공종','노무비','재료비','경비·기타','전체 금액','미확정'],groupSummary));

 const lines=printedLines(project.lines,settings.level),breakRows=new Set(lines.flatMap((l,i)=>(settings.breakRows.includes(i+1)||(i&&settings.groupNewPage&&l.group!==lines[i-1].group))?[i]:[]));
 content.estimate=section('estimate',table(['공종','품명','규격','단위','수량','노무비','재료비','경비·기타','합계','계상','계산 방식'],lines.map(l=>{const a=l.level?hierarchy.get(l.id):amount(l);return [l.group,l.level?'[L'+l.level+'] '+l.name:l.name,l.spec,l.unit,l.qty,...['labor','material'].map(k=>a?.[k]??'미확정'),a?a.expense+a.other:'미확정',a?.total??'미확정',{direct:'직접',government:'관급',waste:'폐기물',fees:'수수료'}[l.bucket],l.level?'':calculationModes[l.calculationMode||'auto']];}),breakRows));
 const formulaNodes=collectPriceEvidence(project,libraries).nodes.filter(node=>unitCost(node.rate));
 const formulaByIdentity=new Map(formulaNodes.map(node=>[rateIdentity(node.rate),node])),rendered=new Set(),orderedEvidence=[];
 // Use current, actually used rates. A saved obsolete formula must not return
 // merely because its old evidence snapshot still exists in the project file.
 for(const entry of project.evidence||[]){if(!unitCost(entry.rate)){orderedEvidence.push(entry);continue;}const node=formulaByIdentity.get(rateIdentity(entry.rate));if(node&&!rendered.has(node)){orderedEvidence.push({rate:node.rate,node});rendered.add(node);}}
 for(const node of formulaNodes)if(!rendered.has(node)){orderedEvidence.push({rate:node.rate,node});rendered.add(node);}
 content.evidence=section('evidence',orderedEvidence.map(({rate,rows:detail,node},index)=>{if(node)return '<div'+(index&&settings.evidenceNewPage?' class="print-break"':'')+'><h2>'+e(rate.name+' '+(rate.spec||'')+' / '+rate.code)+'</h2><p class="print-note">'+e(rate.source)+'</p>'+unitCostTable(node,settings)+'</div>';let r;if(rate.components){const calc=calculateAssemblyDetailed(rate.components,rate.calculation||{});r=calc.rows.map(p=>[p.code||p.kind,p.name,p.qtyExpression||p.qty,p.amount.labor,p.amount.material,p.amount.expense+p.amount.other,p.amount.total,calculationModes[p.calculationMode||(p.exclude?'vertical':'auto')]]);}else r=(detail||[]).filter(p=>p.Code||p.Name||p.LineData?.trim()||p.TC).map(p=>[p.Code,p.Name||p.LineData||'',p.GN,p.NC,p.GC,p.JC,p.TC,'원본 저장 근거']);return '<div'+(index&&settings.evidenceNewPage?' class="print-break"':'')+'><h2>'+e(rate.name+' '+rate.spec+' / '+rate.code)+'</h2><p class="print-note">'+e(rate.source)+(rate.evidenceBid?' · 근거 낙찰 '+rate.evidenceBid.percent+'%':'')+(rate.components?' · 편집 산식 재계산':' · 원본 저장 근거')+'</p>'+table(['코드','품명 / 산식','수량','노무','재료','경비','합계','계산 방식'],r)+'</div>';}).join(''));
 content.resources=section('resources',`<p class="print-note">근거 전체 확인 ${resources.covered}/${resources.total}건. ${resources.warnings.length?'미확인 근거가 있어 부분 집계입니다.':'읽을 수 있는 구성 수량을 기준으로 집계했습니다.'} 노임은 원본 단위(인/시간), 장비는 원본 가동 단위입니다. 장비 내부의 운전원·유류는 중복 집계하지 않습니다.</p>`+table(['구분','품명','규격','단위','수량','관급','자료'],resources.rows.map(r=>[r.category,r.name,r.spec,r.unit,r.qty,r.government?'관급':'',r.source]))+`<p class="print-note">${resources.warnings.map(e).join('\n')}</p>`);
 const dates=schedule.flatMap(r=>[r.start,r.end]).filter(Boolean).map(Date.parse).filter(Number.isFinite),min=Math.min(...dates),max=Math.max(...dates),span=Math.max(86400000,max-min+86400000);
 content.schedule=section('schedule',table(['공종','시작일','종료일','진행률'],schedule.map(r=>[r.group,r.start,r.end,r.progress+'%']))+schedule.filter(r=>r.start&&r.end).map(r=>`<p>${e(r.group)}</p><div class="gantt"><span style="margin-left:${100*(Date.parse(r.start)-min)/span}%;width:${100*(Date.parse(r.end)-Date.parse(r.start)+86400000)/span}%"></span></div>`).join('')+'<p class="print-note">사용자가 지정한 예정일 기준입니다. 자동 공정 최적화 결과가 아닙니다.</p>');
 const order=(options.sections||Object.keys(printSections)).filter(k=>content[k]);return {html:order.map(k=>content[k]).join(''),resources,schedule};
}
