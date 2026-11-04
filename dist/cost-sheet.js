import {totals,chargeBaseLabels} from './calc.js';
import {defaultChargeFormula} from './cost-formula.js';
import {originalProfitCharge} from './profit-adjustment.js';

// The screen, print page and contractor workbook share these rows and source keys.
export function costSheet(project){
 const t=totals(project.lines,project.charges),rows=[];
 const sources={material:t.material,labor:t.labor,expense:t.expense,other:t.other,waste:t.waste,government:t.government,fees:t.fees};
 t.separateGroups.forEach((g,i)=>sources['separate:'+i]=g.amount);
 t.charges.forEach((c,i)=>sources['charge:'+i]=c.amount);
 const add=(id,group,name,code,abbr,refs,basis='',subtotal=false,chargeIndex=null)=>{
  const row={id,group,name,code,abbr,refs,basis,subtotal,chargeIndex,amount:refs.reduce((n,k)=>n+sources[k],0),visible:project.costVisibility?.[id]!==false};
  if(chargeIndex!==null){const c=t.charges[chargeIndex];row.charge=c;row.rate=c.base==='fixed'?'정액':c.rate+'%';row.basis=c.link?.type==='safety'?'안전관리비 비교 계산 · 자동 연동':c.link?.type==='target'?'목표 도급액에 맞춘 이윤 · 자동 연동':c.base==='fixed'?'정액 입력':`${chargeBaseLabels[c.base]||c.base} ${c.baseValue.toLocaleString('ko-KR')} × ${c.rate}%`;}
  if(row.charge?.key==='profit'&&row.charge.base==='fixed'&&(row.charge.adjustment||row.charge.link?.type==='target')){
   const original=originalProfitCharge(row.charge);
   if(original.base!=='fixed'){
    const baseValue=totals(project.lines,project.charges.map((c,i)=>i===chargeIndex?original:c)).charges[chargeIndex].baseValue;
    row.profitRate=baseValue?Number((row.amount/baseValue*100).toFixed(6)):0;row.profitBase=original.base;row.rate=row.profitRate+'%';
    row.basis=`${chargeBaseLabels[original.base]} ${baseValue.toLocaleString('ko-KR')} · 이윤 ${row.profitRate.toFixed(2)}% · 자리맞춤${row.charge.link?.type==='target'?' · 목표액 유지':''}`;
   }
  }
  if(row.charge?.formula){row.basis=row.charge.formula;row.rate=row.charge.rate+'%';}
  if(row.charge?.key==='profit'&&(row.profitRate!==undefined||row.charge.base!=='fixed'||row.charge.formula))row.rate=Number(row.profitRate??row.charge.rate).toFixed(2)+'%';
  rows.push(row);return row;
 };
 const indices=key=>t.charges.flatMap((c,i)=>c.key===key?[i]:[]);
 const charge=(i,group,code,abbr='')=>add('charge:'+t.charges[i].key,group,t.charges[i].name,code,abbr,['charge:'+i],'',false,i);
 add('directMaterial','재료비','직접재료비','1','직·재',[],'');
 add('material','재료비','간접재료비','2','간·재',['material'],'EST 착공 양식의 내역서 재료비 집계');
 add('materialScrap','재료비','작업설·부산물등(△)','3','',[],'');
 add('materialSum','재료비','소계','A','재료비',['material'],'1 + 2 + 3',true);
 add('labor','노무비','직접노무비','4','직·노',['labor'],'내역서 노무비 집계');
 indices('indirect').forEach((i,n)=>charge(i,'노무비',n?'5-'+n:'5','간·노'));
 const labor=['labor',...indices('indirect').map(i=>'charge:'+i)];
 add('laborSum','노무비','소계','B','노무비',labor,'직접노무비 + 간접노무비',true);
 add('expense','경비','산출경비','6','산·경',['expense','other'],'내역서 경비 + 기타 집계');
 const expIndices=t.charges.flatMap((c,i)=>!['indirect','management','profit','vat'].includes(c.key)?[i]:[]);
 expIndices.forEach((i,n)=>charge(i,'경비',String(7+n)));
 const expense=['expense','other',...expIndices.map(i=>'charge:'+i)],net=['material',...labor,...expense];
 add('expenseSum','경비','소계','C','제경비',expense,'산출경비 + 위 경비 항목',true);
 add('net','','순공사원가','D','순·공',net,'A + B + C',true);
 indices('management').forEach(i=>charge(i,'','E','일·관'));
 indices('profit').forEach(i=>charge(i,'','F','이윤'));
 const beforeVat=[...net,...indices('management').map(i=>'charge:'+i),...indices('profit').map(i=>'charge:'+i)];
 add('beforeVat','','총원가','G','총원가',beforeVat,'D + 일반관리비 + 이윤',true);
 function separate(bucket,code,fallback,abbr){
  const groups=t.separateGroups.map((g,i)=>({...g,index:i})).filter(g=>g.bucket===bucket);
  const basis=bucket==='waste'?'제경비 제외 · 부가세만 적용':bucket==='government'?'제경비·부가세 제외 · 총공사비에 별도 합산':'제경비·부가세 제외 · 총공사비에 별도 합산';
  if(!groups.length)return;
  for(const [i,g]of groups.entries()){const omitted=t.totalScope&&!t.totalScope.contractGroups.includes(g.key)&&!t.totalScope.grandGroups.includes(g.key);add(groups.length===1?bucket:'separate:'+g.key,'',g.name,groups.length===1?code:code+'-'+(i+1),abbr,['separate:'+g.index],`내역서 ${g.name} 합계 · ${omitted?'EST 원본 도급액·총공사비 합산 제외':basis}${g.missing?' · 미확정 '+g.missing+'건':''}`);}
  if(groups.length>1&&bucket!=='fees')add(bucket,'',bucket==='waste'?'부가세만 적용 공종 소계':fallback+' 소계',code,abbr,[bucket],basis,true);
 }
 separate('waste','H','폐기물처리비','별도');
 indices('vat').forEach(i=>charge(i,'','I','부가세'));
 const selected=keys=>t.separateGroups.flatMap((g,i)=>keys.includes(g.key)?['separate:'+i]:[]);
 const selectedNames=keys=>t.separateGroups.filter(g=>keys.includes(g.key)).map(g=>g.name);
 const contract=[...beforeVat,...(t.totalScope?selected(t.totalScope.contractGroups):['waste']),...indices('vat').map(i=>'charge:'+i)];
 add('contract','','도급예정액','J','도급액',contract,t.totalScope?['총원가',...selectedNames(t.totalScope.contractGroups),'부가가치세'].join(' + '):'G + H + 부가가치세',true);
 separate('government','K','관급자재대','관급');
 separate('fees','L','수수료·부담금','별도비');
 add('grand','','총공사비','M','총공사비',[...contract,...(t.totalScope?selected(t.totalScope.grandGroups):['government','fees'])],['도급예정액',...(t.totalScope?selectedNames(t.totalScope.grandGroups):new Set(t.separateGroups.filter(g=>g.bucket!=='waste').map(g=>g.name)))].join(' + '),true);
 return {rows,totals:t};
}

export function costSheetHtml(project,{esc,money}){
 const {rows}=costSheet(project);
 return `<table class="cost-sheet"><colgroup><col style="width:65px"><col style="width:235px"><col style="width:42px"><col style="width:60px"><col style="width:130px"><col style="width:100px"><col><col style="width:45px"></colgroup><thead><tr><th colspan="2">비목</th><th>구분</th><th>약어</th><th>금액</th><th>요율</th><th>산출근거</th><th>출력</th></tr></thead><tbody>${rows.map(r=>{
  const c=r.charge,adjusted=r.profitRate!==undefined,locked=!adjusted&&(!!c?.link||!!c?.ruleSet),fixed=c?.base==='fixed'&&!adjusted&&!c?.formula;
  const rateValue=adjusted?r.profitRate:fixed?c?.fixed||0:c?.rate;
  const shownRate=c?.key==='profit'&&!fixed?Number(rateValue).toFixed(2):rateValue;
  const name=c?`<input class="charge-name" data-charge-field="name" value="${esc(r.name)}" aria-label="${esc(r.name)} 항목명"><button class="delete-btn" data-charge-delete="${r.chargeIndex}" aria-label="${esc(r.name)} 삭제">×</button>`:esc(r.name);
  const rate=c?`<input class="charge-rate" type="number" min="0" step="any" data-charge-field="${adjusted?'profitRate':fixed?'fixed':'rate'}" value="${shownRate}" aria-label="${esc(r.name)} ${fixed?'정액':'요율'}" ${locked?'disabled title="작업도구에서 자동 연동 설정을 변경하세요."':''}>${fixed?'<span>원</span>':'<span>%</span>'}`:'';
  const basis=c?`<div class="cost-basis"><input class="charge-formula" data-charge-field="formula" value="${esc(defaultChargeFormula(c,project.charges))}" aria-label="${esc(r.name)} 산출근거" title="[4]=직접노무비, A=재료비 소계, B=노무비 소계, C=경비 소계, R=현재 요율/100. Enter로 적용. 빈칸은 기본 산식 복원."></div>`:esc(r.basis);

  return `<tr data-cost-tone="${({재료비:'material',노무비:'labor',경비:'expense'})[r.group]||'summary'}" data-cost-row="${esc(r.id)}" ${c?`data-charge="${r.chargeIndex}"`:''} class="${r.subtotal?'cost-subtotal':''} ${r.id==='grand'?'cost-grand':''} ${!r.visible?'cost-no-print':''}"><td class="cost-group">${esc(r.group)}</td><td class="cost-name">${name}</td><td class="cost-code">${esc(r.code)}</td><td class="cost-abbr">${esc(r.abbr)}</td><td class="number">${money(r.amount)}</td><td class="cost-rate">${rate}</td><td class="cost-formula">${basis}</td><td class="cost-print"><input type="checkbox" data-cost-visible="${esc(r.id)}" aria-label="${esc(r.name)} ${esc(r.code)} 출력" ${r.visible?'checked':''}></td></tr>`;
 }).join('')}</tbody></table>`;
}
