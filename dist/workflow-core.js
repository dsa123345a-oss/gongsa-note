import {totals,synchronizeLinkedCosts,bidPercent} from './calc.js';
import {withBidLines,bidFixedCharges} from './bid-core.js';
import {reverseContract} from './work-core.js';
import {manualCalculation} from './calculation-modes.js';
export function budgetStatus(project,t=totals(project.lines,project.charges)){
 const limit=project.contractLimit??(/긴급|보수/.test(project.title)?10000000:0);
 return {limit,amount:t.contract,remaining:limit-t.contract,exceeded:limit>0&&t.contract>=limit,partial:!!t.missing,discounted:project.lines.some(l=>bidPercent(l)!==100||l.rate?.evidenceBid)};
}
export function prepareContractor(input,{mode='current',percent=95,digits=0,target=null}={}){
 if(!['current','auto','custom'].includes(mode)||!Number.isInteger(digits)||digits<0||digits>6)throw Error('업체 전달 설정을 확인하세요.');
 let project=synchronizeLinkedCosts(structuredClone(input));
 const sourceTotals=totals(project.lines,project.charges);
 // Government material may form part of a safety-cost basis even though its
 // purchase price is excluded from the contractor's payable total.
 project.charges=project.charges.map(c=>c.link?.type==='safety'?{...c,contractorBasisLink:structuredClone(c.link),link:undefined}:c);
 project.charges=project.charges.map((c,i)=>c.formula?{...c,contractorFormulaRefs:c.contractorFormulaRefs||{K:sourceTotals.government,L:sourceTotals.fees}}:c.base==='government'?{...c,contractorOriginal:structuredClone(c),base:'fixed',fixed:sourceTotals.charges[i].amount}:c);
 const excluded=project.lines.filter(l=>!l.level&&['government','fees'].includes(l.bucket));
 project.lines=project.lines.filter(l=>l.level||!['government','fees'].includes(l.bucket));
 // Remove empty headings without merging identically named sections.
 project.lines=project.lines.filter((l,i,a)=>{if(!l.level)return true;let end=i+1;while(end<a.length&&!(a[end].level>=l.level))end++;return a.slice(i+1,end).some(x=>!x.level&&!x.exclude);});
 project.costVisibility={...project.costVisibility,government:false,fees:false};
 const prior=totals(project.lines,project.charges);if(prior.missing)throw Error(`미확정 ${prior.missing}건을 확인한 뒤 업체 전달본을 만드세요.`);
 let applied=null,designContract=prior.contract;
 if(mode!=='current'){
  project.lines=project.lines.map(l=>({...l,rate:l.rate?.evidenceBid?.original?{...l.rate,...structuredClone(l.rate.evidenceBid.original),evidenceBid:undefined}:l.rate,bidPercent:100}));
  project.charges=project.charges.map(c=>{const original=c.bidOriginal||c.link?.maximum||c.adjustment?.original||c;return {...structuredClone(original),link:undefined};});
  designContract=totals(project.lines,project.charges).contract;
  applied=mode==='auto'?(designContract<=2000000?100:95):Number(percent);
  if(!Number.isFinite(applied)||applied<0||applied>100)throw Error('낙찰률은 0~100%입니다.');
  const lines=project.lines.map(l=>!l.level&&!l.surcharge&&!l.deduction&&(l.bucket||'direct')==='direct'&&!manualCalculation(l)?{...l,bidPercent:applied,bidMethod:'unit'}:l);
  project=withBidLines(project,lines,Object.keys(bidFixedCharges));
 }
 project=synchronizeLinkedCosts(project);let t=totals(project.lines,project.charges);
 if(t.warnings?.length)throw Error(t.warnings.join(' '));
 if(target!==null||digits){const goal=target!==null?Number(target):Math.floor(t.contract/10**digits)*10**digits;if(!Number.isFinite(goal)||goal<0)throw Error('목표 도급액을 확인하세요.');
  // A saved automatic target must not override the new reverse calculation.
  project.charges=project.charges.map(c=>c.key==='profit'?{...c,link:undefined}:c);
  const result=reverseContract(project,goal);project=result.project;t=totals(project.lines,project.charges);
  project.contractorRounding={target:goal,actual:result.actual,difference:result.difference};
 }
 project.contractorCopy={createdAt:new Date().toISOString(),mode,percent:applied,designContract,excluded:excluded.map(l=>({id:l.id,name:l.name,bucket:l.bucket})),sourceTitle:input.title};
 project=synchronizeLinkedCosts(project);
 return {project,excluded,totals:totals(project.lines,project.charges),designContract,percent:applied};
}
export function recordCostBasis(project,details,libraries=[]){
 const next=structuredClone(project);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(details.date)||!details.source?.trim())throw Error('기준일과 제비율표 이름을 입력하세요.');
 const snapshot={id:crypto.randomUUID(),savedAt:new Date().toISOString(),...details,charges:structuredClone(next.charges),resourcePriceLibrary:structuredClone(next.resourcePriceLibrary||null),libraries:libraries.map(l=>({id:l.id,name:l.name,importedAt:l.importedAt||null})),contract:totals(next.lines,next.charges).contract};
 next.costBasisHistory=[...(next.costBasisHistory||[]),snapshot];next.costBasis={id:snapshot.id,date:details.date,source:details.source};return next;
}
