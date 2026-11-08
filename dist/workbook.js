import {translateCostFormula,chargeCodes} from './cost-formula.js';
import {synchronizeLinkedCosts} from './calc.js';
import {quoteDetails,safetyDetails} from './reference-details.js';
import {hierarchyTotals,calculateAssemblyDetailed} from './estimate-core.js';
import {unzip,zipStore} from './est.js';
import {aggregateCalculation,manualCalculation,calculationModes} from './calculation-modes.js';
import {cleanNumber,amount,totals,chargeBaseLabels,bidPercent} from './calc.js';
import {recalculateMissingWorkbook,shiftSharedFormula} from './workbook-formulas.js';
import {readQuantityContracts,attachQuantityContracts} from './quantity-contract.js';
import {workConnectionJoints} from './work-connection-joints.js';
const dec=new TextDecoder();
const parse=b=>{const d=new DOMParser().parseFromString(typeof b==='string'?b:dec.decode(b),'application/xml');if(d.querySelector('parsererror'))throw Error('엑셀 XML을 읽을 수 없습니다.');return d;};
const all=(e,n)=>Array.from(e.getElementsByTagNameNS('*',n));
const text=(e,n)=>all(e,n)[0]?.textContent??'';
export async function readWorkbook(input,options={}){
 const z=await unzip(input),work=await z.read('xl/workbook.xml'),rels=await z.read('xl/_rels/workbook.xml.rels');
 if(!work||!rels)throw Error('.xlsx 형식의 수량산출서를 선택해주세요.');
 const ss=await z.read('xl/sharedStrings.xml');const strings=ss?all(parse(ss),'si').map(x=>all(x,'t').map(t=>t.textContent).join('')):[];
 const targets=new Map(all(parse(rels),'Relationship').map(r=>[r.getAttribute('Id'),r.getAttribute('Target')]));const sheets=[];
 for(const s of all(parse(work),'sheet')){
  const rel=s.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships','id');let target=targets.get(rel);if(!target)continue;
  target=target.startsWith('/')?target.slice(1):'xl/'+target.replace(/^\.\//,'');const bytes=await z.read(target);if(!bytes)continue;
  const document=parse(bytes),shared=new Map();for(const c of all(document,'c')){const f=all(c,'f')[0];if(f?.getAttribute('t')==='shared'&&f.textContent)shared.set(f.getAttribute('si'),{ref:c.getAttribute('r'),formula:f.textContent});}
  const rows=[];for(const row of all(document,'row')){const cells={};for(const c of all(row,'c')){
   const ref=c.getAttribute('r'),type=c.getAttribute('t'),v=text(c,'v'),f=all(c,'f')[0];let formula=f?.textContent||'',value=v;
   if(f&&!formula){const base=shared.get(f.getAttribute('si'));try{formula=base?shiftSharedFormula(base.formula,base.ref,ref):'UNSUPPORTED_SHARED()';}catch{formula='UNSUPPORTED_SHARED()';}}
   if(type==='s')value=strings[Number(v)]??'';else if(type==='inlineStr')value=all(c,'t').map(t=>t.textContent).join('');else if(type!=='str'&&v!==''&&Number.isFinite(Number(v)))value=cleanNumber(v);
   cells[ref.replace(/\d/g,'')]={value,formula,ref,type,cached:!formula||v!==''};
  } rows.push({index:Number(row.getAttribute('r')),cells});}sheets.push({name:s.getAttribute('name'),rows});
 }
 return readQuantityContracts(recalculateMissingWorkbook(sheets,options));
}
const val=(r,c)=>r.cells[c]?.value??'';
function colIndex(c){let n=0;for(const s of c)n=n*26+s.charCodeAt(0)-64;return n;}
export function extractQuantities(sheet){
 const result=[],maps=[];let title='',location='';
 const hasHeader=sheet.rows.some(r=>Object.values(r.cells).some(c=>/^(공\s*종|품\s*목|품\s*명)$/.test(String(c.value).trim())));
 if(!hasHeader&&sheet.rows.some(r=>String(val(r,'A')).startsWith('수량산출서'))&&sheet.rows.some(r=>/^\d+\s*[.]/.test(String(val(r,'A')))&&String(val(r,'D')).trim()&&typeof val(r,'AD')==='number'&&/^(개소|개|조|식|m|M|㎥|㎡|m2|m3|톤|TON|ton|대|인|일|시간|HR)$/.test(String(val(r,'AG')).trim())))maps.push({name:'D',spec:'M',quantity:'AD',unit:'AG',group:'A',header:0});
 if(!hasHeader&&sheet.rows.some(r=>String(val(r,'A')).startsWith('수량산출서'))&&sheet.rows.some(r=>/^\d+\s*[.]/.test(String(val(r,'A')))&&String(val(r,'B')).trim()&&typeof val(r,'S')==='number'&&/^(개소|개|조|식|m|㎥|㎡|m2|m3|톤|ton|대|인|일|시간|hr)$/i.test(String(val(r,'U')).trim())))maps.push({name:'B',spec:'F',quantity:'S',unit:'U',group:'A',header:0});
 for(const r of sheet.rows){
  if(r.index<=4){const label=String(val(r,'A')).replace(/\s/g,''),value=String(val(r,'E')||val(r,'C'));if(label.includes('공사명'))title=value;if(label.includes('위치')){location=value;if(!title)title=value;}}
  const headers=Object.entries(r.cells).filter(([,c])=>/^(공\s*종|품\s*목|품\s*명)$/.test(String(c.value).trim()));
  for(const[col]of headers){const ci=colIndex(col),cells=Object.entries(r.cells).filter(([c])=>colIndex(c)>ci).sort((a,b)=>colIndex(a[0])-colIndex(b[0]));
   const spec=cells.find(([,x])=>String(x.value).trim()==='규격')?.[0],quantity=cells.find(([,x])=>String(x.value).trim()==='수량')?.[0];let unit=cells.find(([,x])=>String(x.value).trim()==='단위')?.[0];
   // Older sheets omit the unit heading in both side-by-side blocks. Infer
   // only a nearby column containing units on actual numeric quantity rows.
   if(!unit&&quantity){const qi=colIndex(quantity),counts=new Map();
    for(const row of sheet.rows){if(row.index<=r.index||typeof val(row,quantity)!=='number')continue;
     for(const [c,v] of Object.entries(row.cells)){if(colIndex(c)>qi&&colIndex(c)<=qi+3&&/^(개소|개|조|식|m|㎥|㎡|m2|m3|톤|ton|대|인|일|시간|hr|kg|매|본|set)$/i.test(String(v.value).trim()))counts.set(c,(counts.get(c)||0)+1);}
    }
    const ranked=[...counts].sort((a,b)=>b[1]-a[1]);if(ranked.length&&(!ranked[1]||ranked[0][1]>ranked[1][1]))unit=ranked[0][0];
   }
   if(!quantity||!unit)continue;const basis=cells.find(([,x])=>/산출\s*근거/.test(String(x.value)))?.[0];const group=Object.entries(r.cells).filter(([c,v])=>colIndex(c)<ci&&/^구\s*분$/.test(String(v.value).trim())).sort((a,b)=>colIndex(b[0])-colIndex(a[0]))[0]?.[0]||(ci>30?'AI':'A');const m={name:col,spec,quantity,unit,group,basis,header:r.index};const old=maps.findIndex(x=>x.name===col);if(old>=0)maps[old]=m;else maps.push(m);
  }
  for(const m of maps){if(r.index<=m.header)continue;
   const g=String(val(r,m.group)).trim();if(g&&!/구\s*분/.test(g)){if(g!==m.currentGroup)m.pending=null;m.currentGroup=g;}
   let name=String(val(r,m.name)).trim(),spec=String(val(r,m.spec)).trim(),nameRef=m.name+r.index;
   if(!spec&&m.spec&&m.basis){const alternate=Object.entries(r.cells).find(([c,v])=>colIndex(c)>colIndex(m.spec)&&colIndex(c)<colIndex(m.basis)&&/^(?:D|DN|Φ|φ|ø)?\s*\d+\s*(?:A|SU|mm)?$/i.test(String(v.value).trim()));if(alternate)spec=String(alternate[1].value).trim();}
   const q=r.cells[m.quantity],unit=String(val(r,m.unit)).trim(),hasQuantity=q&&(typeof q.value==='number'||q.formula);
   const pavementLabel=Object.entries(r.cells).filter(([c,v])=>colIndex(c)>colIndex(m.name)&&colIndex(c)<colIndex(m.quantity)&&/^(아스팔트|아스콘|콘크리트)$/.test(String(v.value).trim())&&!v.formula)[0]?.[1].value;
   if(name){m.pending=null;if((!hasQuantity&&/깨기|절단|철거|포설|포장|터파기|되메우기|다짐/.test(name))||(/깨기|절단/.test(name)&&pavementLabel))m.pending={name,spec:pavementLabel===spec?'':spec,nameRef};
    if(pavementLabel&&/깨기|절단/.test(name)){if(!name.includes(pavementLabel))name=pavementLabel+name;if(spec===pavementLabel)spec='';}}
   else if(m.pending&&hasQuantity&&unit){
    // Split quantity forms put the operation on a heading and the material,
    // formula and quantity on following rows. A parent with its own total never
    // enters this branch, so its detail rows are not counted a second time.
    const label=pavementLabel||Object.entries(r.cells).filter(([c,v])=>colIndex(c)>colIndex(m.spec||m.name)&&colIndex(c)<colIndex(m.quantity)&&/^[가-힣]/.test(String(v.value).trim())&&!v.formula).sort((a,b)=>colIndex(a[0])-colIndex(b[0]))[0]?.[1].value;
    if(label){name=m.pending.name.includes(String(label).trim())?m.pending.name:String(label).trim()+m.pending.name;spec=m.pending.spec;nameRef=m.pending.nameRef;}
   }
   if(!name||/^(공\s*종|품\s*목|합계|소계)$/.test(name)||!q||(typeof q.value!=='number'&&!q.formula))continue;
   const group=m.currentGroup||'미분류',bucket=/관급/.test(group)?'government':/폐기물처리/.test(group)?'waste':/수수료|부담금/.test(group)?'fees':'direct';
   const quantity=typeof q.value==='number'?cleanNumber(q.value):null;
   const specCell=r.cells[m.spec],specError=specCell?.formula&&!specCell.cached&&!specCell.calculated?specCell.calculationError||'규격 수식 미계산':'';
   result.push({id:crypto.randomUUID(),group,name,spec,unit,qty:quantity,sourceQty:quantity,source:`${sheet.name}!${nameRef} / ${q.ref}`,formula:q.formula,cached:q.cached,quantityCalculated:!!q.calculated,quantityError:quantity===null?q.calculationError||'수량 수식 미계산':'',specFormula:specCell?.formula||'',specError,rate:null,status:'unmatched',bucket,factor:1,exclude:q.value===0,note:quantity===null?'수량 수식을 계산하지 못했습니다: '+(q.calculationError||'저장 계산값 없음')+'. 원본 수식 또는 수량을 확인하세요.':specError?'규격 수식 확인 필요: '+specError:''});
  }
 }
 result.sort((a,b)=>{const an=parseInt(a.group)||99,bn=parseInt(b.group)||99;return an-bn;});
 return {rows:attachQuantityContracts(sheet,result),title,location,workConnectionJoints:workConnectionJoints(sheet.workConnectionJoints)};
}
const xml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,'');
function col(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
export function buildXlsx(sheets){
 const base='http://schemas.openxmlformats.org/spreadsheetml/2006/main',entries={};
 entries['[Content_Types].xml']=`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
 entries['_rels/.rels']='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
 entries['xl/workbook.xml']=`<workbook xmlns="${base}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xml(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets><definedNames>${sheets.filter(s=>s.professional).map(s=>`<definedName name="_xlnm.Print_Titles" localSheetId="${sheets.indexOf(s)}">${xml("'"+s.name.replaceAll("'","''")+"'!$3:$"+(s.headerRows||3))}</definedName>`).join('')}</definedNames><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`;
 entries['xl/_rels/workbook.xml.rels']=`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
 entries['xl/styles.xml']=`<styleSheet xmlns="${base}"><numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.########"/><numFmt numFmtId="165" formatCode="#,##0;[Red](#,##0);-"/></numFmts><fonts count="3"><font><sz val="11"/><name val="맑은 고딕"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="맑은 고딕"/></font><font><b/><sz val="16"/><name val="맑은 고딕"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF163C38"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF444444"/></left><right style="thin"><color rgb="FF444444"/></right><top style="thin"><color rgb="FF444444"/></top><bottom style="thin"><color rgb="FF444444"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="10"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="0" xfId="0" applyFill="1" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf><xf fontId="2" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="3" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="right" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 sheets.forEach((s,i)=>{entries[`xl/worksheets/sheet${i+1}.xml`]=`<worksheet xmlns="${base}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews><sheetView workbookViewId="0"><pane ySplit="${s.freeze||3}" topLeftCell="A${(s.freeze||3)+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${(s.widths||[8,20,30,30,10,12,16,16,16,16,16,16,40]).map((w,j)=>`<col min="${j+1}" max="${j+1}" width="${w}" customWidth="1"/>`).join('')}</cols><sheetData>${s.rows.map((r,ri)=>`<row r="${ri+1}" ht="${s.professional?(ri===0?34:ri<(s.headerRows||3)?24:30):22}" customHeight="1">${r.map((c,ci)=>{const ref=col(ci+1)+(ri+1),style=s.professional?(ri===0?8:ri<(s.headerRows||3)?5:typeof c==='number'||c?.formula?(s.decimalColumns?.includes(ci)||!Number.isInteger(c?.value??c)?7:9):[0,3,4].includes(ci)?5:6):null;if(c&&typeof c==='object'&&'formula'in c)return `<c r="${ref}" s="${style??3}"><f>${xml(c.formula)}</f><v>${Number.isFinite(c.value)?c.value:0}</v></c>`;if(typeof c==='number')return `<c r="${ref}" s="${style??(Number.isInteger(c)?4:2)}"><v>${c}</v></c>`;return `<c r="${ref}" t="inlineStr" s="${style??(ri===2?1:0)}"><is><t xml:space="preserve">${xml(c)}</t></is></c>`;}).join('')}</row>`).join('')}</sheetData>${s.merges?.length?`<mergeCells count="${s.merges.length}">${s.merges.map(r=>`<mergeCell ref="${xml(r)}"/>`).join('')}</mergeCells>`:''}<pageMargins left="0.25" right="0.25" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="${s.orientation||'landscape'}" fitToWidth="1" fitToHeight="0" useFirstPageNumber="1" firstPageNumber="${s.startPage||1}"/><headerFooter><oddFooter>&amp;C&amp;P / &amp;N</oddFooter></headerFooter></worksheet>`;});
 return zipStore(entries);
}
export function exportEstimate(project,options={}){
 project=synchronizeLinkedCosts(project);
 const bidNote=project.lines.some(l=>l.rate?.evidenceBid)?'근거자료 낙찰 적용 · 비목 단가는 근거 낙찰 후 값, 내역률 100%':project.lines.some(l=>!l.level&&bidPercent(l)!==100)?'낙찰률 적용 · 내역별 낙찰률과 계산 방식 참조':'낙찰률 미적용';
 const lines=project.lines.filter(l=>!l.exclude),sum=totals(lines,project.charges);if(sum.warnings?.length)throw Error(sum.warnings.join(' '));const rows=[[project.title||'설계내역서'],['위치',project.location||'','산정 기준','비목별 금액 원 미만 절사 · '+bidNote],['번호','공종','품명','규격','단위','수량','원 노무 단가','원 재료 단가','원 경비 단가','원 기타 단가','환산계수','금액','근거 / 확인 사항','계상 구분','확정(1)','노무 금액','재료 금액','경비 금액','기타 금액','낙찰률(%)','낙찰 계산','집계 포함(1)','계산 방식']];
 const formula=(formula,value)=>({formula,value});
 const hierarchy=hierarchyTotals(lines);
 lines.forEach((l,i)=>{if(l.level){let end=i+1;while(end<lines.length&&!(lines[end].level>=l.level))end++;const total=hierarchy.get(l.id),r=rows.length+1,expression=end>i+1?`SUMIFS(L${r+1}:L${end+3},N${r+1}:N${end+3},"${l.headingScope==='direct'?'direct':'<>heading'}",V${r+1}:V${end+3},1)`:'0';rows.push(['L'+l.level,l.group,l.name,'','','','','','','','',formula(expression,total.total),`공종 집계 · 미확정 ${total.missing}건`,'heading',0]);return;}const a=amount(l),r=rows.length+1;rows.push([i+1,l.group,l.name,l.spec,l.unit,l.qty,l.rate?.labor??'',l.rate?.material??'',l.rate?.expense??'',l.rate?.other??'',l.factor??1,a?formula(`IF(O${r}=1,SUM(P${r}:S${r}),"수량 확인")`,a.total):'미연결',`${l.rate?l.rate.source+' / '+l.rate.code:'단가 확인 필요'} | ${l.source||'직접 입력'} ${l.note||''}${l.rate?.evidenceBid?' | 근거 낙찰 '+l.rate.evidenceBid.percent+'%':''}`,l.bucket||'direct',a?manualCalculation(l)?1:formula(`IF(AND(COUNT(F${r},K${r},G${r}:J${r})=6,${l.deduction?'TRUE':`F${r}>=0`},K${r}>0,ISNUMBER(T${r}),T${r}>=0,T${r}<=100,OR(U${r}="단가",U${r}="금액")),1,0)`,1):0,...['G','H','I','J'].map((c,i)=>manualCalculation(l)?a?.[['labor','material','expense','other'][i]]??0:formula(`IF(O${r}=1,TRUNC(ROUND(F${r}*K${r}*IF(U${r}="금액",${c}${r}*T${r}/100,IF(T${r}=100,${c}${r},TRUNC(ROUND(${c}${r}*T${r}/100,8),0))),8),0),0)`,a?a[['labor','material','expense','other'][i]]:0)),bidPercent(l),l.bidMethod==='amount'?'금액':'단가',aggregateCalculation(l)?1:0,calculationModes[l.calculationMode||'auto']]);});
 // Percent rows reference the actual preceding source amounts, not frozen DB prices.
 for(const [i,l] of lines.entries())if(l.surcharge){const r=i+4,s=l.surcharge,target={labor:6,material:7,expense:8,other:9}[s.target],basis={labor:'P',material:'Q',expense:'R',other:'S',total:'L'}[s.basis],sourceRows=s.resolvedSourceIds.map(id=>lines.findIndex(x=>x.id===id)+4);
  if(s.kpAllowance){const n=sourceRows[0],q=s.kpAllowance.quantity;for(const [col,key,c] of [[6,'labor','G'],[7,'material','H'],[8,'expense','I'],[9,'other','J']])rows[r-1][col]=formula(`TRUNC(ROUND(${q}*K${n}*IF(U${n}="금액",${c}${n}*T${n}/100,IF(T${n}=100,${c}${n},TRUNC(ROUND(${c}${n}*T${n}/100,8),0))),8),0)`,l.rate[key]);}
  else{const expression=sourceRows.map(n=>`IF(AND(V${n}=1,N${n}="direct"),${basis}${n},0)`).join('+')||'0';rows[r-1][target]=formula(expression,l.rate?.[s.target]||0);}
  const own=rows[r-1][14]?.formula||'0';rows[r-1][14]=formula(sourceRows.length?`IF(AND((${own})=1,${sourceRows.map(n=>`O${n}=1`).join(',')}),1,0)`:'0',amount(l)?1:0);
 }
 const end=Math.max(4,rows.length);for(const [i,l] of lines.entries())if(l.generatedProcurement?.auto){const r=i+4,v=l.generatedProcurement,g=`SUMIFS(L4:L${end},N4:N${end},"government",V4:V${end},1)`,unit=10**v.digits,value=l.rate.expense;rows[r-1][8]=formula(`ROUNDUP(((${g})+TRUNC(ROUND((${g})*${v.rate}/100,8),0))/${unit},0)*${unit}-(${g})`,value);}
 const range=c=>`'설계내역서'!${c}4:${c}${end}`;
 const component=c=>`SUMIFS(${range({G:'P',H:'Q',I:'R',J:'S'}[c])},${range('N')},"direct",${range('O')},1,${range('V')},1)`;
 const bucket=b=>`SUMIFS(${range('L')},${range('N')},"${b}",${range('V')},1)`;
 const summary=[[project.title||'공사비 산정'],['미연결·수량 확인 항목',formula(`COUNTIFS(${range('N')},"<>heading",${range('O')},0,${range('V')},1)`,sum.missing)],['구분','적용 기준','요율(%) / 정액','금액(원)'],['직접노무비','확정 내역 합계','',formula(component('G'),sum.labor)],['직접재료비','확정 내역 합계','',formula(component('H'),sum.material)],['직접경비','확정 내역 합계','',formula(component('I'),sum.expense)],['기타','단가 잔액','',formula(component('J'),sum.other)],['직접공사비','관급·별도비 제외','',formula('SUM(D4:D7)',sum.direct)]];
 const chargeRows=new Map(),wasteRow=9+sum.charges.length;
 for(const c of sum.charges){const r=summary.length+1,previous=r>9?`SUM(D9:D${r-1})`:'0',indirect=chargeRows.has('indirect')?`D${chargeRows.get('indirect')}`:'0',health=chargeRows.has('health')?`D${chargeRows.get('health')}`:'0';
  const refs={labor:'D4',totalLabor:`D4+${indirect}`,laborMaterial:'D4+D5',totalLaborMaterial:`D4+D5+${indirect}`,health,direct:'D8',net:`D8+${previous}`,profitBase:`D4+D6+D7+${previous}`,contractBeforeVat:`D8+${previous}+D${wasteRow}`,government:bucket('government')};
  let expression=c.base==='fixed'?`TRUNC(C${r},0)`:`TRUNC(ROUND((${refs[c.base]||'0'})*C${r}*0.01,8),0)`;if(c.link?.type==='safety'){const v=c.link,b=refs[v.basis],g=`TRUNC(ROUND((${bucket('government')})*${v.governmentPercent}/100,8),0)`;expression=`MIN(TRUNC(ROUND(((${b})+${g})*${v.rate}/100,8),0)+${v.addition},TRUNC(ROUND((TRUNC(ROUND((${b})*${v.rate}/100,8),0)+${v.addition})*(1+${v.surcharge}/100),8),0))`;}if(c.link?.type==='target'){const v=c.link,cap=v.maximum.base==='fixed'?String(v.maximum.fixed||0):`TRUNC(ROUND((${refs[v.maximum.base]||'0'})*${v.maximum.rate}/100,8),0)`,vat=sum.charges.find(x=>x.key==='vat')?.rate||0;expression=`MIN(${cap},MAX(0,ROUNDUP((${v.target}+1)/(1+${vat}/100),0)-1-(D8+D${wasteRow}+${previous})))`;}
  if(c.formula){const codeMap={'1':'0','2':'D5','3':'0',A:'D5','4':'D4','6':'D6+D7',B:`D4+${indirect}`,C:`D6+D7+${sum.charges.slice(0,chargeRows.size).filter(x=>!['indirect','management','profit','vat'].includes(x.key)).map(x=>'D'+chargeRows.get(x.key)).join('+')||'0'}`,D:`D8+${previous}`,E:chargeRows.has('management')?'D'+chargeRows.get('management'):'0',F:chargeRows.has('profit')?'D'+chargeRows.get('profit'):'0',G:`D8+${previous}`,H:bucket('waste'),K:c.contractorFormulaRefs?.K??bucket('government'),L:c.contractorFormulaRefs?.L??bucket('fees'),R:`C${r}/100`};chargeCodes(sum.charges).forEach((code,j)=>{const entry=sum.charges[j];if(chargeRows.has(entry.key))codeMap[code]='D'+chargeRows.get(entry.key);});expression=`TRUNC(ROUND(${translateCostFormula(c.formula,k=>codeMap[k])},8),0)`;}
  summary.push([c.name,c.link?'자동 연동':chargeBaseLabels[c.base]||c.base,c.formula?c.rate:c.base==='fixed'?c.fixed||0:c.rate,formula(expression,c.amount)]);chargeRows.set(c.key,r);
 }
 summary.push(['폐기물처리비','별도 계상','',formula(bucket('waste'),sum.waste)],['도급 산정액','제경비·부가세 포함','',formula(`D8+SUM(D9:D${wasteRow})`,sum.contract)],['관급자재대','도급 외','',formula(bucket('government'),sum.government)],['수수료·부담금','도급 외','',formula(bucket('fees'),sum.fees)],['총 산정액',bidNote,'',formula(`SUM(D${wasteRow+1}:D${wasteRow+3})`,sum.grand)],['확인','요율과 적용 기준은 사용자가 확인합니다.'],['단가 갱신','구성 편집으로 저장한 단가는 재계산 결과이며, 원본 단가는 저장값입니다.']);
 for(const c of sum.charges)if(c.comparison)summary.push([c.name+' · 비교 근거(합산 제외)'],...safetyDetails(c));
 const groups=[...new Set(lines.filter(l=>!l.level).map(l=>l.group))];
 const groupRows=[[project.title||'공종별 집계표'],['금액 기준','확정 항목 · '+bidNote],['공종','노무비','재료비','경비','기타','합계','미확정']];
 if(lines.some(l=>l.level)){
  for(const [i,l] of lines.entries()){if(!l.level)continue;let end=i+1;while(end<lines.length&&!(lines[end].level>=l.level))end++;const first=i+5,last=end+3,h=hierarchy.get(l.id),scope=l.headingScope==='direct'?'direct':'<>heading';
   const headingSum=c=>end>i+1?`SUMIFS('설계내역서'!${c}${first}:${c}${last},'설계내역서'!N${first}:N${last},"${scope}",'설계내역서'!V${first}:V${last},1)`:'0';
   groupRows.push(['L'+l.level+' '+l.name,...['P','Q','R','S'].map((c,j)=>formula(headingSum(c),h[['labor','material','expense','other'][j]])),formula(headingSum('L'),h.total),h.missing]);
  }
 }

 if(!lines.some(l=>l.level))for(const g of groups){const subset=lines.filter(l=>l.group===g&&!l.level),s=totals(subset,[]),values=subset.filter(aggregateCalculation).map(amount).filter(Boolean),criteria='"'+String(g).replace(/"/g,'""')+'"';const componentForGroup=c=>`SUMIFS(${range({G:'P',H:'Q',I:'R',J:'S'}[c])},${range('B')},${criteria},${range('N')},"<>heading",${range('O')},1,${range('V')},1)`;groupRows.push([g,...['G','H','I','J'].map((c,i)=>formula(componentForGroup(c),values.reduce((n,v)=>n+v[['labor','material','expense','other'][i]],0))),formula(`SUMIFS(${range('L')},${range('B')},${criteria},${range('N')},"<>heading",${range('V')},1)`,s.direct+s.government+s.waste+s.fees),formula(`COUNTIFS(${range('B')},${criteria},${range('N')},"<>heading",${range('O')},0,${range('V')},1)`,s.missing)]);}
 const quoteRows=[[project.title||'조사단가 비교표'],['확인','조사값 및 적용 설정을 보존한 기록입니다.'],['코드','품명','항목 / 출처','가격 / 설정','페이지 · 근거','선택']];
 const quoteRates=new Map([...(project.evidence||[]).map(e=>e.rate),...lines.map(l=>l.rate).filter(Boolean)].filter(r=>r.quoteMethod).map(r=>[r.id||JSON.stringify([r.source,r.code]),r]));
 for(const rate of quoteRates.values())for(const row of quoteDetails(rate))quoteRows.push([rate.code,rate.name,...row]);
 const rates=[[project.title||'적용 단가 목록'],['확인','파일에 저장된 단가 또는 사용자가 만든 단가'],['코드','품명','규격','단위','노무 단가','재료 단가','경비 단가','기타 단가','합계 단가','자료 파일']];
 const evidenceRows=[[project.title||'단가 산출근거'],['확인','EST는 원본의 저장 산출근거이며 내부 산식 재계산 결과가 아닙니다.'],['상위 코드','구성 코드','품명 / 산식 원문','규격','단위','수량','합계 단가','합계 금액','노무 금액','재료 금액','경비 금액','비고']];
 for(const {rate,rows:detail} of project.evidence||[]){rates.push([rate.code,rate.name,rate.spec,rate.unit,rate.labor,rate.material,rate.expense,rate.other,rate.total,rate.source]);
  if(rate.components){const calc=calculateAssemblyDetailed(rate.components,rate.calculation||{});
   evidenceRows.push([rate.code,'',rate.name,rate.spec,rate.unit,'산출 기준 수량',calc.divisor,calc.result.total,calc.result.labor,calc.result.material,calc.result.expense,rate.calculation?.expenseOnly?'경비성 단가':'단위당 결과']);
   for(const v of calc.variables)evidenceRows.push([rate.code,v.name,v.expression,'','',v.value,'','','','','','변수 계산']);
   for(const p of calc.rows)evidenceRows.push([rate.code,p.code||p.kind,p.name,p.spec,p.unit,p.qtyExpression||p.qty,p.kind==='percent'?`${p.scope} / ${p.basis} / ${p.percent}%`:p.total,p.amount.total,p.amount.labor,p.amount.material,p.amount.expense,`${p.kind==='subtotal'?'표시 소계 · 합산 제외':!aggregateCalculation(p)?'합산 제외 · 기준금액용':manualCalculation(p)?'직접 입력 금액':'합산'} / 단락 ${p.section||'1'} / 색인 ${p.sumTag||''}`]);
  }
  else for(const r of detail||[])evidenceRows.push([rate.code,r.Code,r.Name||r.LineData||'',r.Size,r.Unite,r.GN,r.TU,r.TC,r.NC,r.GC,r.JC,r.Bigo]);
 }
 const sheets=[{name:'설계내역서',rows,widths:[8,20,30,30,10,12,16,16,16,16,16,16,40,14,12,16,16,16,16,14,14,14,22]},{name:'원가계산서',rows:summary,widths:[30,44,18,22]},{name:'공종별 집계표',rows:groupRows,widths:[30,18,18,18,18,20,12]},{name:'적용 단가 목록',rows:rates,widths:[20,32,38,10,16,16,16,16,18,58]},{name:'단가 산출근거',rows:evidenceRows,widths:[20,20,60,30,10,15,18,18,18,18,18,30]},{name:'조사단가 비교표',rows:quoteRows,widths:[20,32,32,40,32,10]}];return options.sheets?sheets:buildXlsx(sheets);
}
