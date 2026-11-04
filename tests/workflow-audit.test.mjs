import test from 'node:test';
import assert from 'node:assert/strict';
import {extractQuantities,exportEstimate} from '../dist/workbook.js';
import {addSurcharge,resolveLineAdjustments} from '../dist/line-adjustments.js';
import {totals,synchronizeLinkedCosts,amount,defaultCharges} from '../dist/calc.js';
import {prepareContractor,budgetStatus,recordCostBasis} from '../dist/workflow-core.js';
import {contractorSheets} from '../dist/contractor-export.js';
import {validateProject} from '../dist/project-data.js';
import {compatibleWork} from '../dist/match-similarity.js';
import {addRateBand,selectRateRule} from '../dist/rate-policy.js';
import {originalEstimate} from '../dist/original-est.js';
const row=(index,values)=>({index,cells:Object.fromEntries(Object.entries(values).map(([c,value])=>[c,{value,ref:c+index,cached:true,formula:''}]))});
const item=(id,labor=1000,material=0,bucket='direct')=>({id,name:id,spec:'',group:'1.토공',unit:'식',qty:1,status:'confirmed',factor:1,bucket,rate:{labor,material,expense:0,other:0,total:labor+material}});
const heading=(id,level)=>({...item(id),level,qty:null,status:'unmatched',rate:null});
const project=()=>({schema:1,title:'긴급보수',location:'',lines:[heading('site',2),heading('earth',1),item('a',112083)],charges:defaultCharges(),ratesReviewed:true});
test('실제 복합포장 양식: 아스팔트와 콘크리트 양쪽 수량을 보존한다',()=>{
 const q=extractQuantities({name:'수량',rows:[row(8,{D:'공종',H:'규격',AD:'수량',AG:'단위'}),row(18,{A:'1.토공',D:'깨기',M:'아스팔트',AD:.2,AG:'㎥'}),row(19,{M:'콘크리트',AD:4.725,AG:'㎥'}),row(20,{D:'절단',M:'아스팔트',AD:5.4,AG:'m'}),row(21,{M:'콘크리트',AD:91.4,AG:'m'})]});
 assert.deepEqual(q.rows.map(l=>[l.name,l.qty]),[['아스팔트깨기',.2],['콘크리트깨기',4.725],['아스팔트절단',5.4],['콘크리트절단',91.4]]);
 assert.equal(q.rows[1].source,'수량!D18 / AD19');assert.equal(compatibleWork({name:'아스팔트깨기'},{name:'콘크리트깨기'}),false);
});
test('할증은 비목을 보존하며 단가 낙찰 후 기준금액에 한 번만 적용한다',()=>{
 let p=addSurcharge(project(),'a',{scope:'group',basis:'labor',target:'material',percent:50});
 p=synchronizeLinkedCosts(p);assert.equal(amount(p.lines.at(-1)).material,56041);
 p.lines.find(l=>l.id==='a').bidPercent=95;p=synchronizeLinkedCosts(p);
 assert.equal(p.lines.at(-1).surcharge.baseValue,106478);assert.equal(amount(p.lines.at(-1)).material,53239);assert.equal(p.lines.at(-1).bidPercent,100);
 p.lines.find(l=>l.id==='a').qty=2;p=synchronizeLinkedCosts(p);assert.equal(amount(p.lines.at(-1)).material,106478);
 const x=exportEstimate(p,{sheets:true})[0];assert.match(x.rows[6][7].formula,/P6/);assert.equal(x.rows[6][7].value,212956);
 assert.equal(contractorSheets(p)[2].rows[7][3].value,50);
});
test('공구가 바뀌면 앞 공구의 할증을 섞지 않고 미확정 기준을 전파한다',()=>{
 let p=addSurcharge(project(),'a',{scope:'group',basis:'labor',target:'labor',percent:30});
 p.lines.push(heading('site2',2),heading('earth2',1),item('b',2000));
 p=addSurcharge(p,'b',{scope:'section',basis:'labor',target:'expense',percent:50});p=synchronizeLinkedCosts(p);
 assert.equal(amount(p.lines.at(-1)).expense,1000);
 p.lines.find(l=>l.id==='b').qty=null;assert.equal(totals(p.lines,[]).missing,2);assert.match(totals(p.lines,[]).warnings[0],/미확정/);
});
test('직접 선택 할증의 기준행 삭제·이동을 조용히 0으로 만들지 않는다',()=>{
 let p=addSurcharge(project(),'a',{scope:'selected',sourceIds:['a'],basis:'labor',target:'expense',percent:30});
 p.lines=p.lines.filter(l=>l.id!=='a');const result=resolveLineAdjustments(p.lines);assert.equal(result.lines.at(-1).status,'proposed');assert.match(result.warnings[0],/삭제/);
});
test('업체 전달본은 관급·수수료를 제거하고 설계 원본을 보존한다',()=>{
 const p=project();p.lines.push(item('gov',0,152000,'government'),item('fee',0,75000,'fees'));const before=structuredClone(p),r=prepareContractor(p,{mode:'auto'});
 assert.equal(r.percent,100);assert.equal(r.excluded.length,2);assert.equal(r.totals.government,0);assert.equal(r.totals.fees,0);assert.equal(r.totals.grand,r.totals.contract);assert.deepEqual(p,before);
 const sheets=contractorSheets(r.project);assert.equal(sheets[0].rows.some(r=>r[1]==='수수료·부담금'||r[1]==='관급자재대'),false);assert.equal(sheets[2].rows.some(r=>r[1]==='gov'||r[1]==='fee'),false);
});
test('200만원 경계와 기존 97% 예외를 보존하며 반복 출력에 중복 낙찰하지 않는다',()=>{
 const p={...project(),charges:[],lines:[item('a',2000000)]};assert.equal(prepareContractor(p,{mode:'auto'}).percent,100);
 p.lines[0].rate.labor=p.lines[0].rate.total=2000001;assert.equal(prepareContractor(p,{mode:'auto'}).percent,95);
 p.lines[0].bidPercent=97;const a=prepareContractor(p);assert.equal(a.project.lines[0].bidPercent,97);assert.equal(prepareContractor(a.project).totals.contract,a.totals.contract);
 p.lines[0].qty=null;assert.throws(()=>prepareContractor(p),/미확정/);
});
test('감액 근거가 있는 음수만 계산하고 엑셀에도 유지한다',()=>{
 const l={...item('분담금',0,58000,'fees'),qty:-1,deduction:{reason:'기존 분담금 차감'}},p={...project(),lines:[l]};
 assert.equal(totals(validateProject(p).lines,[]).fees,-58000);assert.equal(amount({...l,deduction:undefined}),null);
 const sheet=exportEstimate(p,{sheets:true})[0];assert.match(sheet.rows[3][14].formula,/TRUE/);assert.equal(sheet.rows[3][16].value,-58000);
 assert.throws(()=>validateProject({...p,lines:[{...l,deduction:{reason:''}}]}),/감액/);
 const original=originalEstimate({tables:[{name:'EstMainDat.dat',rows:[{Code:'FEE',Name:'분담금',GN:-1,TU:58000,JU:58000,JC:-58000,TC:-58000}]}]});assert.equal(original.differences.length,0);
});
test('기본 이윤 15%와 기준 이력은 기존 공사의 요율을 덮어쓰지 않는다',()=>{
 const p=project();assert.equal(p.charges.find(c=>c.key==='profit').rate,15);p.charges.find(c=>c.key==='indirect').rate=16.5;
 const next=recordCostBasis(p,{date:'2026-04-13',source:'사용자 제비율표'},[{id:'db',name:'2026-10-main.estx'}]);next.charges[0].rate=19.1;
 assert.equal(next.costBasisHistory[0].charges[0].rate,16.5);assert.equal(p.costBasisHistory,undefined);
 assert.equal(budgetStatus({...p,contractLimit:totals(p.lines,p.charges).contract}).exceeded,true);
});
test('요율 구간은 선택한 항목과 추정가격 기준으로 판정한다',()=>{
 const context={kind:'토목',date:'2026-10-31',days:30,amounts:{estimatedPrice:400000000}};
 const p=addRateBand(project(),{chargeKey:'management',amountBasis:'estimatedPrice',source:'확인한 표',kind:'토목',from:'2026-01-01',to:'2026-12-31',minAmount:0,maxAmount:500000000,minDays:1,maxDays:183},context);
 assert.equal(p.charges.filter(c=>c.ruleSet).length,1);const rs=p.charges.find(c=>c.key==='management').ruleSet;
 assert.equal(selectRateRule(rs,900000000).rule.rate,8);assert.match(selectRateRule({...rs,context:{...context,amounts:{}}},100).warning,/추정가격/);
});
