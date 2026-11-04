import {prepareContractor} from './workflow-core.js';
import {costSheet} from './cost-sheet.js';
import {exportEstimate,buildXlsx} from './workbook.js';
import {amount,appliedRate,totals,synchronizeLinkedCosts} from './calc.js';
import {aggregateCalculation} from './calculation-modes.js';
import {exportTemplateContractor} from './contractor-template-export.js';
const f=(formula,value)=>({formula,value}),col=n=>String.fromCharCode(65+n);
// Legacy calculation-sheet model retained for import/audit compatibility.
// The user-facing export below uses the three-sheet commencement templates.
export function contractorSheets(input){
 const project=synchronizeLinkedCosts(input),all=project.lines.filter(l=>!l.exclude),lines=all.filter(l=>!l.level),t=totals(all,project.charges);
 const backing=exportEstimate(project,{sheets:true}).slice(0,2);
 const rename=x=>x.replaceAll("'설계내역서'!","'산정내역'!").replaceAll("'원가계산서'!","'산정원가'!");
 for(const s of backing){s.name=s.name==='설계내역서'?'산정내역':'산정원가';for(const r of s.rows)for(const c of r)if(c?.formula)c.formula=rename(c.formula);}
 const note=t.missing?`검토용 · 미확정 ${t.missing}건 제외 부분합`:project.charges.some(c=>c.ruleSet)?'내보낸 시점의 요율 적용 · 조건 변경은 공사노트에서 재출력':'현재 확정 단가·수량 기준';
 const rows=[['내역서'],[project.title+' · '+project.location,'','','','','','','','','','','','',note],['공종','품명','규격','수량','단위','합계','','노무비','','재료비','','경비·기타','','비고'],['','','','','','단가','금액','단가','금액','단가','금액','단가','금액','']];
 rows[1][5]=note;rows[1][13]='';
 const groups=[],detail=[],hasLevels=all.some(l=>l.level),hasDirectRoot=all.some(l=>l.headingScope==='direct');
 const ordered=hasLevels?all:[...new Set(lines.map(l=>l.group))].flatMap(group=>[{level:1,name:group,group},...lines.filter(l=>l.group===group)]);
 for(const [index,l] of ordered.entries()){
  const r=rows.length+1;
  if(l.level){groups.push({name:l.name,spec:l.spec||'',level:l.level,scope:l.headingScope,index,row:r,id:l.id,autoHeading:l.autoHeading});rows.push(['L'+l.level,l.name,l.spec||'','','','','','','','','','','','']);continue;}
  const source=all.indexOf(l)+4,a=amount(l),rate=appliedRate(l);detail.push({row:r,line:l,index});
  const ref=c=>`'산정내역'!${c}${source}`,v=k=>a?.[k]??0;
  const unit=c=>f(`IF(${ref('O')}=1,IF(${ref('U')}="금액",${ref(c)}*${ref('T')}/100,IF(${ref('T')}=100,${ref(c)},TRUNC(ROUND(${ref(c)}*${ref('T')}/100,8),0))),0)`,a?(rate?.[{G:'labor',H:'material',I:'expense',J:'other'}[c]]??0):0);
  rows.push(['',l.name,l.spec,f(l.surcharge?ref('F'):ref('F')+'*'+ref('K'),(l.qty??0)*(l.surcharge?1:(l.factor??1))),l.unit,f(`SUM(H${r},J${r},L${r})`,a?(rate?.total??0):0),a?f(`SUM(I${r},K${r},M${r})`,a.total):'미확정',unit('G'),f(ref('P'),v('labor')),unit('H'),f(ref('Q'),v('material')),f(`(${unit('I').formula})+(${unit('J').formula})`,a?(rate?.expense||0)+(rate?.other||0):0),f(ref('R')+'+'+ref('S'),v('expense')+v('other')),!aggregateCalculation(l)?'집계 제외':l.bucket==='government'?'관급':l.rate?.evidenceBid?'근거 낙찰 '+l.rate.evidenceBid.percent+'%':(l.bidPercent??100)!==100?'낙찰 '+l.bidPercent+'%':'']);
 }
 const sum=(items,c)=>items.map(x=>amount(x.line)).filter(Boolean).reduce((n,a)=>n+(c===6?a.total:c===8?a.labor:c===10?a.material:a.expense+a.other),0);
 for(const g of groups){const end=groups.find(x=>x.index>g.index&&x.level>=g.level)?.index??ordered.length;
  const contributing=detail.filter(x=>x.index>g.index&&x.index<end&&aggregateCalculation(x.line)&&(g.scope!=='direct'||x.line.bucket==='direct'));
  for(const c of [6,8,10,12])rows[g.row-1][c]=f(contributing.length?contributing.map(x=>col(c)+x.row).join('+'):'0',sum(contributing,c));
 }
 const total=[['내역서총괄표'],[project.title+' · '+project.location,'','','','','','','',note],['공종','품명','규격','수량','단위','합계','노무비','재료비','경비·기타'],['',project.title,project.location,'','','','','','']];
 total[1][5]=note;total[1][8]='';
 const visibleGroups=groups.filter(g=>!(g.autoHeading==='project'&&groups.filter(x=>x.level>=2).length===1));
 for(const g of visibleGroups)total.push(['L'+g.level,g.name,g.spec,'','',...[6,8,10,12].map(c=>f(`'내역서'!${col(c)}${g.row}`,rows[g.row-1][c].value))]);
 const included=detail.filter(x=>aggregateCalculation(x.line)&&(!hasDirectRoot||x.line.bucket==='direct'));
 for(const [i,c] of [6,8,10,12].entries())total[3][5+i]=f(included.length?included.map(x=>`'내역서'!${col(c)}${x.row}`).join('+'):'0',sum(included,c));
 const sourceRows={labor:4,material:5,expense:6,other:7,waste:9+t.charges.length,government:11+t.charges.length,fees:12+t.charges.length};
 t.charges.forEach((c,i)=>sourceRows['charge:'+i]=9+i);
 const summary=[['공사원가계산서'],[project.title,'','','','','',note],['비목','항목','구분','약어','금액','요율 / 정액','산출근거']];
 for(const r of costSheet(project).rows.filter(r=>r.visible))summary.push([r.group,r.name,r.code,r.abbr,f(r.refs.map(k=>`'산정원가'!D${sourceRows[k]}`).join('+')||'0',r.amount),r.charge?(r.charge.base==='fixed'?r.charge.fixed:r.charge.rate+'%'):'',r.basis]);
 const common={professional:true,startPage:project.printSettings?.startPage||1};
 return [{...common,name:'원가계산서',rows:summary,widths:[10,31,7,10,18,15,55],merges:['A1:G1','A2:F2'],orientation:'landscape'},
 {...common,name:'내역서총괄표',rows:total,widths:[7,37,29,10,8,18,17,17,18],merges:['A1:I1','A2:E2','F2:I2']},
 {...common,name:'내역서',rows,headerRows:4,widths:[6,28,28,10,7,12,15,12,15,12,15,12,15,20],freeze:4,decimalColumns:[3,5,7,9,11],merges:['A1:N1','A2:E2','F2:N2','A3:A4','B3:B4','C3:C4','D3:D4','E3:E4','F3:G3','H3:I3','J3:K3','L3:M3','N3:N4']},...backing];
}
export const exportContractor=exportTemplateContractor;
