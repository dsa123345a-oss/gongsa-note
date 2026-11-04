import {collectPriceEvidence,evidenceSheetNames} from './price-evidence.js';
import {costKeys} from './estimate-core.js';
import {aggregateCalculation,manualCalculation} from './calculation-modes.js';
import {columnName,writeTemplateWorkbook} from './template-workbook.js';
import {contractorTemplates} from './contractor-templates.js';

const f=(formula,value)=>({formula,value}),sum=refs=>refs.length?`SUM(${refs.join(',')})`:'0';
const ref=(sheet,col,row)=>`'${sheet}'!${col}${row}`;
const money=r=>costKeys.map(k=>r[k]||0);
function addStyles(styles){
 let fonts=Number(styles.match(/<fonts count="(\d+)"/)[1]),fills=Number(styles.match(/<fills count="(\d+)"/)[1]),xfs=Number(styles.match(/<cellXfs count="(\d+)"/)[1]);
 const font=n=>`<font>${n?'<b/>':''}<sz val="${n?11:10}"/><name val="맑은 고딕"/><color rgb="FF172C40"/></font>`;
 styles=styles.replace(/<fonts count="\d+">/,`<fonts count="${fonts+2}">`).replace('</fonts>',font(0)+font(1)+'</fonts>');
 styles=styles.replace(/<fills count="\d+">/,`<fills count="${fills+2}">`).replace('</fills>','<fill><patternFill patternType="solid"><fgColor rgb="FFFFF5CF"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFDCE8F3"/><bgColor indexed="64"/></patternFill></fill></fills>');
 const formatId=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;
 styles=styles.replace(/<numFmts count="(\d+)">/,(_,n)=>`<numFmts count="${+n+2}"><numFmt numFmtId="${formatId}" formatCode="#,##0.00000000"/><numFmt numFmtId="${formatId+1}" formatCode="#,##0"/>`);
 const make=(bold,fill,numeric=false,integer=false)=>`<xf numFmtId="${numeric?formatId+(integer?1:0):0}" fontId="${fonts+(bold?1:0)}" fillId="${fill}" borderId="1" xfId="0" applyFont="1" applyFill="1" applyAlignment="1" applyNumberFormat="1"><alignment horizontal="${numeric?'right':'left'}" vertical="center" wrapText="${numeric?0:1}"${numeric?' shrinkToFit="1"':''}/></xf>`;
 styles=styles.replace(/<cellXfs count="\d+">/,`<cellXfs count="${xfs+8}">`).replace('</cellXfs>',make(false,0)+make(true,fills+1)+make(false,fills,true)+make(false,0,true)+make(true,fills+1,true)+make(false,fills,true,true)+make(false,0,true,true)+make(true,fills+1,true,true)+'</cellXfs>');
 return {styles,ids:{text:xfs,header:xfs+1,input:xfs+2,number:xfs+3,total:xfs+4,inputInteger:xfs+5,numberInteger:xfs+6,totalInteger:xfs+7}};
}
// Only the arithmetic already accepted by the assembly calculator is translated.
function expression(input,vars){return String(input).replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/=$/,'').replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,name=>{if(Object.hasOwn(vars,name))return vars[name];if(['min','max','abs','sqrt'].includes(name))return name.toUpperCase();throw Error('엑셀로 변환할 수 없는 변수: '+name);});}
const numericInput=(text,value,vars)=>Number.isFinite(Number(text))?value:f(expression(text,vars),value);
export function buildPriceEvidence(project,libraries=[],baseStyles=contractorTemplates.new.styles){
 const graph=collectPriceEvidence(project,libraries),style=addStyles(baseStyles),sheets=evidenceSheetNames.map(name=>({name,rows:[],columns:[5,15,27,19,8,13,13,13,13,12,14,14,14,12,15,43].map((width,column)=>({column,width})),merges:['A1:P1','A2:P2','A3:P3'],printArea:[0,1,0,0,0,16],printTitles:[0,1,0,4],showGridLines:false,showZeros:true,print:{paperSize:8,scale:85,flags:0,fitToPage:true,fitToWidth:1,fitToHeight:0,left:.25,right:.25,top:.35,bottom:.35,header:.15,footer:.15,horizontalDpi:300,verticalDpi:300,footerText:'&P / &N'}}));
 const add=(s,values,kind='text',inputs=[])=>{const styles=Array.from({length:16},(_,i)=>{const integer=Number.isInteger(values[i]?.value??values[i])&&!(i===5&&inputs.includes(i)),suffix=integer?'Integer':'';return inputs.includes(i)?style.ids['input'+suffix]:kind==='header'?style.ids.header:typeof values[i]==='number'||values[i]?.formula?style.ids[(kind==='total'?'total':'number')+suffix]:style.ids.text;});s.rows.push({values,styles,height:Math.max(kind==='header'?31:25,Math.min(140,18*Math.max(Math.ceil(String(values[2]||'').length/22),Math.ceil(String(values[3]||'').length/16),Math.ceil(String(values[15]||'').length/35))))});return s.rows.length;};
 for(const s of sheets){add(s,[s.name],'header');add(s,[project.title||'공사명']);add(s,['노란 칸을 수정하면 이 엑셀의 연결 산출표·내역서·원가계산서가 재계산됩니다. R값/단가를 추정하지 않으며, 미해석 근거는 적용 단가 직접 입력으로 표시합니다.']);add(s,['번호','코드 / 연결','품명 / 산출 항목','규격 / 산식','단위','수량·계수','노무 단가','재료 단가','경비 단가','기타 단가','노무 금액','재료 금액','경비 금액','기타 금액','합계','출처 · 적용 근거'],'header');}
 const refs=new Map();
 for(const node of graph.nodes){
  const s=sheets[node.sheet],r=node.rate,vars={},partRows=[],contributing=[];
  const componentLabel={labor:'노무비',material:'재료비',expense:'경비',other:'기타'}[r.sourceComponent];
  add(s,[node.id,r.code||'',r.name||'',r.spec||'',r.unit||'','','','','','','','','','','',(r.priceReference?.source||r.source||'직접 입력')+(r.evidenceBid?' · 근거 낙찰 '+r.evidenceBid.percent+'%':'')+(componentLabel?' · '+componentLabel+'만 계상':'')],'header');
  const uses=[...node.uses].map(x=>x.replace(/\s\[[^\]]+\]$/,'')).join(' / ');const use=add(s,['','','사용 위치','','','','','','','','','','','','',uses]);
  if(node.issues.length){const n=add(s,['','','확인 필요','','','','','','','','','','','','',node.issues.join(' / ')]);s.rows[n-1].height=Math.max(s.rows[n-1].height,45);}
  if(node.sheet>=2){
   const n=s.rows.length+1,v=[node.id,r.code||'','적용 기초단가',r.spec||'',r.unit||'','',...money(r),'','','','',f(`SUM(G${n}:J${n})`,r.total||money(r).reduce((a,b)=>a+b,0)),r.priceReference?.source||r.source||'직접 입력'];
   add(s,v,'text',[6,7,8,9]);refs.set(node.id,costKeys.map((_,i)=>ref(s.name,columnName(7+i),n)));continue;
  }
  if(node.verified&&node.calc){
   for(const v of node.calc.variables){const n=s.rows.length+1;add(s,['','','변수 '+v.name,v.expression,'',numericInput(v.expression,v.value,vars),'','','','','','','','','','산출식 변수'],'text',Number.isFinite(Number(v.expression))?[5]:[]);vars[v.name]=`F${n}`;}
   for(const [i,p] of node.calc.rows.entries()){
    const n=s.rows.length+1,v=['',p.code||'',p.name||p.kind,p.qtyExpression||p.formulaSource||p.spec||'',p.unit||'',numericInput(String(p.kind?p.percent??p.qty:p.qtyExpression??p.qty),p.qty,vars),'','','','','','','','','',p.priceReference?.source||p.source||r.source||''];
    const inputs=[];if(typeof v[5]==='number'&&!manualCalculation(p))inputs.push(5);
    if(p.kind){
     let selected=node.calc.rows.slice(0,i).filter(x=>x.kind!=='subtotal');
     if(p.scope==='section')selected=selected.filter(x=>(x.section||'1')===(p.section||'1'));
     if(p.scope==='tag')selected=selected.filter(x=>x.sumTag===p.sumTag);
     if(p.scope==='nearest'){const near=node.calc.rows.slice(0,i).findLast(x=>(x.section||'1')===(p.section||'1')&&(p.basis==='total'?x.amount.total:x.amount[p.basis||'labor'])!==0);selected=near?[near]:[];}
     if(p.kind==='subtotal'&&p.startRow)selected=selected.filter(x=>x.index>=Number(p.startRow)-1);
     for(const [j,k] of costKeys.entries()){
      const col=columnName(11+j),base=p.basis==='total'?'O':columnName(11+costKeys.indexOf(p.basis||'labor'));
      const list=selected.map(x=>`${p.target==='components'||p.kind==='subtotal'?col:base}${partRows[x.index]}`),value=selected.reduce((a,x)=>a+(p.target==='components'||p.kind==='subtotal'?x.amount[k]:p.basis==='total'?x.amount.total:x.amount[p.basis||'labor']),0);
      if(p.kind==='subtotal'){v[10+j]=f(p.basis==='total'||k===(p.basis||'labor')?sum(list):'0',p.amount[k]);}
      else if(p.target==='components'||k===(p.target||'expense')){v[6+j]=f(sum(list),value);v[10+j]=f(`TRUNC(ROUND(${columnName(7+j)}${n}*F${n}/100,8),${p.componentDigits??node.calculation.componentDigits??0})`,p.amount[k]);}else v[10+j]=0;
     }
     v[15]+=' · '+(p.kind==='subtotal'?'표시 소계 · 합산 제외':`잡비 ${{all:'위 항목 전체',section:'같은 단락',tag:'같은 색인',nearest:'같은 단락 최근 항목'}[p.scope||'all']} / ${{labor:'노무비',material:'재료비',expense:'경비',other:'기타',total:'합계'}[p.basis||'labor']}${p.replaceRunning?' · 앞선 합계 대체':''}`);
    }else{
     const child=node.children.get(i),linked=child&&refs.get(child.id);
     for(const [j,k] of costKeys.entries()){
      v[6+j]=linked?f(linked[j],p[k]||0):(p[k]||0);if(!linked)inputs.push(6+j);
      v[10+j]=f(`TRUNC(ROUND(F${n}*${columnName(7+j)}${n},8),${p.componentDigits??node.calculation.componentDigits??0})`,p.amount[k]);
     }
     if(child)v[15]+=' · '+evidenceSheetNames[child.sheet]+' '+child.id;
    }
    if(manualCalculation(p)){for(const [j,k] of costKeys.entries()){v[10+j]=p.amount[k];inputs.push(10+j);}v[15]+=' · 금액 직접 입력';}
    if(!aggregateCalculation(p))v[15]+=' · 세로 집계 제외';
    v[14]=f(`SUM(K${n}:N${n})`,p.amount.total);add(s,v,'text',inputs);partRows.push(n);
    if(p.replaceRunning)contributing.length=0;if(aggregateCalculation(p)&&p.kind!=='subtotal')contributing.push(n);
   }
   const n=s.rows.length+1,v=['',r.code||'','산출 단가 / 기준 수량',r.spec||'',r.unit||'',numericInput(String(node.calculation.outputQuantity??1),node.calc.divisor,vars),'','','','','','','','','','비목별 합계 ÷ 기준 수량 · 원 미만 절사'];
   const formulas=costKeys.map((_,j)=>`TRUNC(ROUND((${sum(contributing.map(n=>columnName(11+j)+n))})/F${n},8),0)`);
   for(const [j,k] of costKeys.entries()){const expression=r.sourceComponent&&r.sourceComponent!==k?'0':node.calculation.expenseOnly?(k==='expense'?formulas.join('+'):'0'):formulas[j];v[10+j]=f(expression,r[k]||0);}
   if(componentLabel)v[15]+=' · '+componentLabel+'만 내역에 계상';
   v[14]=f(`SUM(K${n}:N${n})`,money(r).reduce((a,b)=>a+b,0));add(s,v,'total',typeof v[5]==='number'?[5]:[]);refs.set(node.id,costKeys.map((_,j)=>ref(s.name,columnName(11+j),n)));
  }else if(node.verified&&node.machine){
   const m=r.machineInputs,cells={};
   for(const [key,label,def] of [['price','장비 기준가격',0],['exchange','환율',1],['ownership','손료 계수',0],['ownershipScale','손료 분모 지수',6],['fuel','시간당 연료량',0],['fuelPrice','연료단가',0],['oilPercent','잡유율 %',0],['dailyWage','운전원 일 노임',0],['workers','운전원 인원',1],['operatorFactor','운전원 보정계수',1],['hours','1일 작업시간',8],['misc','기타 시간당 경비',0]]){const n=add(s,['','',label,'','',Number(m[key]??def)],'text',[5]);cells[key]='F'+n;}
   const n=s.rows.length+1,v=['',r.code,'시간당 기계경비',r.spec,r.unit,'','','','','','','','','','', '손료 + 운전원 + 연료·잡유 + 기타'];
   const fuel=`TRUNC(ROUND(${cells.fuel}*${cells.fuelPrice},8),0)`;
   v[10]=f(`TRUNC(ROUND(${cells.dailyWage}*${cells.workers}*${cells.operatorFactor}/${cells.hours},8),0)`,r.labor);v[11]=f(`${fuel}+TRUNC(ROUND((${fuel})*${cells.oilPercent}/100,8),0)`,r.material);v[12]=f(`TRUNC(ROUND(${cells.price}*${cells.exchange}*${cells.ownership}/10^${cells.ownershipScale},8),0)+TRUNC(${cells.misc},0)`,r.expense);v[13]=0;v[14]=f(`SUM(K${n}:N${n})`,r.total);add(s,v,'total');refs.set(node.id,costKeys.map((_,j)=>ref(s.name,columnName(11+j),n)));
  }else{
   for(const raw of node.raw){if(raw.TitleCode)continue;add(s,['',raw.Code||'',raw.Name||raw.LineData||'',raw.Size||'',raw.Unite||'',raw.GN??'',raw.NU??'',raw.GU??'',raw.JU??'','',raw.NC??'',raw.GC??'',raw.JC??'','',raw.TC??'','원본 저장 근거 · 적용 단가 자동 산식 아님']);}
   const n=add(s,['',r.code||'','적용 단가 직접 입력',r.spec||'',r.unit||'','','','','','',...money(r),'','이 행의 노란 금액이 내역서에 연결됩니다.'],'total',[10,11,12,13]);s.rows[n-1].values[14]=f(`SUM(K${n}:N${n})`,money(r).reduce((a,b)=>a+b,0));refs.set(node.id,costKeys.map((_,j)=>ref(s.name,columnName(11+j),n)));
  }
  add(s,[]);
 }
 for(const [i,s] of sheets.entries())if(s.rows.length===4)add(s,['','','현재 공사에 사용된 '+evidenceSheetNames[i]+' 항목 없음']);
 const lineRefs=new Map([...graph.lineNodes].map(([id,node])=>[id,{refs:refs.get(node.id),id:node.id,sheet:evidenceSheetNames[node.sheet],verified:!!node.verified||node.sheet>=2}]));
 return {sheets,styles:style.styles,styleIds:style.ids,lineRefs,warnings:graph.warnings,counts:sheets.map((s,i)=>({name:s.name,count:graph.nodes.filter(n=>n.sheet===i).length}))};
}
export function exportPriceEvidence(project,libraries=[]){const b=buildPriceEvidence(project,libraries);for(const s of b.sheets)s.rows[2].values[0]='내부 검토용 단가 근거표 · 노란 입력 칸을 수정하면 연결된 근거표가 재계산됩니다. 프로그램 내역서는 산출근거 편집창에서 저장하여 수정하세요.';return writeTemplateWorkbook(b.sheets,b.styles);}
