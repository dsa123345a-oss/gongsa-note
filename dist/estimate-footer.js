import {costSheet} from './cost-sheet.js';
import {separateBucket} from './cost-scopes.js';

export const separateCostNames=['폐기물처리비','현장점검비','관급자재대','원인자부담금','수수료'];
export function estimateFooterRows(project,computedTotals){
 const {rows,totals:t}=costSheet(project,computedTotals);
 const chargeRows=rows.filter(r=>r.charge&&!['management','profit','vat'].includes(r.charge.key));
 return [
  {id:'direct',name:'순공사비 (전체 직접공사비)',amount:t.direct,costs:t},
  {id:'overhead',name:'제경비',amount:chargeRows.reduce((n,r)=>n+r.amount,0)},
  ...rows.filter(r=>['net','beforeVat','contract','grand'].includes(r.id)||['management','profit','vat'].includes(r.charge?.key)).map(r=>({...r,editable:!!r.charge})),
 ];
}
export function estimateFooterHtml(project,costs,{esc,money,computedTotals}){
 return estimateFooterRows(project,computedTotals).map(r=>`<tr class="estimate-summary-row ${r.id==='grand'?'estimate-grand':''}" data-estimate-summary="${esc(r.id)}"><td colspan="10">${r.editable?`<button class="mini-link" data-open-cost-summary title="원가계산서에서 요율 수정">${esc(r.name)}</button>`:esc(r.name)}${r.rate?` <small>${esc(r.rate)}</small>`:''}</td><td class="number" data-summary-amount>${money(r.amount)}</td>${costs.map(k=>`<td></td><td class="number">${r.costs?money(r.costs[k]):''}</td>`).join('')}<td colspan="3">${r.id==='direct'&&r.costs?.missing?'미확정 제외 부분합':r.id==='overhead'?'간접노무비·보험료 등':r.id==='grand'?'아래 별도 비용까지 포함':r.editable?'원가계산서 연동':''}</td></tr>`).join('');
}
export function separateCostToolbar(project,columns,esc){
 const sections=project.lines.filter(l=>l.level>=2);
 return `<tr class="separate-cost-toolbar"><td colspan="${columns}"><strong>별도 비용 추가</strong><select data-separate-kind aria-label="별도 비용 종류">${separateCostNames.map(n=>`<option>${n}</option>`).join('')}</select><select data-separate-section aria-label="별도 비용 공구"><option value="">공사 전체</option>${sections.map((l,i)=>`<option value="${esc(l.id)}">${l.sectionNumber||i+1}공구 · ${esc(l.name)}</option>`).join('')}</select><button class="button small" data-add-separate>+ 추가</button><button class="button small" data-supply-fees>신규급수 수수료</button><span>폐기물·현장점검비: 부가세만 / 관급·부담금·수수료: 별도 합산</span></td></tr>`;
}
export function addSeparateCost(project,name,sectionId=''){
 if(!separateCostNames.includes(name))throw Error('별도 비용 종류를 선택하세요.');
 const p=structuredClone(project),sections=p.lines.filter(l=>l.level>=2),section=sections.find(l=>l.id===sectionId);
 if(sectionId&&!section)throw Error('공구를 다시 선택하세요.');
 const bucket=separateBucket(name),metadata=section?{separateSection:{id:section.id,number:section.sectionNumber||sections.indexOf(section)+1}}:{};
 let heading=p.lines.find(l=>l.level===1&&l.separateTail&&l.name===name&&(l.separateSection?.id||'')===sectionId);
 if(!heading){heading={id:crypto.randomUUID(),name,group:name,spec:'',unit:'',status:'unmatched',qty:0,factor:1,rate:null,level:1,costScope:bucket,bucket,separateTail:true,...metadata};p.lines.push(heading);}
 heading.collapsed=false;
 let index=p.lines.indexOf(heading)+1;while(index<p.lines.length&&!p.lines[index].level)index++;
 const line={id:crypto.randomUUID(),name,group:name,spec:'',unit:'식',qty:1,factor:1,bucket,status:'confirmed',source:'별도 비용 직접 입력',manualSeparate:true,...metadata,
  rate:{manual:true,id:crypto.randomUUID(),name,spec:'',unit:'식',code:'직접입력',source:'사용자 입력',labor:0,material:0,expense:0,other:0,total:0}};
 p.lines.splice(index,0,line);return {project:p,line};
}
export function setSeparateUnitPrice(line,value){
 const n=Number(value);if(value===''||!Number.isFinite(n)||n<0||n>1e14)throw Error('0 이상의 단가를 입력하세요.');
 if(!line.manualSeparate)throw Error('직접 입력한 별도 비용만 수정할 수 있습니다.');
 return {...line,status:'confirmed',rate:{...line.rate,manual:true,name:line.name,spec:line.spec,unit:line.unit,labor:0,material:0,expense:n,other:0,total:n}};
}
