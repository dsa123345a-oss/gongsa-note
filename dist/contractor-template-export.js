import {translateCostFormula,chargeCodes} from './cost-formula.js';
import {contractorTemplates} from './contractor-templates.js';
import {writeTemplateWorkbook} from './template-workbook.js';
import {amount,appliedRate,bidPercent,totals,synchronizeLinkedCosts,norm} from './calc.js';
import {buildPriceEvidence} from './price-evidence-workbook.js';
import {aggregateCalculation,manualCalculation} from './calculation-modes.js';
import {prepareContractor} from './workflow-core.js';
const f=(formula,value)=>({formula,value}),sum=(refs)=>refs.length?`SUM(${refs.join(',')})`:'0';
const keys={간접노무비:'indirect',산재보험료:'industrial',고용보험료:'employment',건강보험료:'health',연금보험료:'pension',노인장기요양보험료:'longTermCare',퇴직공제부금비:'retirement',건설기계대여금지급보증서발급액:'equipmentGuarantee',산업안전보건관리비:'safety',환경보전비:'environment',공사이행보증수수료:'performanceGuarantee',하도급대금지급보증수수료:'subcontractGuarantee',석면분담금:'asbestos',임금채권부담금:'wageClaim',기타경비:'other',일반관리비:'management',이윤:'profit',부가가치세:'vat'};
export const contractorTemplateKind=p=>['new','emergency'].includes(p.contractorTemplate)?p.contractorTemplate:/긴급|보수/.test(p.title||'')?'emergency':'new';
export function contractorTemplateSheets(input,{libraries=[],includeEvidence=false}={}){
 const p=synchronizeLinkedCosts(input),t=totals(p.lines,p.charges);if(t.missing)throw Error('미확정 내역을 연결한 뒤 업체용 엑셀을 만드세요.');
 const template=contractorTemplates[contractorTemplateKind(p)],sheets=structuredClone(template.sheets);for(const s of sheets)s.rows=structuredClone(s.header);
 const [cost,summary,detail]=sheets;
 const rateWidth=Math.max(Number(cost.columns[6]?.width)||0,13),extraWidth=rateWidth-cost.columns[6].width;
 cost.columns[6]={...cost.columns[6],width:rateWidth};
 cost.columns[7]={...cost.columns[7],width:cost.columns[7].width-extraWidth};
 const items=p.lines.filter(l=>!l.exclude&&!['government','fees'].includes(l.bucket));
 const add=(sheet,values,style=sheet.detail)=>{const row={...structuredClone(style),values};sheet.rows.push(row);return sheet.rows.length;};
 let ordered=items.filter(l=>l.level||(l.bucket||'direct')==='direct');
 ordered=ordered.filter((l,i,a)=>{if(!l.level)return true;let e=i+1;while(e<a.length&&!(a[e].level>=l.level))e++;return a.slice(i+1,e).some(x=>!x.level);});
 if(!ordered.some(l=>l.level)){const groups=[...new Set(ordered.map(l=>l.group))];ordered=groups.flatMap(g=>[{level:1,name:g,group:g},...ordered.filter(l=>l.group===g)]);}
 if(!ordered.some(l=>l.level>=2))ordered.unshift({id:'export-root',level:2,name:p.title,spec:p.location,headingScope:'direct'});
 const records=[],headings=[],lineRows=new Map();let section=0;
 for(const [index,line] of ordered.entries()){
  if(line.level){if(line.level>=2)section++;const values=Array(15).fill('');values[1]=contractorTemplateKind(p)==='emergency'&&line.level===2?`${section}공구`:'';values[2]=line.name;values[3]=line.spec||(line.level>=2&&section===1&&contractorTemplateKind(p)==='new'?p.location:'')||'';const row=add(detail,values,line.level>=2?detail.root:detail.heading);headings.push({line,index,row,values});continue;}
  const row=addLine(line);records.push({line,row,index});
 }
 function addLine(line){
  const a=amount(line),r=appliedRate(line),row=detail.rows.length+1,values=Array(15).fill('');if(!a)throw Error(line.name+'의 금액을 확인하세요.');
  values[2]=line.name;values[3]=line.spec||'';values[4]=line.surcharge?line.qty:(line.qty??0)*(line.factor??1);values[5]=line.unit;
  values[8]=r.labor;values[10]=r.material;values[12]=r.expense+r.other;values[6]=f(`SUM(I${row},K${row},M${row})`,r.total);
  const qty=line.surcharge?`E${row}/100`:`E${row}`;
  const mul=(col,key)=>manualCalculation(line)?a[key]:f(`TRUNC(ROUND((${qty})*${col}${row},8),0)`,a[key]);
  values[9]=mul('I','labor');values[11]=mul('K','material');
  values[13]=manualCalculation(line)?a.expense+a.other:r.other?f(`TRUNC(ROUND((${qty})*(M${row}-(${r.other})),8),0)+TRUNC(ROUND((${qty})*(${r.other}),8),0)`,a.expense+a.other):mul('M','expense');
  values[7]=f(`SUM(J${row},L${row},N${row})`,a.total);
  values[14]=!aggregateCalculation(line)?'집계 제외':manualCalculation(line)?'직접 금액':'';
  add(detail,values);lineRows.set(line.id,row);return row;
 }
 // Percent row bases reference the selected source amounts, not frozen DB values.
 for(const {line,row} of records)if(line.surcharge){const s=line.surcharge,basis={labor:'J',material:'L',expense:'N',other:'N',total:'H'}[s.basis],refs=s.resolvedSourceIds.map(id=>{const n=lineRows.get(id);if(!n)throw Error('할증 기준 행이 출력 내역에 없습니다.');return `${basis}${n}`;});
  if(s.kpAllowance){
   const n=lineRows.get(s.resolvedSourceIds[0]),source=records.find(x=>x.line.id===s.resolvedSourceIds[0]).line,q=s.kpAllowance.quantity*(source.factor??1),other=appliedRate(source).other||0;
   for(const [col,src,key] of [[8,'I','labor'],[10,'K','material'],[12,'M','expense']]){
    const formula=key==='expense'&&other?`TRUNC(ROUND(${q}*(${src}${n}-(${other})),8),0)+TRUNC(ROUND(${q}*(${other}),8),0)`:`TRUNC(ROUND(${q}*${src}${n},8),0)`;
    detail.rows[row-1].values[col]=f(formula,line.rate[key]+(key==='expense'?line.rate.other||0:0));
   }continue;
  }
  // Expense and other share a printed column; retain their separate contributions.
  const parts=s.resolvedSourceIds.map(id=>records.find(x=>x.line.id===id)).map(x=>{if(!['expense','other'].includes(s.basis))return null;if(manualCalculation(x.line))return String(amount(x.line)[s.basis]);const other=appliedRate(x.line).other||0,q=x.line.surcharge?`E${x.row}/100`:`E${x.row}`,otherAmount=`TRUNC(ROUND((${q})*(${other}),8),0)`;return s.basis==='other'?otherAmount:`(N${x.row}-(${otherAmount}))`;});
  const expression=['expense','other'].includes(s.basis)?parts.join('+')||'0':sum(refs),col={labor:8,material:10,expense:12,other:12}[s.target];detail.rows[row-1].values[col]=f(expression,s.baseValue);
 }
 const included=records.filter(x=>aggregateCalculation(x.line));
 const totalOf=(list,key)=>list.reduce((n,x)=>n+amount(x.line)[key],0);
 for(const h of headings){let end=ordered.length;for(let j=h.index+1;j<ordered.length;j++)if(ordered[j].level>=h.line.level){end=j;break;}const list=included.filter(x=>x.index>h.index&&x.index<end);
  for(const [c,key] of [[7,'total'],[9,'labor'],[11,'material'],[13,'expense']])h.values[c]=f(sum(list.map(x=>`${{7:'H',9:'J',11:'L',13:'N'}[c]}${x.row}`)),totalOf(list,key)+(key==='expense'?totalOf(list,'other'):0));
  const values=Array(11).fill('');values[1]=h.values[1];values[2]=h.line.name;values[3]=h.values[3];for(const [c,src] of [[6,7],[7,9],[8,11],[9,13]])values[c]=f(`'내역서'!${{7:'H',9:'J',11:'L',13:'N'}[src]}${h.row}`,h.values[src].value);add(summary,values,h.line.level>=2?summary.root:summary.heading);
 }
 // Populate the fixed cost form. New custom charges extend its expense block.
 const body=structuredClone(cost.body),used=new Set();
 for(const row of body){const code=String(row.values[4]),key=keys[norm(row.values[3])];if(key){row.chargeIndex=t.charges.findIndex(c=>c.key===key);if(row.chargeIndex>=0)used.add(row.chargeIndex);}row.code=code;}
 const extra=t.charges.map((c,i)=>({c,i})).filter(x=>!used.has(x.i));
 for(const {c,i} of extra){const other=body.find(r=>r.chargeIndex>=0&&t.charges[r.chargeIndex].key==='other'),base=structuredClone(other||body.find(r=>r.chargeIndex>=0));base.values[1]='';base.values[2]='';base.values[3]=c.name;base.values[4]='';base.code='custom:'+i;base.chargeIndex=i;body.splice(other?body.indexOf(other):body.findIndex(r=>r.code==='C'),0,base);}
 let expenseNumber=6;for(const row of body){if(row.code==='C')break;if(row.code==='6'||expenseNumber>6)row.values[4]=expenseNumber++;}
 const codeRows=new Map(),chargeRows=new Map();
 for(const row of body){const n=add(cost,row.values,row);codeRows.set(row.code,n);if(row.chargeIndex>=0)chargeRows.set(row.chargeIndex,n);}
 const F=code=>`F${codeRows.get(code)}`,charges=idx=>sum(idx.map(i=>`F${chargeRows.get(i)}`)),ids=key=>t.charges.flatMap((c,i)=>c.key===key?[i]:[]);
 const part=(column,list=included)=>sum(list.map(x=>`'내역서'!${column}${x.row}`));
 const set=(code,formula,value)=>{const n=codeRows.get(code);if(n)cost.rows[n-1].values[5]=f(formula,value);};
 const waste=items.filter(l=>!l.level&&l.bucket==='waste'),wasteRows=[];
 // Detail total/charge footer follows the EST form; separate waste follows it.
 add(detail,Array(15).fill(''));
 const directFooter=add(detail,Array(15).fill(''),detail.total);detail.rows[directFooter-1].values[2]='순 공 사 비';
 for(const [ci,column,key] of [[7,'H','direct'],[9,'J','labor'],[11,'L','material'],[13,'N','expense']])detail.rows[directFooter-1].values[ci]=f(sum(included.map(x=>column+x.row)),t[key]+(key==='expense'?t.other:0));
 const summaryDirect=Array(11).fill('');summaryDirect[2]='순 공 사 비';for(const [ci,col,key] of [[6,'H','direct'],[7,'J','labor'],[8,'L','material'],[9,'N','expense']])summaryDirect[ci]=f(`'내역서'!${col}${directFooter}`,t[key]+(key==='expense'?t.other:0));add(summary,summaryDirect,summary.total);
 const expenseIds=t.charges.flatMap((c,i)=>!['indirect','management','profit','vat'].includes(c.key)?[i]:[]);
 set('2',part('L'),t.material);set('A',`SUM(${F('1')}:${F('3')})`,t.material);set('4',part('J'),t.labor);set('B',`${F('4')}+${charges(ids('indirect'))}`,t.labor+ids('indirect').reduce((n,i)=>n+t.charges[i].amount,0));set('6',part('N'),t.expense+t.other);
 const netValue=t.direct+t.charges.filter(c=>!['management','profit','vat'].includes(c.key)).reduce((n,c)=>n+c.amount,0);
 set('C',`${F('6')}+${charges(expenseIds)}`,t.expense+t.other+expenseIds.reduce((n,i)=>n+t.charges[i].amount,0));set('D',`${F('A')}+${F('B')}+${F('C')}`,netValue);
 const totalBeforeVat=netValue+[...ids('management'),...ids('profit')].reduce((n,i)=>n+t.charges[i].amount,0);
 set('G',`${F('D')}+${charges([...ids('management'),...ids('profit')])}`,totalBeforeVat);set('J',`${F('G')}+${F('H')}+${charges(ids('vat'))}`,t.contract);set('K',F('J'),t.contract);
 for(const [i,c] of t.charges.entries()){
  const row=cost.rows[chargeRows.get(i)-1],previous=charges(t.charges.slice(0,i).map((_,j)=>j)),indirect=charges(ids('indirect').filter(j=>j<i)),health=charges(ids('health').filter(j=>j<i)),direct=`(${F('A')}+${F('4')}+${F('6')})`;
  const bases={labor:F('4'),totalLabor:`${F('4')}+${indirect}`,laborMaterial:`${F('4')}+${F('A')}`,totalLaborMaterial:`${F('4')}+${indirect}+${F('A')}`,health,direct,net:`${direct}+${previous}`,profitBase:`${F('4')}+${F('6')}+${previous}`,contractBeforeVat:`${direct}+${previous}+${F('H')}`,government:'0'};
  if(c.formula){const refs=Object.fromEntries([...codeRows].map(([code,n])=>[code,`F${n}`]));chargeCodes(t.charges).forEach((code,j)=>refs[code]=`F${chargeRows.get(j)}`);refs.R=`G${chargeRows.get(i)}`;refs.K=String(c.contractorFormulaRefs?.K??t.government);refs.L=String(c.contractorFormulaRefs?.L??t.fees);row.values[5]=f(`TRUNC(ROUND(${translateCostFormula(c.formula,k=>refs[k])},8),0)`,c.amount);row.values[6]=c.rate/100;row.percentFormat='0.######%';row.values[7]=c.formula;}
  else if(c.base==='fixed'){row.values[5]=c.amount;row.values[6]='';row.values[7]=c.amount?'정액':'';
   if(c.key==='profit'&&c.adjustment?.original?.base==='profitBase'){const baseValue=t.labor+t.expense+t.other+t.charges.slice(0,i).reduce((n,x)=>n+x.amount,0);row.values[6]=f(`IFERROR(F${chargeRows.get(i)}/(${bases.profitBase}),0)`,baseValue?c.amount/baseValue:0);row.percentFormat='0.00%';row.values[7]='(B + C + E) · 자리맞춤';}
  }
  else {row.values[5]=f(`TRUNC(ROUND((${bases[c.base]||'0'})*G${chargeRows.get(i)},8),0)`,c.amount);row.values[6]=c.rate?c.rate/100:'';row.percentFormat='0'+(String(c.rate).includes('.')?'.'+'0'.repeat(String(c.rate).split('.')[1].length):'')+'%';row.values[7]=c.rate?({labor:'4',totalLabor:'B',laborMaterial:'(A + 4)',totalLaborMaterial:'(A + B)',health:'9',direct:'(A + 4 + 6)',net:'D',profitBase:'(B + C + E)',contractBeforeVat:'(G + H)',government:'관급자재'}[c.base]||'기준금액')+' × '+c.rate/100:'';}
 }
 for(const code of ['A','B','C','D','G','J','K']){const n=codeRows.get(code);cost.rows[n-1].values[7]=({A:'(1 + 2 + 3 )',B:'( 4 + 5 )',C:`(6:${expenseNumber-1})`,D:'(A + B + C)',G:'(D + E + F)',J:'(G + H + I)',K:'(J)'})[code];}
 const footer=[...ids('indirect'),...expenseIds].filter(i=>t.charges[i].amount!==0).map(i=>({i}));footer.push({code:'D',name:'순공사원가'},...ids('management').map(i=>({i})),...ids('profit').map(i=>({i})),{code:'G',name:'총원가'},{code:'J',name:'도급예정액'},{code:'K',name:'총공사비'});
 for(const entry of footer){const n=entry.i!==undefined?chargeRows.get(entry.i):codeRows.get(entry.code),c=entry.i!==undefined?t.charges[entry.i]:null,cell=cost.rows[n-1].values[5],value=typeof cell==='object'?cell.value:cell||0;
  for(const sheet of [detail,summary]){const values=Array(sheet===detail?15:11).fill('');values[2]=c?.name||entry.name;values[sheet===detail?7:6]=f(`'원가계산서'!F${n}`,value);if(c&&(c.formula||c.base!=='fixed')){values[4]=c.rate;values[5]='%';}else if(c?.adjustment?.original?.base==='profitBase'){values[4]=f(`ROUND('원가계산서'!G${n}*100,2)`,Number((cost.rows[n-1].values[6].value*100).toFixed(2)));values[5]='%';}add(sheet,values,sheet.footer?.[norm(values[2])]||sheet.detail);}
 }
 if(waste.length){add(detail,Array(15).fill(''));const wr=add(detail,Array(15).fill(''),detail.heading);detail.rows[wr-1].values[2]='폐기물처리비';for(const l of waste)wasteRows.push({line:l,row:addLine(l)});for(const [ci,column,key] of [[7,'H','total'],[9,'J','labor'],[11,'L','material'],[13,'N','expense']])detail.rows[wr-1].values[ci]=f(sum(wasteRows.filter(x=>aggregateCalculation(x.line)).map(x=>column+x.row)),totalOf(wasteRows.filter(x=>aggregateCalculation(x.line)),key)+(key==='expense'?totalOf(wasteRows,'other'):0));}
 set('H',part('H',wasteRows.filter(x=>aggregateCalculation(x.line))),t.waste);
 // The template used textual percentages; use numeric percentages with the same
 // font/borders, so edits remain calculable without altering its appearance.
 let styles=template.styles;const cellPart=styles.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/),cellXfs=[...cellPart[2].matchAll(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]);
 let nextFormat=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;const formats=new Map();
 const format=(row,col,code)=>{if(!formats.has(code))formats.set(code,nextFormat++);let modified=cellXfs[row.styles[col]].replace(/numFmtId="\d+"/,`numFmtId="${formats.get(code)}"`);if(col===6)modified=modified.replace(/<alignment\b([^>]*?)\/>/,(_,attrs)=>`<alignment${attrs.replace(/ shrinkToFit="[^"]*"/g,'')} shrinkToFit="1"/>`);let id=cellXfs.indexOf(modified);if(id<0){id=cellXfs.length;cellXfs.push(modified);}row.styles[col]=id;};
 for(const row of cost.rows.slice(3)){if(row.percentFormat)format(row,6,row.percentFormat);format(row,5,'#,##0;-#,##0;;@');}
 for(const sheet of [summary,detail])for(const row of sheet.rows.slice(sheet===detail?4:3)){
  const qty=row.values[4]?.value??row.values[4];if(typeof qty==='number')format(row,4,Number.isInteger(qty)?'#,##0':'#,##0.0########');
  for(let c=6;c<(sheet===detail?14:10);c++){const value=row.values[c]?.value??row.values[c];format(row,c,typeof value==='number'&&!Number.isInteger(value)?'#,##0.0########;-#,##0.0########;;@':'#,##0;-#,##0;;@');}
 }
 styles=styles.replace(/<numFmts count="(\d+)">/,(_,n)=>`<numFmts count="${Number(n)+formats.size}">`+[...formats].map(([code,id])=>`<numFmt numFmtId="${id}" formatCode="${code}"/>`).join(''));
 styles=styles.replace(/<cellXfs count="\d+">[\s\S]*?<\/cellXfs>/,`<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>`);
 let evidence=null;
 if(includeEvidence){
  evidence=buildPriceEvidence(p,libraries,styles);styles=evidence.styles;
  const linkedOther=new Map();
  for(const {line,row} of [...records,...wasteRows]){
   const source=evidence.lineRefs.get(line.id);if(!source||manualCalculation(line))continue;
   const percent=bidPercent(line),r=appliedRate(line),a=amount(line),v=detail.rows[row-1].values;
   const refs=source.refs.map(ref=>percent===100?ref:line.bidMethod==='amount'?`(${ref})*${percent}/100`:`TRUNC(ROUND((${ref})*${percent}/100,8),0)`);
   v[8]=f(refs[0],r.labor);v[10]=f(refs[1],r.material);v[12]=f(`(${refs[2]})+(${refs[3]})`,r.expense+r.other);
   const other=`TRUNC(ROUND(E${row}*(${refs[3]}),8),0)`;linkedOther.set(line.id,other);
   v[13]=f(`TRUNC(ROUND(E${row}*(${refs[2]}),8),0)+${other}`,a.expense+a.other);
  }
  // Surcharges on other/expense must follow the edited basis as well.
  for(const {line,row} of records)if(line.surcharge&&['expense','other'].includes(line.surcharge.basis)){
   const s=line.surcharge,terms=s.resolvedSourceIds.map(id=>{const x=records.find(x=>x.line.id===id);if(manualCalculation(x.line))return String(amount(x.line)[s.basis]);const other=linkedOther.get(id)||`TRUNC(ROUND(E${x.row}${x.line.surcharge?'/100':''}*(${appliedRate(x.line).other||0}),8),0)`;return s.basis==='other'?other:`(N${x.row}-(${other}))`;});
   detail.rows[row-1].values[{labor:8,material:10,expense:12,other:12}[s.target]]=f(terms.join('+')||'0',s.baseValue);
  }
  sheets.push(...evidence.sheets);
 }
 return {sheets,styles,project:p,evidence};
}
export function exportTemplateContractor(project,options={}){const output=contractorTemplateSheets(prepareContractor(project,{mode:'current'}).project,options);return writeTemplateWorkbook(output.sheets,output.styles);}
