import test from 'node:test';import assert from 'node:assert/strict';
import {totals,defaultCharges,synchronizeLinkedCosts} from '../dist/calc.js';
import {reverseContract} from '../dist/work-core.js';
import {validateProject} from '../dist/project-data.js';
import {costSheet} from '../dist/cost-sheet.js';
import {editCostCharge} from '../dist/cost-edit.js';
import {withBidLines} from '../dist/bid-core.js';
import {makePrintDocuments} from '../dist/est-print.js';
import {contractorTemplateSheets} from '../dist/contractor-template-export.js';
import {exportEstimate} from '../dist/workbook.js';
const row=(id,bucket,labor,material,expense)=>({id,bucket,name:id,spec:'',group:'토공',unit:'식',qty:1,status:'confirmed',rate:{labor,material,expense,other:0,total:labor+material+expense}});
export const screenshotFixture=()=>({schema:1,title:'상수도긴급보수공사(기성면 다천리 1089 배수관 보수 등)',lines:[row('direct','direct',1002462,911272,1221198),row('waste','waste',0,0,91413)],charges:defaultCharges()});
test('4,719,999원 재현: EST처럼 이윤 421771원, 부가세 429091원, 도급액 472만원',()=>{
 const p=screenshotFixture(),r=reverseContract(p,4720000),t=totals(r.project.lines,r.project.charges);
 assert.equal(r.profit,421771);assert.equal(r.vatRounding,1);assert.equal(r.difference,0);assert.equal(t.contract,4720000);
 const vat=t.charges.at(-1);assert.equal(vat.rate,10);assert.equal(vat.baseValue,4290909);assert.equal(vat.amount,429091);
 assert.equal(r.project.charges.length,p.charges.length);assert.deepEqual(r.project.lines,p.lines);
 assert.equal(costSheet(r.project).rows.find(x=>x.id==='contract').amount,4720000);
 assert.equal(totals(validateProject(JSON.parse(JSON.stringify(r.project))).lines,r.project.charges).contract,4720000);
 assert.equal(reverseContract(r.project,4720000).actual,4720000);
});
test('이윤 한도 내 모든 만원 목표를 정확히 맞추며 일반 금액은 보정하지 않는다',()=>{
 const p=screenshotFixture(),max=totals(p.lines,p.charges).contract,min=totals(p.lines,p.charges.map(c=>c.key==='profit'?{...c,base:'fixed',fixed:0}:c)).contract;
 for(let goal=Math.ceil(min/10000)*10000;goal<=max;goal+=10000){const r=reverseContract(p,goal),t=totals(r.project.lines,r.project.charges),v=t.charges.at(-1);assert.equal(t.contract,goal);assert.equal(v.amount-Math.floor(v.baseValue/10),goal%11===10?1:0);}
 assert.throws(()=>reverseContract(p,max+1));
});
test('저장 후 수량·이윤·부가세·낙찰률 변경에 이전 1원 보정이 남지 않는다',()=>{
 const r=reverseContract(screenshotFixture(),4720000).project;
 for(const change of [p=>{p.lines[0].qty=2;},p=>{p.charges[p.charges.length-1]=editCostCharge(p.charges.at(-1),'rate',5);},p=>{const i=p.charges.findIndex(c=>c.key==='profit');p.charges[i]=editCostCharge(p.charges[i],'profitRate',15);}]){
  const p=structuredClone(r);change(p);assert.equal(totals(p.lines,p.charges).charges.at(-1).reverseVatRounding,undefined);
 }
 const bid=withBidLines(r,r.lines.map(l=>({...l,bidPercent:95})));assert.equal(totals(bid.lines,bid.charges).charges.at(-1).reverseVatRounding,undefined);
});
test('자동 목표 연동도 새 목표·수량에 맞춰 VAT 원단위를 다시 산정한다',()=>{
 const r=reverseContract(screenshotFixture(),4720000),p=r.project,c=p.charges.find(c=>c.key==='profit');c.link={type:'target',target:4720000,maximum:r.maximum};
 assert.equal(totals(p.lines,p.charges).contract,4720000);c.link.target=4710000;
 const next=synchronizeLinkedCosts(p),t=totals(next.lines,next.charges);assert.equal(t.contract,4710000);assert.equal(t.charges.at(-1).reverseVatRounding,undefined);
});
test('미리보기·착공 엑셀·계산 근거 엑셀은 부가세와 총액이 일치하고 별도 조정행이 없다',()=>{
 const p=reverseContract(screenshotFixture(),4720000).project,doc=makePrintDocuments(p,[]).documents.find(d=>d.key==='summary');
 assert.ok(JSON.stringify(doc).includes('429,091'));assert.ok(JSON.stringify(doc).includes('4,720,000'));assert.ok(!JSON.stringify(doc).includes('절사조정'));
 const sheet=contractorTemplateSheets(p).sheets[0],vat=sheet.rows.find(r=>r.code==='I'),contract=sheet.rows.find(r=>r.code==='J');
 assert.equal(vat.values[5].value,429091);assert.match(vat.values[5].formula,/IF\(AND/);assert.equal(vat.values[6],.1);assert.equal(contract.values[5].value,4720000);
 const audit=exportEstimate(p,{sheets:true})[1].rows.find(r=>r[0]==='부가가치세');assert.equal(audit[3].value,429091);assert.match(audit[3].formula,/IF\(AND/);
});
test('사용자 정의 VAT 산식·5%·면세 및 이윤 없는 계산에 10% 역산을 강요하지 않는다',()=>{
 const p=screenshotFixture();p.charges.at(-1).formula='(G + H) * 0.1';assert.equal(reverseContract(p,4720000).vatRounding,0);
 assert.doesNotThrow(()=>totals(p.lines,[{key:'vat',name:'부가세',base:'contractBeforeVat',rate:10}]));
});
