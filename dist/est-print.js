const displayNumber = new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
import {nativeEstimateSheets} from './est-excel-native.js';
import {layoutNativeSheet,prepareNativeSheets} from './native-print-layout.js';
import {printTypography,measurePrintText,spacedTextWidth,printHeaderWidths,printRowHeight} from './print-typography.js';
import {sectionCaption} from './project-labels.js';
import {separateSectionLabel} from './cost-scopes.js';
import {amount,appliedRate,totals,synchronizeLinkedCosts} from './calc.js';
import {costSheet} from './cost-sheet.js';
import {defaultChargeFormula} from './cost-formula.js';
import {hierarchyTotals} from './estimate-core.js';
import {collectPrintEvidence} from './print-evidence.js';
import {evidenceCategory} from './evidence-workspace.js';
import {machineBasisRows} from './machine-basis-print.js';
import {estFormulaDisplay} from './est-formula-display.js';
export const printDocuments={summary:'원가계산서',groups:'내역서총괄표',estimate:'내역서',unitSummary:'일위대가총괄표',units:'일위대가',formulaSummary:'단가산출총괄표',formulas:'단가산출',machineBasis:'기계경비적용기준',machineSummary:'기계경비총괄표',machines:'기계경비산출근거',materials:'자재단가',labor:'노임단가'};
export const defaultPrintDocuments=['summary','groups','estimate','units','formulas','machines','materials','labor'];
const mm=72/25.4;
const num=v=>v==null?'':displayNumber.format(Number(v));
const nz=v=>v?num(v):'';
const text=v=>String(v??'').replace(/[\u0000-\u0008\u000b-\u001f]/g,'');
const cell=(value,align='left',span=1)=>({value:text(value),align,span});
const money=v=>({...cell(nz(v),'right'),fit:true});
const row=(cells,extra={})=>({cells:cells.map(c=>c&&typeof c==='object'?c:cell(c)),...extra});
const costs=r=>[r.total,r.labor,r.material,(r.expense||0)+(r.other||0)];
const detailWidths=[4.4,14.35,14.15,4.4,2.4,6.5,7.5,6.5,7.5,6.5,7.5,6.5,7.5,4.3];
const detailHead=[[cell('공종','center'),cell('품 명','center'),cell('규 격','center'),cell('수량','center'),cell('단위','center'),...['합 계','노무비','재료비','경 비'].map(x=>cell(x,'center',2)),cell('비 고','center')],['','','','','',...Array.from({length:4},()=>['단 가','금 액']).flat(),''].map(x=>cell(x,'center'))];
const summaryHead=['공종','품 명','규 격','수량','단위','합 계','노무비','재료비','경 비','비 고'];
const summaryWidths=[5,17,17,6,5,12,10,10,10,8];
const byCode=(lib,table,code)=>lib?.tables?.find(t=>t.name.toLowerCase()===table.toLowerCase()+'.dat')?.rows.find(r=>r.Code===code);
export function makePrintDocuments(project,libraries=[]){
 project=synchronizeLinkedCosts(project);
 const result={},t=totals(project.lines,project.charges),hier=hierarchyTotals(project.lines),graph=collectPrintEvidence(project,libraries),lines=project.lines.filter(l=>!l.exclude);
 if(t.warnings?.length)throw Error(t.warnings.join(' '));
 const add=(key,rows,widths,headers,extra={})=>result[key]={key,title:printDocuments[key],projectTitle:project.title||'공사명',singleLine:key!=='formulas',orientation:['summary','formulas'].includes(key)?'portrait':'landscape',rows,widths,headers:headers.map(r=>r.map(c=>typeof c==='object'?c:cell(c,'center'))),...extra};
 const cs=costSheet(project).rows.filter(r=>r.visible);
 const simpleBasis={materialSum:'(1 + 2 + 3)',laborSum:'(4 + 5)',expenseSum:'(6 : '+Math.max(6,...cs.filter(r=>r.group==='경비'&&/^\d+$/.test(r.code)).map(r=>Number(r.code)))+')',net:'(A + B + C)',beforeVat:'(D + E + F)',contract:'(G + H + I)',grand:cs.find(r=>r.id==='grand')?.basis||'(J + K)'};
 if(t.totalScope)simpleBasis.contract=cs.find(r=>r.id==='contract').basis;
 add('summary',cs.map(r=>{let basis=simpleBasis[r.id]||'',rate='';if(r.charge&&r.amount){rate=r.rate==='정액'?'':r.rate;basis=defaultChargeFormula(r.charge,project.charges).replace(/\[|\]/g,'').replace(/\bR\b/g,String(r.charge.rate/100)).replace(/\*/g,'×');if(r.profitRate!==undefined)basis='도급액 자리맞춤 역산 · '+num(r.amount)+'원';}
  return row([...(r.group?[cell(''),cell(''),{...cell(r.name,'center'),fit:true,distribute:true}]:[{...cell(r.name,'center',3),fit:true,distribute:true}]),cell(r.code,'center'),money(r.amount),cell(rate,'right'),basis],{subtotal:r.subtotal,group:r.group,costId:r.id});
 }),[3.5,3.7,21.7,5.2,18.2,6.2,41.5],[[cell('비 목','center',3),'구분','금 액','요율','산 출 근 거']],{cost:true,verticalOnly:true});
 const detailRows=[];let section=0;
 for(const [index,l] of lines.entries()){
  if((l.bucket||'direct')!=='direct')continue;
  if(l.level){if(l.level>=2)section++;const a=hier.get(l.id)||{};detailRows.push(row([...(l.level>=2?[{...cell(l.sectionLabel||(l.sectionNumber||section)+'공구','center'),keepFont:true,fontSize:9},{...cell(sectionCaption(l),'left',2),readable:true,fontSize:9}]:[cell(''),cell(l.name),cell(l.spec||'')]),'','',...costs(a).flatMap(v=>['',money(v)]),''],{bold:true,group:l.name,sectionStart:true,lineIndex:index+1}));continue;}
  const a=amount(l),u=appliedRate(l);detailRows.push(row(['',l.name,l.spec||'',cell(num(l.qty),'right'),cell(l.unit,'center'),...costs(u||{}).flatMap((v,i)=>[money(v),money(a?costs(a)[i]:null)]),l.rate?.code?.startsWith('U')?'일위 참조':l.rate?.code?.startsWith('D')?'단산 참조':''],{lineIndex:index+1}));
 }
 const sumRows=[];
 const directLines=lines.filter(l=>(l.bucket||'direct')==='direct');
 const headings=directLines.filter(l=>l.level>=2);const groups=headings.length?headings:directLines.filter(l=>l.level===1);
 if(groups.length)groups.forEach((l,i)=>{const a=hier.get(l.id)||{};sumRows.push(row([...(headings.length?[{...cell(l.sectionLabel||(l.sectionNumber||i+1)+'공구','center'),keepFont:true,fontSize:9},{...cell(sectionCaption(l),'left',2),readable:true,fontSize:9}]:[cell(''),cell(l.name),cell(l.spec||'')]),'','',...costs(a).map(money),''],{bold:true}));});
 else for(const g of [...new Set(directLines.map(l=>l.group))]){const v=totals(directLines.filter(l=>l.group===g),[]);sumRows.push(row(['',g,'','','',...costs({...v,total:v.direct}).map(money),''],{bold:true}));}
 const tail=[row(['','순 공 사 비','','','',...costs({...t,total:t.direct}).map(money),''],{bold:true})];
 for(const r of cs.filter(r=>r.charge&&r.amount||(['net','beforeVat','waste','contract','government','fees','grand'].includes(r.id)||r.id.startsWith('separate:'))&&r.amount))tail.push(row(['',r.name,'',cell(r.rate&&r.rate!=='정액'?r.rate.replace('%',''):'' ,'right'),r.rate&&r.rate!=='정액'?'%':'',money(r.amount),'','','',''],{bold:r.subtotal}));
 add('groups',[...sumRows,...tail],summaryWidths,[summaryHead],{singleLine:true});
 detailRows.push(row(Array(14).fill('')));
 detailRows.push(row(['','순 공 사 비','','','',...costs({...t,total:t.direct}).flatMap(v=>['',money(v)]),''],{bold:true}));
 for(const group of t.separateGroups){
  const selected=lines.filter(l=>group.lineIds.includes(l.id)),a={total:0,labor:0,material:0,expense:0,other:0};
  for(const l of selected){const value=amount(l);if(value)for(const k of Object.keys(a))a[k]+=value[k];}
  detailRows.push(row(Array(14).fill('')));
  detailRows.push(row(['',group.name,'','','',...costs(a).flatMap(v=>['',money(v)]),''],{bold:true,sectionStart:true}));
  selected.sort((a,b)=>(Number(separateSectionLabel(a).match(/\d+/)?.[0])||0)-(Number(separateSectionLabel(b).match(/\d+/)?.[0])||0));
  for(const l of selected){const a=amount(l),u=appliedRate(l);detailRows.push(row([separateSectionLabel(l),l.name,l.spec||'',cell(num(l.qty),'right'),cell(l.unit,'center'),...costs(u||{}).flatMap((v,i)=>[money(v),money(a?costs(a)[i]:null)]),l.rate?.code?.startsWith('U')?'일위 참조':l.rate?.code?.startsWith('D')?'단산 참조':'']));}
 }
 add('estimate',detailRows,detailWidths,detailHead,{singleLine:true});
 const sourceOrder=n=>{const lib=libraries.find(l=>l.id===n.rate.library||l.name===n.rate.source);return lib?.items.find(i=>i.code===n.rate.code&&i.table!=='EstMainDat')?.record??n.rate.record??999999;};const nodes=category=>graph.nodes.filter(n=>evidenceCategory(n)===category).sort((a,b)=>sourceOrder(a)-sourceOrder(b));
 const summaryNodes=(key,category)=>add(key,nodes(category).map((n,i)=>row([String(i+1),n.rate.name,n.rate.spec||'','',n.rate.unit,...costs(n.rate).map(money),''])),summaryWidths,[summaryHead]);
 summaryNodes('unitSummary','일위대가');summaryNodes('formulaSummary','단가산출');summaryNodes('machineSummary','장비');
 const rawCells=r=>[r.NC,r.GC,(r.JC||0)+(r.SC||0),r.TC];
 const componentRows=n=>n.verified&&n.calc?n.calc.rows.map(p=>({name:p.unit==='인'?String(p.name||p.kind).replace(/\s/g,''):p.name||p.kind,spec:p.spec||'',qty:p.kind?p.percent??p.qty:p.qty,unit:p.unit||(p.kind==='percent'?'%':''),units:costs(p),amounts:costs(p.amount),formula:p.qtyExpression??p.qty,kind:p.kind,basis:p.basis,raw:p})):n.raw.filter(r=>!r.TitleCode&&(r.Name||r.LineData||r.Code)).map(r=>({name:text(r.Name||r.LineData||r.Code),spec:r.Size||'',qty:r.GN,unit:r.Unite||'',units:[r.TU,r.NU,r.GU,r.JU],amounts:[r.TC,r.NC,r.GC,(r.JC||0)+(r.SC||0)],formula:text(r.LineData||''),raw:r}));
 const unitRows=[];
 nodes('일위대가').forEach((n,i)=>{unitRows.push(row(['제'+(i+1)+'호표',n.rate.name,n.rate.spec||'','',n.rate.unit,...costs(n.rate).flatMap(v=>['',money(v)]),''],{bold:true,itemStart:true}));const parts=componentRows(n);for(const p of parts)unitRows.push(row(['',p.name,p.spec,cell(num(p.qty),'right'),cell(p.unit,'center'),...p.units.flatMap((v,i)=>[money(v),money(p.amounts[i])]),'']));if(!parts.length)unitRows.push(row([cell('구성 근거 없음 · 현재 적용 단가','left',14)]));unitRows.push(row(Array(14).fill('')));});
 add('units',unitRows,detailWidths,detailHead);
 const formulaRows=[];
 nodes('단가산출').forEach((n,i)=>{
  formulaRows.push(row([`${i+1}. ${n.rate.name} (${n.rate.spec||''}) [${n.rate.unit||''}]`,...costs(n.rate).map(money)],{bold:true,itemStart:true}));
  const display=estFormulaDisplay(n);
  for(const p of display.rows)formulaRows.push(row([{...cell(p.text),preserveSpace:!!p.preserveSpace},...(p.amount?costs(p.amount).map(money):['','','',''])],{height:3.4,bold:!!p.bold,breakBefore:!!p.breakBefore,formulaBlock:p.blockId?`${i}:${p.blockId}`:undefined,formulaKind:p.kind,originalRecord:p.originalRecord}));
  const warnings=[...new Set([...(n.issues||[]),...display.warnings])];
  if(warnings.length)formulaRows.push(row([cell(warnings.join(' / '),'left',5)],{note:true}));formulaRows.push(row(Array(5).fill('')));
 });
 add('formulas',formulaRows,[67,9,8,8,8],[['산 출 근 거','합 계','노무비','재료비','경 비']],{verticalOnly:true});
 const machineRows=[];
 nodes('장비').forEach((n,i)=>{machineRows.push(row([`${i+1}. ${n.rate.name}`,n.rate.spec||'','',...costs(n.rate).map(money),''],{bold:true,itemStart:true}));
  for(const p of componentRows(n).map(p=>{if(!n.printComponents)return p;const take=(raw)=>{const kept=Object.fromEntries(['labor','material','expense','other'].map(k=>[k,n.printComponents.includes(k)?Number(raw?.[k]||0):0]));kept.total=Object.values(kept).reduce((x,y)=>x+y,0);return costs(kept);};return {...p,units:take(p.raw),amounts:take(p.raw.amount)};}).filter(p=>!n.printComponents||p.amounts.some(Boolean))){let formula=p.formula?String(p.formula):String(p.qty??'');if(n.verified&&n.calc){formula=formula.replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,k=>{const v=n.calc.variables.find(v=>v.name===k);return v?'('+v.expression+')':k;});formula=p.kind==='percent'?`${num(p.raw.basisValue)} × ${num(p.qty)}%`:p.raw.machineOwnership?`${num(p.raw.expense)} × (${formula})`:`${num(p.units[0])} × (${formula})`;}else if(p.raw?.TU!=null)formula=`${num(p.raw.TU)} × ${num(p.raw.GN)}`;machineRows.push(row([p.name,p.spec,formula,...p.amounts.map(money),'']));}
  if(n.machine){for(const [k,v] of Object.entries(n.rate.machineInputs||{}))machineRows.push(row([k,'',String(v),'','','','','']));}
  if(!n.raw.length&&!n.parts?.length&&!n.machine)machineRows.push(row([cell('구성 근거 없음 · 현재 적용 단가','left',8)]));machineRows.push(row(Array(8).fill('')));
 });
 add('machines',machineRows,[20,16,29,7,7,7,7,7],[['명 칭','규 격','산 출 근 거','합 계','노무비','재료비','경 비','비 고']]);
 const basisRows=machineBasisRows(nodes('장비')).map(values=>row(values.map(v=>({...cell(v),readable:true,fontSize:9}))));
 add('machineBasis',basisRows,[12,24,26,13,25],[['구 분','적 용 대 상','산 식','적 용 값','근 거']]);
 const materialHeads=[[...['No','품 명','규 격','단위'].map(x=>cell(x,'center')),...['가격정보','물가자료','유통물가','물가정보','거래가격','견적가1'].map(x=>cell(x,'center',2)),cell('적용단가','center'),cell('비 고','center')],['','','','',...Array.from({length:6},()=>['단 가','page']).flat(),'',''].map(x=>cell(x,'center'))];
 add('materials',nodes('자재').map((n,i)=>{const r=n.rate,lib=(libraries.find(l=>l.id===r.library)||libraries.find(l=>l.name===r.source)),raw=byCode(lib,'StuffcDat',r.code);return row([i+1,r.name,r.spec||'',cell(r.unit,'center'),...Array.from({length:6},(_,j)=>[money(r.prices?.[j]??raw?.['Cost'+(j+1)]),r.quotePages?.[j]||raw?.['Page'+(j+1)]||'']).flat(),money(r.total),[raw?.Remark,n.printUsage&&'사용: '+n.printUsage].filter(Boolean).join(' · ')]);}),[3,14,12,3,...Array(12).fill(4.6),6,6.8],materialHeads);
 add('labor',nodes('노임').map((n,i)=>row([i+1,n.rate.name,n.rate.spec||'',cell(n.rate.unit,'center'),money(n.rate.total),{...cell([n.rate.source,n.printUsage&&'사용: '+n.printUsage].filter(Boolean).join('\n')),readable:true,fontSize:9}])),[5,27,20,8,15,25],[['No','직 종','규 격','단위','적용단가','적용 기준']]);
 const bundle={documents:Object.keys(printDocuments).map(k=>result[k]),warnings:[...(t.missing?[`단가·수량 미확정 ${t.missing}건 · 검토용 출력`]:[]),...graph.warnings],totals:t};bundle.native=nativeEstimateSheets(project,bundle);return bundle;
}
export function estPrintSettings(value={}){
 const number=(n,def,min,max)=>{const x=Number(n??def);if(!Number.isFinite(x)||x<min||x>max)throw Error('인쇄 설정 범위를 확인하세요.');return x;};
 const startPage=number(value.startPage,1,1,99999);if(!Number.isInteger(startPage))throw Error('시작번호는 정수로 입력하세요.');
 const sections=(value.sections||defaultPrintDocuments).filter((x,i,a)=>printDocuments[x]&&a.indexOf(x)===i),documents={};
 for(const [key,v] of Object.entries(value.documents||{})){if(!printDocuments[key])continue;documents[key]={size:number(v.size,printTypography(key).size,6,16),fontWidth:100,letterSpacing:0,rowHeight:v.rowHeight==null?undefined:number(v.rowHeight,printTypography(key).rowHeight,3,15),marginLeft:number(v.marginLeft,key==='summary'?20:['groups','estimate'].includes(key)?25:key==='formulas'?18.5:24,2,40),marginRight:number(v.marginRight,['summary','groups','estimate'].includes(key)?2:key==='formulas'?22.5:18,2,40),orientation:['portrait','landscape'].includes(v.orientation)?v.orientation:undefined,itemNewPage:!!v.itemNewPage,groupNewPage:!!v.groupNewPage,breakRows:String(v.breakRows||'').split(/[ ,]+/).filter(Boolean).map(Number)};if(documents[key].breakRows.some(n=>!Number.isInteger(n)||n<1))throw Error('페이지를 나눌 행 번호를 확인하세요.');}
 return {sections,startPage,documents};
}
// A page is a vector display list shared by preview, paper printing and PDF export.
export function layoutPrintDocument(doc,options={},measure=measurePrintText){
 const defaults=printTypography(doc.key),d=options.documents?.[doc.key]||{},fontScale=(d.fontWidth??defaults.fontWidth)/100,letterSpacing=d.letterSpacing??0,extent=(s,size)=>spacedTextWidth(s,size,letterSpacing,measure),landscape=(d.orientation||doc.orientation)==='landscape',width=(landscape?297:210)*mm,height=(landscape?210:297)*mm;
 const left=(d.marginLeft??(landscape?24:18.5))*mm,right=(d.marginRight??(landscape?18:22.5))*mm,tableWidth=width-left-right,size=d.size||defaults.size,rowHeight=(d.rowHeight||printRowHeight(doc))*mm,bottom=(landscape?194.5:270)*mm,cols=doc.widths.map(v=>v/doc.widths.reduce((a,b)=>a+b)*tableWidth),pages=[];
 const boundaries=[left];cols.forEach(w=>boundaries.push(boundaries.at(-1)+w));let page,y,startY,bodyStart,rowsOnPage=0,groupSpans=[];
 // Original EST fractions use three aligned, fixed-pitch lines. Fit the entire
 // block at one font size, and expose that same size to the Excel writer.
 const blockSizes=new Map();
 const spaceSize=(c,w)=>Math.min(c.fontSize||size,(w-5)/Math.max(1,measure(c.value||'',1)));
 for(const r of doc.rows){let col=0;for(const c of r.cells){const w=cols.slice(col,col+(c.span||1)).reduce((a,b)=>a+b,0);col+=c.span||1;if(c.preserveSpace&&r.formulaBlock)blockSizes.set(r.formulaBlock,Math.min(blockSizes.get(r.formulaBlock)??size,spaceSize(c,w)));}}
 const preparedRows=doc.rows.map(r=>{let col=0;return {...r,cells:r.cells.map(c=>{const w=cols.slice(col,col+(c.span||1)).reduce((a,b)=>a+b,0);col+=c.span||1;return c.preserveSpace?{...c,keepFont:true,fontSize:r.formulaBlock?blockSizes.get(r.formulaBlock):spaceSize(c,w)}:c;})};});
 const op=o=>page.ops.push(o),line=(x,y,x2,y2,weight=.35)=>op({type:'line',x,y,x2,y2,weight});
 const write=(value,x,y,{size:fontSize=size,align='left',bold=false,scale=fontScale,spacing=letterSpacing}={})=>{if(value!==''&&value!=null)op({type:'text',text:String(value),x,y,size:fontSize,align,bold,scale,spacing,width:spacedTextWidth(value,fontSize,spacing,measure)*scale});};
 function cellLines(c,w,fontSize){const s=c.value||'';fontSize=c.fontSize||fontSize;if(c.keepFont)return [s];if(!c.readable&&(c.fit||doc.singleLine))return [s.replace(/\s*\n\s*/g,' ')];const scale=c.readable?1:fontScale,max=w-(c.readable?18:5);const parts=[];for(const paragraph of s.split('\n')){let current='';for(const ch of paragraph){if(current&&extent(current+ch,fontSize)*scale>max){parts.push(current);current=ch;}else current+=ch;}parts.push(current);}return parts;}
 function drawRow(r,h,{header=false,headerIndex=0}={}){
  let gridColumn=0;
  page.grid.rows.push({...r,y,height:h,header,headerIndex,cells:r.cells.map(c=>{const width=cols.slice(gridColumn,gridColumn+(c.span||1)).reduce((a,b)=>a+b,0);gridColumn+=c.span||1;return {...c,fit:!c.keepFont&&!c.readable&&(c.fit||!!doc.singleLine),lines:cellLines(c,width,header?size+1:size)};})});
  if(doc.cost&&!header&&r.group){const last=groupSpans.at(-1);if(last?.group===r.group)last.end=y+h;else groupSpans.push({group:r.group,start:y,end:y+h});}let col=0;for(const c of r.cells){const span=c.span||1,w=cols.slice(col,col+span).reduce((a,b)=>a+b,0),x=boundaries[col];if(x===undefined)break;
   if(header&&!c.value){col+=span;continue;}const ch=header&&doc.headers.length===2&&span===1&&headerIndex===0?h*2:h;const parts=cellLines(c,w,header?size+1:size);const fontSize=c.fontSize||(header?size+1:size),leading=fontSize*(c.readable?1.3:doc.key==='formulas'?1.05:1.15),top=y+(ch-parts.length*leading)/2+fontSize;
   parts.forEach((str,j)=>{if(c.distribute&&str.length>1&&str.length<=13){const inset=doc.cost&&span>=3?cols[0]+cols[1]+4:Math.min(10,w*.08),available=Math.min(w-2*inset,Math.max(fontSize*6.4,(str.length-1)*fontSize*fontScale*1.05));[...str].forEach((ch,k)=>write(ch,x+inset+k*available/(str.length-1),top+j*leading,{size:fontSize,align:'center',bold:!!r.bold,scale:fontScale}));return;}if(header){const label=str.replace(/\s/g,''),target=printHeaderWidths[label];if(target&&label.length>1){const width=Math.min(w-5,target),spacing=Math.max(-1,(width/fontScale-measure(label,fontSize))/(label.length-1));write(label,x+w/2,top+j*leading,{size:fontSize,align:'center',scale:fontScale,spacing});return;}}const align=header?'center':c.align||'left';write(str,align==='right'?x+w-2:align==='center'?x+w/2:x+2,top+j*leading,{size:fontSize,align,bold:!!r.bold,scale:c.keepFont?1:c.readable?1:c.fit||doc.singleLine?Math.min(fontScale,(w-5)/Math.max(1,extent(str,fontSize))):fontScale});});
   if(col)line(x,y,x,y+ch);if(header)line(x,y+ch,x+w,y+ch,.35);col+=span;
  }
  if(!header&&(!doc.verticalOnly||r.subtotal||(r.itemStart&&doc.key!=='formulas')||doc.cost&&!r.group))line(left,y+h,left+tableWidth,y+h,header||r.subtotal?.6:.35);y+=h;rowsOnPage++;
 }
 function start(){page={width,height,orientation:landscape?'landscape':'portrait',document:doc.key,title:doc.title,ops:[],grid:{left,right,cols,size,bottom,rows:[],cost:!!doc.cost,verticalOnly:!!doc.verticalOnly}};pages.push(page);rowsOnPage=0;groupSpans=[];
  const first=pages.length===1;const titleY=(landscape?24:31)*mm,titleSize=24,titleText=doc.title.length===3?[...doc.title].join('  '):doc.title,titleWidth=Math.max(144,measure(titleText,titleSize)+18),titleCenter=left+tableWidth/2,titleX=titleCenter-titleWidth/2;
  if(first){op({type:'rect',x:titleX+2,y:titleY-titleSize-3+2,width:titleWidth,height:titleSize+5,fill:.7,weight:0});op({type:'rect',x:titleX,y:titleY-titleSize-3,width:titleWidth,height:titleSize+5,fill:1,weight:.6});write(titleText,titleCenter,titleY,{size:titleSize,align:'center',bold:true,scale:1,spacing:doc.title.length===3?0:1.2});}
  const gridTop=(first?(landscape?30:37):(landscape?18:25))*mm;write(doc.projectTitle,left,gridTop-2*mm,{size:10,scale:.8});y=gridTop;startY=y;
  page.grid.top=gridTop;page.grid.first=first;page.grid.projectTitle=doc.projectTitle;page.grid.headerCount=doc.headers.length;
  for(const [headerIndex,head] of doc.headers.entries())drawRow(row(head),doc.headers.length>1?5.6*mm:(doc.cost?12:10)*mm,{header:true,headerIndex});bodyStart=y;
 }
 function finish(){if(!page)return;if(doc.cost&&groupSpans.length){const end=groupSpans.at(-1).end;op({type:'rect',x:left,y:bodyStart,width:cols[0],height:end-bodyStart,fill:1,weight:.35});const label='순공사원가';[...label].forEach((ch,i)=>write(ch,left+cols[0]/2,(bodyStart+end)/2+(i-(label.length-1)/2)*size*3,{align:'center'}));for(const g of groupSpans){op({type:'rect',x:boundaries[1],y:g.start,width:cols[1],height:g.end-g.start,fill:1,weight:.35});[...g.group].forEach((ch,i)=>write(ch,boundaries[1]+cols[1]/2,(g.start+g.end)/2+(i-(g.group.length-1)/2)*size*2,{align:'center'}));}}const remaining=bottom-y;if(remaining>0){if(!doc.cost&&!doc.verticalOnly){while(y+rowHeight<bottom)drawRow(row(cols.map(()=>'')),rowHeight);}
   for(let i=1;i<boundaries.length-1;i++)line(boundaries[i],y,boundaries[i],bottom);}
  page.grid.groupSpans=groupSpans.map(g=>({...g}));page.grid.bodyStart=bodyStart;
  op({type:'rect',x:left,y:startY,width:tableWidth,height:bottom-startY,fill:null,weight:.8});
 }
 start();
 const heightFor=r=>{let col=0;return Math.max(r.height?r.height*mm:rowHeight,...r.cells.map(c=>{const w=cols.slice(col,col+(c.span||1)).reduce((a,b)=>a+b,0);col+=c.span||1;return cellLines(c,w,c.fontSize||size).length*(c.fontSize||size)*(c.readable?1.3:doc.key==='formulas'?1.05:1.15)+(doc.key==='formulas'?1:4);}));};
 for(const [index,r] of preparedRows.entries()){
  const blockStart=r.formulaBlock&&r.formulaBlock!==preparedRows[index-1]?.formulaBlock,insideBlock=r.formulaBlock&&!blockStart;
  const block=[];if(blockStart)for(let j=index;j<preparedRows.length&&preparedRows[j].formulaBlock===r.formulaBlock;j++)block.push(preparedRows[j]);
  const h=heightFor(r),keep=blockStart?block.reduce((n,x)=>n+heightFor(x),0):r.itemStart?preparedRows.slice(index,index+3).reduce((n,x)=>n+heightFor(x),0):h;
  const blockBreak=blockStart&&block.some((x,j)=>x.breakBefore||d.breakRows?.includes(x.lineIndex||index+j+1));
  const force=!insideBlock&&(r.breakBefore||blockBreak||d.breakRows?.includes(r.lineIndex||index+1)||(d.itemNewPage&&r.itemStart)||(d.groupNewPage&&r.sectionStart)||((r.itemStart||blockStart)&&y+keep>bottom));
  if((force&&rowsOnPage>doc.headers.length)||y+h>bottom){finish();start();}
  if(y+h>bottom)throw Error(doc.title+'의 한 행이 용지보다 큽니다. 글자 크기나 내용을 조정하세요.');
  drawRow(r,h);
 }
 finish();return pages;
}
export function buildPrintPages(bundle,options={},measure){const s=estPrintSettings(options),pages=[],native=bundle.native&&prepareNativeSheets(bundle.native,s);for(const key of s.sections){const doc=bundle.documents.find(d=>d.key===key);if(!doc||!doc.rows.length)continue;const sheet=native?.sheets.find(n=>n.name===doc.title);pages.push(...(sheet?layoutNativeSheet(sheet,native.styles,doc,s).pages:layoutPrintDocument(doc,s,measure)));}if(!pages.length)throw Error('출력할 항목이 없습니다.');if(pages.length>1000)throw Error('출력량이 너무 많습니다. 문서를 나누어 출력하세요.');pages.forEach((p,i)=>{p.number=s.startPage+i;p.ops.push({type:'text',text:`- ${p.number} -`,x:p.width/2,y:p.footerY??(p.height-(p.orientation==='portrait'?23:12)*mm),size:8,align:'center',scale:.8});});return pages;}
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
export function printPageSvg(page){return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}pt" height="${page.height}pt" viewBox="0 0 ${page.width} ${page.height}" role="img" aria-label="${xml(page.title)} ${page.number}쪽"><rect width="100%" height="100%" fill="white"/>`+page.ops.map(o=>o.type==='line'?`<line x1="${o.x}" y1="${o.y}" x2="${o.x2}" y2="${o.y2}" stroke="black" stroke-width="${o.weight}"/>`:o.type==='rect'?`<rect x="${o.x}" y="${o.y}" width="${o.width}" height="${o.height}" fill="${o.fill==null?'none':o.fill===1?'white':'#b3b3b3'}" stroke="black" stroke-width="${o.weight}"/>`:`<text transform="translate(${o.x} ${o.y}) scale(${o.scale||1} 1)" text-anchor="${{left:'start',right:'end',center:'middle'}[o.align]||'start'}" font-family="GulimChe,굴림체,Malgun Gothic,sans-serif" font-size="${o.size}" font-weight="normal" ${Number.isFinite(o.width)&&o.width>0?`textLength="${o.width/(o.scale||1)}" lengthAdjust="spacingAndGlyphs"`:""} letter-spacing="${o.spacing||0}" stroke="${o.bold?'black':'none'}" stroke-width="${o.bold?.08:0}" xml:space="preserve">${xml(o.text)}</text>`).join('')+'</svg>';}
export const printVectorCss='@page portrait{size:A4 portrait;margin:0}@page landscape{size:A4 landscape;margin:0}.est-vector-page{margin:0;padding:0;break-after:page;overflow:hidden}.est-vector-page:last-child{break-after:auto}.est-vector-page svg{display:block;width:100%;height:100%}';
export function printPagesHtml(pages){return pages.map(p=>`<article class="est-vector-page" style="page:${p.orientation};width:${p.width}pt;height:${p.height}pt">${printPageSvg(p)}</article>`).join('');}
