import {defaultCharges,totals} from './calc.js';
import {originalProfitCharge} from './profit-adjustment.js';
export function editCostCharge(charge,field,value){
 let c=structuredClone(charge);
 if(field==='formula'){delete c.link;delete c.ruleSet;delete c.adjustment;delete c.bidOriginal;delete c.originalCharge;if(String(value).trim())c.formula=String(value).trim();else delete c.formula;return c;}
 if(field==='profitRate'){if(c.key!=='profit')throw Error('이윤 요율 항목을 확인하세요.');c=originalProfitCharge(c);if(c.base==='fixed')c.base='profitBase';field='rate';delete c.link;delete c.ruleSet;}
 if(['rate','fixed','base'].includes(field)){delete c.adjustment;delete c.bidOriginal;delete c.originalCharge;if(c.link?.type==='target')delete c.link;}
 if(['fixed','base'].includes(field))delete c.formula;
 c[field]=value;return c;
}
export function resetCostSheet(project){const next=structuredClone(project);next.charges=defaultCharges();next.costVisibility={};next.ratesReviewed=false;return next;}
export function insertCostCharge(project,selectedKey=null){
 const next=structuredClone(project),key=crypto.randomUUID();
 let index=next.charges.findIndex(c=>c.key===selectedKey);
 // Additional charges belong to the expense section, before management/profit/VAT.
 if(index<0||['indirect','management','profit','vat'].includes(selectedKey))index=next.charges.findIndex(c=>['management','profit','vat'].includes(c.key));
 next.charges.splice(index<0?next.charges.length:index,0,{key,name:'추가 비용',base:'fixed',rate:0,fixed:0});next.ratesReviewed=false;return {project:next,key};
}
export function connectNamedCostGroup(project,key){
 const charge=project.charges.find(c=>c.key===key),name=s=>String(s||'').replace(/\s/g,'').replace(/^\d+[.、)]/,'');
 if(!charge||defaultCharges().some(c=>c.key===key))return {project,connected:false};
 const group=totals(project.lines,[]).separateGroups.find(g=>name(g.name)===name(charge.name));
 if(!group)return {project,connected:false};
 const next=structuredClone(project);next.charges=next.charges.filter(c=>c.key!==key);
 next.costVisibility={...next.costVisibility,[group.bucket]:true,['separate:'+group.key]:true};
 return {project:next,connected:true,name:group.name};
}
export function deleteCostCharge(project,key){
 if(!project.charges.some(c=>c.key===key))throw Error('삭제할 요율·정액 비목 행을 먼저 선택하세요. 합계 행은 자동 계산됩니다.');
 const next=structuredClone(project);next.charges=next.charges.filter(c=>c.key!==key);if(next.costVisibility)delete next.costVisibility['charge:'+key];next.ratesReviewed=false;return next;
}
export function roundedContractTarget(value,unit,method='floor'){
 if(!Number.isFinite(value)||value<0||!Number.isSafeInteger(unit)||![1,10,100,1000,10000,100000,1000000].includes(unit)||!['floor','round','ceil'].includes(method))throw Error('금액과 자리수 단위를 확인하세요.');
 return Math[method](value/unit)*unit;
}
export function repeatableContractTarget(value,unit=10000,method='floor',adjustment=null){
 const target=roundedContractTarget(value,unit,method);
 // Integer profit and VAT can leave one won below the selected target.
 // Reopening the same rounding operation must not drop another whole unit.
 if(method==='floor'&&unit>1&&adjustment?.actual===value&&adjustment.target-value===1&&adjustment.target%unit===0)return adjustment.target;
 return target;
}
